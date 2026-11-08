//! Fresh account identity checks own a temporary page, leaving visible verification untouched.
use super::{body, projection, search, target, validate_browser_profile, verification};
use crate::browser::cdp::Cdp;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const PROFILE_URL: &str = "https://www.douyin.com/user/self";

/// An auxiliary profile check shares the CDP reader with the login page. Preserve
/// its bounded login transitions for the account actor instead of consuming them.
pub(super) struct LoginEvents {
    session: String,
    requests: HashSet<String>,
    events: VecDeque<Value>,
}
impl LoginEvents {
    pub fn new(session: &str) -> Self {
        Self {
            session: session.into(),
            requests: HashSet::new(),
            events: VecDeque::new(),
        }
    }
    pub fn pop(&mut self) -> Option<Value> {
        self.events.pop_front()
    }
    pub fn observe(&mut self, event: &Value) -> Result<bool, String> {
        if event["sessionId"] != self.session {
            return Ok(false);
        }
        let params = &event["params"];
        let Some(id) = params["requestId"].as_str() else {
            return Ok(false);
        };
        match event["method"].as_str() {
            Some("Network.responseReceived") if projection::response_endpoint(params).is_some() => {
                if self.requests.len() >= 32 && !self.requests.contains(id) {
                    return Err("limit-exceeded:登录响应超过读取预算。".into());
                }
                self.requests.insert(id.into());
                Ok(true)
            }
            Some("Network.loadingFinished" | "Network.loadingFailed") => {
                Ok(self.requests.remove(id))
            }
            _ => Ok(false),
        }
    }
    fn defer(&mut self, event: &Value) -> Result<(), String> {
        if !self.observe(event)? {
            return Ok(());
        }
        if self.events.len() >= 96 {
            return Err("limit-exceeded:登录响应超过暂存预算。".into());
        }
        let params = &event["params"];
        // Replay only the fields consumed by the actor; omit headers and signed queries.
        let mut public = json!({"requestId":params["requestId"]});
        if event["method"] == "Network.responseReceived" {
            let mut url = reqwest::Url::parse(params["response"]["url"].as_str().unwrap()).unwrap();
            url.set_query(None);
            public["type"] = params["type"].clone();
            public["response"] = json!({"url":url.as_str(),"status":params["response"]["status"]});
        } else if event["method"] == "Network.loadingFailed" {
            public["errorText"] = params["errorText"].clone();
        }
        self.events
            .push_back(json!({"sessionId":self.session,"method":event["method"],"params":public}));
        Ok(())
    }
}

pub(super) async fn refresh(
    cdp: &mut Cdp,
    hidden: bool,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
    verification_capture: Option<&mut verification::Capture>,
    login_events: &mut LoginEvents,
) -> Result<Value, String> {
    refresh_with_budget(
        cdp,
        hidden,
        cancel,
        searches,
        verification_capture,
        login_events,
        Duration::from_secs(15),
    )
    .await
}

