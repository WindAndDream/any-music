//! Visible verification keeps the same account Profile and observes only its requested search.
//! Portable TypeScript validates search semantics; signed URLs and cookies never cross IPC.
use super::{Manager, body, search};
use crate::{browser::cdp::Cdp, model::HttpResponse, state::RuntimeState};
use serde_json::{Value, json};
use std::collections::HashMap;
use tauri::{State, WebviewWindow};

/// Reuse the loaded homepage or the user's matching results instead of reloading them.
/// Only an unrelated, unchallenged route needs a return to the official search controls.
pub(super) async fn submit_pending(
    cdp: &mut Cdp,
    session: &str,
    query: &str,
) -> Result<bool, String> {
    // The standalone IIFE starts with a defensive semicolon, which is invalid in an argument.
    let inspect = include_str!("inspect-search-page.js").trim_start_matches(';');
    let route = include_str!("verification-search-page.js");
    let view = cdp
        .call(
            Some(session),
            "Runtime.evaluate",
            json!({
                "expression":format!("({route})({}, {inspect})", json!(query)),
                "returnByValue":true
            }),
        )
        .await?;
    match view["result"]["value"].as_str() {
        Some("submitted") => Ok(true),
        Some("ready") => search::submit(cdp, session, query).await,
        Some("navigate") => {
            let result = cdp
                .call(
                    Some(session),
                    "Page.navigate",
                    json!({"url":search::HOME_URL}),
                )
                .await?;
            if let Some(error) = result["errorText"].as_str() {
                return Err(format!("network-error:{error}"));
            }
            Ok(false)
        }
        _ => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::douyin_browser::{PrivateState, Run};
    use futures_util::{SinkExt, StreamExt};
    use std::sync::{Arc, Mutex};
    use tokio_tungstenite::tungstenite::Message;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn pending_submission_only_navigates_an_unrelated_unchallenged_page() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (release, mut keep_open) = tokio::sync::oneshot::channel();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let mut states = ["waiting", "submitted", "ready", "navigate"].into_iter();
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
                    assert_eq!(command["sessionId"], "visible-search");
                    let method = command["method"].as_str().unwrap();
                    methods.push(method.to_owned());
                    let result = match method {
                        "Runtime.evaluate" => {
                            if command["params"]["expression"]
                                .as_str()
                                .unwrap()
                                .contains("verificationSearchPage")
                            {
                                json!({"result":{"value":states.next().unwrap()}})
                            } else {
                                // Homepage controls are still loading: wait without navigating.
                                json!({"result":{"value":false}})
                            }
                        }
                        "Page.navigate" => {
                            assert_eq!(command["params"]["url"], search::HOME_URL);
                            json!({})
                        }
                        other => panic!("unexpected visible verification command: {other}"),
                    };
                    ws.send(Message::Text(
                        json!({"id":command["id"],"result":result})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                }
                methods
            });
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                .await
                .unwrap();
            for expected in [false, true, false, false] {
                assert_eq!(
                    submit_pending(&mut cdp, "visible-search", "音乐")
                        .await
                        .unwrap(),
                    expected
                );
            }
            let _ = release.send(());
            assert_eq!(
                task.await.unwrap(),
                [
                    "Runtime.evaluate",
                    "Runtime.evaluate",
                    "Runtime.evaluate",
                    "Runtime.evaluate",
                    "Runtime.evaluate",
                    "Page.navigate"
                ]
            );
        });
    }

    #[test]
    fn stale_verification_cannot_read_or_close_a_replacement_account_run() {
        tauri::async_runtime::block_on(async {
            let manager = Manager::default();
            let (actions, _) = tokio::sync::mpsc::channel(1);
            manager.runs.lock().unwrap().insert(
                "account-a".into(),
                Run {
                    cancel: CancellationToken::new(),
                    public: Arc::new(Mutex::new(PrivateState {
                        verification_id: Some("new".into()),
                        verification_response: Some(json!({"status":200,"body":[123,125]})),
                        ..Default::default()
                    })),
                    actions,
                    task: tauri::async_runtime::spawn(async {}),
                },
            );
            assert!(
                manager
                    .require_verification("account-a", "old")
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
            assert!(manager.verification_response("account-a", "old").is_err());
            assert!(manager.cancel_verification("account-a", "old").is_err());
            assert!(
                !manager
                    .runs
                    .lock()
                    .unwrap()
                    .get("account-a")
                    .unwrap()
                    .cancel
                    .is_cancelled()
            );
            assert!(manager.verification_response("account-b", "new").is_err());
            assert_eq!(
                manager
                    .verification_response("account-a", "new")
                    .unwrap()
                    .unwrap()
                    .body,
                json!([123, 125])
            );
            {
                let runs = manager.runs.lock().unwrap();
                let mut data = runs.get("account-a").unwrap().public.lock().unwrap();
                data.failure =
                    Some("network-error:无法启动账号浏览器（Windows 错误码 5）。".into());
            }
            assert_eq!(
                manager
                    .verification_response("account-a", "new")
                    .err()
                    .unwrap(),
                "network-error:无法启动账号浏览器（Windows 错误码 5）。"
            );
            assert_eq!(
                manager
                    .ready_page("account-a", &CancellationToken::new())
                    .await
                    .unwrap_err(),
                "network-error:无法启动账号浏览器（Windows 错误码 5）。"
            );
            assert_eq!(
                manager
                    .ready("account-a", &CancellationToken::new())
                    .await
                    .unwrap_err(),
                "network-error:无法启动账号浏览器（Windows 错误码 5）。"
            );
            manager
                .runs
                .lock()
                .unwrap()
                .get("account-a")
                .unwrap()
                .public
                .lock()
                .unwrap()
                .failure = None;
            manager.cancel_verification("account-a", "new").unwrap();
            assert!(
                manager
                    .ready_page("account-a", &CancellationToken::new())
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
            assert!(
                manager
                    .verification_response("account-a", "new")
                    .err()
                    .unwrap()
                    .starts_with("network-error:")
            );
            manager.stop("account-a").await.unwrap();
        });
    }

    #[test]
    fn verification_reads_only_the_exact_search_session_keyword_and_origin() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let (release, keep_open) = tokio::sync::oneshot::channel();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let command: Value =
                    serde_json::from_str(ws.next().await.unwrap().unwrap().to_text().unwrap())
                        .unwrap();
                assert_eq!(command["method"], "Network.getResponseBody");
                assert_eq!(command["sessionId"], "wanted");
                assert_eq!(command["params"]["requestId"], "data");
                ws.send(Message::Text(json!({"id":command["id"],"result":{"body":"{\"status_code\":0,\"data\":[]}","base64Encoded":false}}).to_string().into())).await.unwrap();
                // A real account socket stays open while the response is consumed.
                // Closing here races Cdp's disconnect cancellation against its delivered reply.
                let _ = keep_open.await;
            });
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                .await
                .unwrap();
            let mut capture = Capture::new("wanted", "音乐");
            let url = "https://www.douyin.com/aweme/v1/web/general/search/single/?keyword=%E9%9F%B3%E4%B9%90&offset=0";
            for (session, address, kind) in [
                ("other", url.to_string(), "Fetch"),
                ("wanted", url.replace("keyword=", "keyword=other"), "Fetch"),
                (
                    "wanted",
                    url.replace("www.douyin.com", "evil.example"),
                    "Fetch",
                ),
                ("wanted", url.to_string(), "Preflight"),
            ] {
                assert!(capture.observe(&mut cdp, &json!({"sessionId":session,"method":"Network.responseReceived","params":{"requestId":"data","type":kind,"response":{"url":address,"status":200}}})).await.unwrap().is_none());
            }
            assert!(capture.requests.is_empty());
            capture.observe(&mut cdp,&json!({"sessionId":"wanted","method":"Network.responseReceived","params":{"requestId":"data","type":"Fetch","response":{"url":url,"status":200}}})).await.unwrap();
            let response = capture.observe(&mut cdp,&json!({"sessionId":"wanted","method":"Network.loadingFinished","params":{"requestId":"data","encodedDataLength":30}})).await.unwrap().unwrap();
            assert_eq!(response["status"], 200);
            assert!(capture.requests.is_empty());
            let _ = release.send(());
            task.await.unwrap();
        });
    }
}