async fn refresh_with_budget(
    cdp: &mut Cdp,
    hidden: bool,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
    mut verification_capture: Option<&mut verification::Capture>,
    login_events: &mut LoginEvents,
    budget: Duration,
) -> Result<Value, String> {
    if cancel.is_cancelled() {
        return Err("operation-cancelled:请求已取消。".into());
    }
    // A visible account browser uses a hidden target; the inactive Windows desktop
    // retains ordinary headed targets and their established document visibility.
    let (target_id, session) = target(cdp, hidden).await?;
    let work = async {
        let navigation = cdp
            .call(Some(&session), "Page.navigate", json!({"url":PROFILE_URL}))
            .await?;
        if let Some(error) = navigation["errorText"].as_str() {
            return Err(format!("network-error:{error}"));
        }
        let mut requests = HashMap::new();
        loop {
            let event = cdp
                .events
                .recv()
                .await
                .ok_or_else(|| cdp.disconnect_reason())?;
            if event["sessionId"] != session {
                login_events.defer(&event)?;
                if let Some(capture) = verification_capture.as_deref_mut() {
                    capture.retain(cdp, &event).await?;
                }
                searches.observe(cdp, &event).await;
                continue;
            }
            let params = &event["params"];
            let id = params["requestId"].as_str().unwrap_or("");
            match event["method"].as_str() {
                Some("Network.responseReceived")
                    if projection::response_endpoint(params) == Some("profile") =>
                {
                    if requests.len() >= 8 {
                        return Err("limit-exceeded:账号检查响应超过读取预算。".into());
                    }
                    requests.insert(
                        id.to_string(),
                        params["response"]["status"].as_u64().unwrap_or(200) as u16,
                    );
                }
                Some("Network.loadingFinished") if requests.contains_key(id) => {
                    let status = requests.remove(id).unwrap();
                    if params["encodedDataLength"]
                        .as_u64()
                        .is_some_and(|size| size > 1048576)
                    {
                        return Err("limit-exceeded:账号检查响应超过读取预算。".into());
                    }
                    let bytes = body(cdp, &session, id, 1048576).await?;
                    let profile: Value = serde_json::from_slice(&bytes)
                        .map_err(|_| "invalid-response:官方账号响应格式改变。")?;
                    validate_browser_profile(cdp, &profile, status).await?;
                    return Ok(profile);
                }
                Some("Network.loadingFailed") if requests.remove(id).is_some() => {
                    return Err("network-error:官方账号检查请求失败。".into());
                }
                _ => {}
            }
        }
    };
    let result = tokio::select! {
        _ = cancel.cancelled() => Err("operation-cancelled:请求已取消。".into()),
        result = tokio::time::timeout(budget, work) => result
            .map_err(|_| "request-timeout:官方页面未返回账号状态。".to_string())
            .and_then(|result| result),
    };
    // Await cleanup even after cancellation; the owned browser is still running.
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        cdp.call(None, "Target.closeTarget", json!({"targetId":target_id})),
    )
    .await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::sync::oneshot;
    use tokio_tungstenite::tungstenite::Message;

    async fn probe(mode: &'static str) -> (Result<Value, String>, Vec<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let cancel = CancellationToken::new();
        let cancel_on_navigation = cancel.clone();
        let (release, mut keep_open) = oneshot::channel();
        let task = tauri::async_runtime::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut methods = Vec::new();
            loop {
                let message = tokio::select! {
                    _ = &mut keep_open => break,
                    message = ws.next() => message.unwrap().unwrap(),
                };
                if !message.is_text() {
                    continue;
                }
                let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                let method = command["method"].as_str().unwrap();
                methods.push(method.to_owned());
                let result = match method {
                    "Target.createTarget" => {
                        assert_eq!(
                            command["params"],
                            json!({"url":"about:blank","background":true,"hidden":true})
                        );
                        json!({"targetId":"probe-target"})
                    }
                    "Target.attachToTarget" => {
                        assert_eq!(command["params"]["targetId"], "probe-target");
                        json!({"sessionId":"probe-session"})
                    }
                    "Target.closeTarget" => {
                        assert_eq!(command["params"]["targetId"], "probe-target");
                        json!({"success":true})
                    }
                    "Storage.getCookies" => json!({"cookies":[]}),
                    "Network.enable"
                    | "Page.enable"
                    | "Page.navigate"
                    | "Network.getResponseBody" => {
                        // No operation may reload or navigate the visible account/search session.
                        assert_eq!(
                            command["sessionId"],
                            if command["params"]["requestId"] == "search" {
                                "visible-page"
                            } else {
                                "probe-session"
                            }
                        );
                        if method == "Page.navigate" {
                            assert_eq!(command["params"]["url"], PROFILE_URL);
                        }
                        if method == "Network.getResponseBody" {
                            let id = command["params"]["requestId"].as_str().unwrap();
                            assert!(matches!(id, "profile" | "search"));
                            let body = match mode {
                                "logout" => "{\"status_code\":8}",
                                "invalid" => "not-json",
                                _ if id == "search" => "{\"status_code\":0,\"data\":[]}",
                                _ => "{\"status_code\":0,\"user\":{\"nickname\":\"fixture\"}}",
                            };
                            json!({"body":body,"base64Encoded":false})
                        } else if method == "Page.navigate" && mode == "navigation-error" {
                            json!({"errorText":"net::ERR_PROXY_CONNECTION_FAILED"})
                        } else {
                            json!({})
                        }
                    }
                    other => panic!("unexpected profile command: {other}"),
                };
                ws.send(Message::Text(
                    json!({"id":command["id"],"result":result})
                        .to_string()
                        .into(),
                ))
                .await
                .unwrap();
                if method != "Page.navigate" {
                    continue;
                }
                if mode == "cancel" {
                    cancel_on_navigation.cancel();
                    continue;
                }
                if matches!(mode, "timeout" | "navigation-error") {
                    continue;
                }
                if mode == "search" {
                    ws.send(Message::Text(json!({"sessionId":"visible-page","method":"Network.responseReceived","params":{"type":"Fetch","requestId":"search","response":{"url":"https://www.douyin.com/aweme/v1/web/general/search/single/?keyword=%E9%9F%B3%E4%B9%90&offset=0","status":200}}}).to_string().into())).await.unwrap();
                    ws.send(Message::Text(json!({"sessionId":"visible-page","method":"Network.loadingFinished","params":{"requestId":"search"}}).to_string().into())).await.unwrap();
                }
                if mode == "qr" {
                    ws.send(Message::Text(json!({"sessionId":"visible-page","method":"Network.responseReceived","params":{"type":"XHR","requestId":"qr","response":{"url":"https://www.douyin.com/passport/web/get_qrcode/?private=secret","status":200,"headers":{"set-cookie":"private"}}}}).to_string().into())).await.unwrap();
                    ws.send(Message::Text(json!({"sessionId":"visible-page","method":"Network.loadingFinished","params":{"requestId":"qr"}}).to_string().into())).await.unwrap();
                }
                for (session, url, id) in [
                    (
                        "visible-page",
                        "https://www.douyin.com/aweme/v1/web/user/profile/self/",
                        "other",
                    ),
                    (
                        "probe-session",
                        "https://evil.example/aweme/v1/web/user/profile/self/",
                        "foreign",
                    ),
                    (
                        "probe-session",
                        "https://www.douyin.com/aweme/v1/web/user/profile/self/",
                        "profile",
                    ),
                ] {
                    ws.send(Message::Text(json!({"sessionId":session,"method":"Network.responseReceived","params":{"type":"Fetch","requestId":id,"response":{"url":url,"status":200}}}).to_string().into())).await.unwrap();
                    let method = if mode == "failed" && id == "profile" {
                        "Network.loadingFailed"
                    } else {
                        "Network.loadingFinished"
                    };
                    let size = if mode == "oversized" { 1048577 } else { 80 };
                    ws.send(Message::Text(json!({"sessionId":session,"method":method,"params":{"requestId":id,"encodedDataLength":size}}).to_string().into())).await.unwrap();
                }
            }
            methods
        });
        let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
            .await
            .unwrap();
        let mut searches = search::Pages::new(true);
        let mut capture = verification::Capture::new("visible-page", "音乐");
        let mut login_events = LoginEvents::new("visible-page");
        if mode == "pre-cancelled" {
            cancel.cancel();
        }
        let budget = if mode == "timeout" {
            Duration::from_millis(30)
        } else {
            Duration::from_secs(2)
        };
        let result = refresh_with_budget(
            &mut cdp,
            true,
            &cancel,
            &mut searches,
            Some(&mut capture),
            &mut login_events,
            budget,
        )
        .await;
        if mode == "qr" {
            let response = login_events
                .pop()
                .expect("QR response must survive the profile probe");
            assert_eq!(response["params"]["requestId"], "qr");
            assert_eq!(
                response["params"]["response"]["url"],
                "https://www.douyin.com/passport/web/get_qrcode/"
            );
            assert!(!response.to_string().contains("private"));
            assert_eq!(
                login_events.pop().unwrap()["method"],
                "Network.loadingFinished"
            );
        }
        if mode == "search" {
            let response = capture
                .take_response()
                .expect("concurrent verification response must be retained");
            let bytes: Vec<u8> = serde_json::from_value(response["body"].clone()).unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&bytes).unwrap(),
                json!({"status_code":0,"data":[]})
            );
        }
        let _ = release.send(());
        (result, task.await.unwrap())
    }

    #[test]
    fn fresh_profile_checks_leave_visible_search_untouched_and_detect_logout() {
        tauri::async_runtime::block_on(async {
            for mode in ["success", "logout", "search", "qr"] {
                let (result, methods) = probe(mode).await;
                if mode != "logout" {
                    assert!(projection::authenticated_profile(&result.unwrap()));
                } else {
                    assert!(result.unwrap_err().starts_with("not-authenticated:"));
                }
                assert_eq!(
                    methods
                        .iter()
                        .filter(|method| *method == "Page.navigate")
                        .count(),
                    1
                );
                assert_eq!(
                    methods
                        .iter()
                        .filter(|method| *method == "Network.getResponseBody")
                        .count(),
                    if mode == "search" { 2 } else { 1 }
                );
                assert_eq!(methods.last().unwrap(), "Target.closeTarget");
                assert!(!methods.iter().any(|method| method == "Page.reload"));
            }
        });
    }

    #[test]
    fn login_events_keep_inflight_completions_and_reject_unbounded_backlogs() {
        let mut events = LoginEvents::new("login-page");
        let response = json!({"sessionId":"login-page","method":"Network.responseReceived","params":{
            "requestId":"pending","type":"Fetch","response":{"url":"https://www.douyin.com/passport/web/check_qrconnect/","status":200}
        }});
        // A response may arrive in the actor immediately before its auxiliary check.
        assert!(events.observe(&response).unwrap());
        events.defer(&json!({"sessionId":"unrelated-page","method":"Network.loadingFinished","params":{"requestId":"pending"}})).unwrap();
        assert!(events.pop().is_none());
        events.defer(&json!({"sessionId":"login-page","method":"Network.loadingFinished","params":{"requestId":"pending"}})).unwrap();
        assert_eq!(events.pop().unwrap()["params"]["requestId"], "pending");
        for index in 0..32 {
            let mut response = response.clone();
            response["params"]["requestId"] = json!(format!("request-{index}"));
            events.defer(&response).unwrap();
        }
        assert!(
            events
                .defer(&response)
                .unwrap_err()
                .starts_with("limit-exceeded:")
        );

        let mut events = LoginEvents::new("login-page");
        for _ in 0..48 {
            events.defer(&response).unwrap();
            events.defer(&json!({"sessionId":"login-page","method":"Network.loadingFailed","params":{"requestId":"pending"}})).unwrap();
        }
        assert!(
            events
                .defer(&response)
                .unwrap_err()
                .starts_with("limit-exceeded:")
        );
    }

    #[test]
    fn temporary_profile_pages_close_on_cancellation_timeout_and_rejected_responses() {
        tauri::async_runtime::block_on(async {
            for (mode, code) in [
                ("cancel", "operation-cancelled:"),
                ("timeout", "request-timeout:"),
                ("failed", "network-error:"),
                ("navigation-error", "network-error:"),
                ("invalid", "invalid-response:"),
                ("oversized", "limit-exceeded:"),
            ] {
                let (result, methods) = probe(mode).await;
                assert!(result.unwrap_err().starts_with(code), "{mode}");
                assert_eq!(methods.last().unwrap(), "Target.closeTarget", "{mode}");
                if mode == "oversized" {
                    assert!(
                        !methods
                            .iter()
                            .any(|method| method == "Network.getResponseBody")
                    );
                }
            }
            let (result, methods) = probe("pre-cancelled").await;
            assert!(result.unwrap_err().starts_with("operation-cancelled:"));
            assert!(methods.is_empty());
        });
    }
}