pub(super) struct Capture {
    session: String,
    query: String,
    requests: HashMap<String, u64>,
    pending_response: Option<Value>,
}
impl Capture {
    pub fn new(session: &str, query: &str) -> Self {
        Self {
            session: session.into(),
            query: query.into(),
            requests: HashMap::new(),
            pending_response: None,
        }
    }
    /// Auxiliary identity checks may consume events while the visible search completes.
    /// Retain that response for the account actor without copying its body.
    pub async fn retain(&mut self, cdp: &mut Cdp, event: &Value) -> Result<(), String> {
        if let Some(response) = self.observe(cdp, event).await? {
            self.pending_response = Some(response);
        }
        Ok(())
    }
    pub fn take_response(&mut self) -> Option<Value> {
        self.pending_response.take()
    }
    pub async fn observe(&mut self, cdp: &mut Cdp, event: &Value) -> Result<Option<Value>, String> {
        if event["sessionId"] != self.session {
            return Ok(None);
        }
        let params = &event["params"];
        let id = params["requestId"].as_str().unwrap_or("");
        match event["method"].as_str() {
            Some("Network.responseReceived")
                if search::response_cursor(params, &self.query).is_some() =>
            {
                if self.requests.len() < 8 {
                    self.requests.insert(
                        id.into(),
                        params["response"]["status"].as_u64().unwrap_or(200),
                    );
                }
            }
            Some("Network.loadingFailed") => {
                self.requests.remove(id);
            }
            Some("Network.loadingFinished") => {
                if let Some(status) = self.requests.remove(id) {
                    if params["encodedDataLength"]
                        .as_u64()
                        .is_some_and(|v| v > 12582912)
                    {
                        return Err("limit-exceeded:搜索响应超过读取预算。".into());
                    }
                    match body(cdp, &self.session, id, 12582912).await {
                        Ok(bytes) => return Ok(Some(json!({"status":status,"body":bytes}))),
                        Err(error) if error.contains("response-body-unavailable:") => {}
                        Err(error) => return Err(error),
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }
}
impl Manager {
    fn cancel_verification(&self, id: &str, verification_id: &str) -> Result<(), String> {
        let runs = self.runs.lock().unwrap();
        let run = runs.get(id).ok_or("operation-cancelled:验证会话已结束。")?;
        if run.public.lock().unwrap().verification_id.as_deref() != Some(verification_id) {
            return Err("operation-cancelled:验证会话已被替换。".into());
        }
        // Cancellation must interrupt startup before waiting for its handoff lock.
        // Check and cancel under one lock so a stale dialog cannot cancel a new browser.
        run.cancel.cancel();
        Ok(())
    }
    fn require_verification(&self, id: &str, verification_id: &str) -> Result<(), String> {
        let runs = self.runs.lock().unwrap();
        let run = runs.get(id).ok_or("operation-cancelled:验证会话已结束。")?;
        if run.public.lock().unwrap().verification_id.as_deref() != Some(verification_id) {
            return Err("operation-cancelled:验证会话已被替换。".into());
        }
        Ok(())
    }
    fn verification_response(
        &self,
        id: &str,
        verification_id: &str,
    ) -> Result<Option<HttpResponse>, String> {
        self.require_verification(id, verification_id)?;
        let runs = self.runs.lock().unwrap();
        let run = runs.get(id).ok_or("operation-cancelled:验证会话已结束。")?;
        let data = run.public.lock().unwrap();
        if data.verification_id.as_deref() != Some(verification_id) {
            return Err("operation-cancelled:验证会话已被替换。".into());
        }
        // Worker launch/CDP errors used to be replaced with "browser closed", losing the cause.
        if let Some(error) = &data.failure {
            return Err(error.clone());
        }
        if run.cancel.is_cancelled() {
            return Err("network-error:验证浏览器已关闭，请重新点击验证。".into());
        }
        Ok(data
            .verification_response
            .as_ref()
            .map(|value| HttpResponse {
                status: value["status"].as_u64().unwrap_or(200) as u16,
                status_text: String::new(),
                headers: String::new(),
                body: value["body"].clone(),
            }))
    }
}

#[tauri::command]
pub async fn begin_douyin_search_verification(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    verification_id: String,
    query: String,
) -> Result<(), String> {
    crate::browser::verification::require_main(&window)?;
    let request = search::Request::new(verification_id.clone(), query, 0)?;
    let _usage = state.use_account(&account_id, "搜索二次验证")?;
    let _handoff = state.douyin_browsers.handoff(&account_id).await;
    let account = state.account(&account_id)?;
    if !account.enabled || account.platform_id != "douyin" {
        return Err("account-unavailable:抖音账号已停用或不可用。".into());
    }
    state.douyin_browsers.stop(&account_id).await?;
    {
        let _lock = state.browsers.lock().unwrap();
        state.clear_qr(&account_id);
        // Visibility and browser selection are independent: preserve this Profile's browser.
        state.douyin_browsers.launch(
            &state,
            &account_id,
            None,
            Some((verification_id, request.query)),
        )?;
        state.status(&account_id, "verification-required")?;
        if let Some(old) = state.sessions.lock().unwrap().remove(&account_id) {
            old.cancelled.cancel();
        }
        state
            .media
            .lock()
            .unwrap()
            .retain(|_, grant| grant.account_id.as_deref() != Some(&account_id));
    }
    // Do not report an opened browser until the native process/CDP/page setup actually succeeded.
    // Release the synchronous lifecycle mutex while waiting; the async handoff lock scopes this run.
    state
        .douyin_browsers
        .ready_page(&account_id, &tokio_util::sync::CancellationToken::new())
        .await
}

#[tauri::command]
pub fn poll_douyin_search_verification(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    verification_id: String,
) -> Result<Option<HttpResponse>, String> {
    crate::browser::verification::require_main(&window)?;
    state.account(&account_id)?;
    crate::model::validate_id(&verification_id)?;
    state
        .douyin_browsers
        .verification_response(&account_id, &verification_id)
}

#[tauri::command]
pub async fn end_douyin_search_verification(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    verification_id: String,
    completed: bool,
) -> Result<(), String> {
    crate::browser::verification::require_main(&window)?;
    crate::model::validate_id(&verification_id)?;
    if !completed {
        state
            .douyin_browsers
            .cancel_verification(&account_id, &verification_id)?;
    }
    let _handoff = state.douyin_browsers.handoff(&account_id).await;
    state
        .douyin_browsers
        .require_verification(&account_id, &verification_id)?;
    if completed {
        state
            .douyin_browsers
            .refresh_credentials(&account_id)
            .await?;
        let _lock = state.browsers.lock().unwrap();
        state
            .douyin_browsers
            .require_verification(&account_id, &verification_id)?;
        let account = state.account(&account_id)?;
        if !account.enabled {
            return Err("operation-cancelled:账号已停用。".into());
        }
        let session =
            state.create_session(&account, reqwest_cookie_store::CookieStore::default())?;
        crate::accounts::login::commit_douyin(&state, &account_id, &session)?;
    }
    state.douyin_browsers.stop(&account_id).await?;
    let _lock = state.browsers.lock().unwrap();
    if !completed {
        crate::accounts::session::cancel_verification(&state, &account_id)?;
    }
    let account = state.account(&account_id)?;
    if account.enabled && completed {
        // Close gracefully to flush the persistent Profile before the inactive desktop takes over.
        state.status(
            &account_id,
            if account.authentication == "credential" {
                "ready"
            } else {
                "signed-out"
            },
        )?;
        state.douyin_browsers.ensure(&state, &account_id, None)?;
    }
    Ok(())
}
