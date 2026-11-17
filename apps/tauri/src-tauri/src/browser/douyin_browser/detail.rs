//! Resolve one fresh work in its account's official browser, without reading media bytes.
//! Only the matching detail API or main detail document crosses the portable parser boundary.
use super::{Packet, body, search, target};
use crate::browser::cdp::Cdp;
use serde_json::{Value, json};
use std::{collections::HashMap, time::Duration};
use tokio_util::sync::CancellationToken;

const MAX_BODY: usize = 12 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct Request {
    pub aweme_id: String,
    page_kind: String,
}
impl Request {
    pub fn new(aweme_id: String, page_kind: Option<String>) -> Result<Self, String> {
        let page_kind = page_kind.unwrap_or_else(|| "video".into());
        if aweme_id.is_empty()
            || aweme_id.len() > 32
            || !aweme_id.bytes().all(|byte| byte.is_ascii_digit())
            || !matches!(page_kind.as_str(), "video" | "note")
        {
            return Err("invalid-input:抖音作品标识或页面类型无效。".into());
        }
        Ok(Self {
            aweme_id,
            page_kind,
        })
    }
    fn url(&self) -> String {
        format!(
            "https://www.douyin.com/{}/{}",
            self.page_kind, self.aweme_id
        )
    }
}

#[derive(Clone, Copy, PartialEq)]
enum ResponseKind {
    Document,
    Api,
}
fn response_kind(params: &Value, request: &Request) -> Option<ResponseKind> {
    let url = params["response"]["url"]
        .as_str()?
        .parse::<reqwest::Url>()
        .ok()?;
    let host = url.host_str()?;
    if url.scheme() != "https"
        || !matches!(host, "www.douyin.com" | "www-hj.douyin.com")
        || url.port_or_known_default() != Some(443)
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    match params["type"].as_str()? {
        "Document"
            if host == "www.douyin.com"
                && url.query().is_none()
                && ["video", "note"]
                    .iter()
                    .any(|kind| url.path() == format!("/{kind}/{}", request.aweme_id)) =>
        {
            Some(ResponseKind::Document)
        }
        // Signed-in clients request detail from the official `www-hj` API host.
        "XHR" | "Fetch" if url.path() == "/aweme/v1/web/aweme/detail/" => {
            let mut ids = url.query_pairs().filter(|(key, _)| key == "aweme_id");
            let (_, id) = ids.next()?;
            (id == request.aweme_id && ids.next().is_none()).then_some(ResponseKind::Api)
        }
        _ => None,
    }
}

async fn inspect(cdp: &mut Cdp, session: &str) -> Result<(), String> {
    let view = cdp
        .call(
            Some(session),
            "Runtime.evaluate",
            json!({
                "expression": include_str!("inspect-search-page.js"), "returnByValue": true
            }),
        )
        .await?;
    match view["result"]["value"].as_str() {
        Some("verification-required") => {
            Err("verification-required:抖音作品需要完成安全验证。".into())
        }
        Some("login-required") => {
            let cookies = cdp.call(None, "Storage.getCookies", json!({})).await?;
            Err(super::projection::authentication_error(
                super::projection::has_login(&super::projection::cookie_store(&cookies)?),
            ))
        }
        _ => Ok(()),
    }
}

pub(super) async fn validate_authentication(cdp: &mut Cdp, packet: &Packet) -> Result<(), String> {
    // Reuse native authentication projection; work DTO parsing remains portable.
    // Do not classify ordinary HTML by SDK words such as "captcha" in script bundles.
    match crate::model::classify(
        "douyin",
        packet.status,
        &String::from_utf8_lossy(&packet.body),
    ) {
        "verification-required" => Err("verification-required:抖音作品需要完成安全验证。".into()),
        "expired" => {
            let cookies = cdp.call(None, "Storage.getCookies", json!({})).await?;
            Err(super::projection::authentication_error(
                super::projection::has_login(&super::projection::cookie_store(&cookies)?),
            ))
        }
        _ => Ok(()),
    }
}

pub(super) async fn load(
    cdp: &mut Cdp,
    request: Request,
    hidden: bool,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
) -> Result<Packet, String> {
    load_with_budget(
        cdp,
        request,
        hidden,
        cancel,
        searches,
        // The detail API starts only after the official page loads its script set, which
        // takes tens of seconds on slow links; its SSR document carries no media URLs.
        Duration::from_secs(40),
    )
    .await
}

/// After routing, the official client normally requests detail within a few seconds. A
/// silent route (for example one served from client memory) falls back to a cold page.
const ROUTE_GRACE: Duration = Duration::from_secs(8);

async fn load_with_budget(
    cdp: &mut Cdp,
    request: Request,
    hidden: bool,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
    budget: Duration,
) -> Result<Packet, String> {
    if cancel.is_cancelled() {
        return Err("operation-cancelled:作品读取已取消。".into());
    }
    let deadline = tokio::time::Instant::now() + budget;
    if let Some(player) = searches.take_player() {
        let routed = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err("operation-cancelled:作品读取已取消。".into()),
            result = tokio::time::timeout_at(deadline, routed(cdp, &player.1, &request, cancel, searches)) => result.unwrap_or(Ok(None)),
        };
        match routed {
            Ok(Some(packet)) => {
                searches.restore_player(player);
                return Ok(packet);
            }
            // Failures keep their original error; the page may hold a challenge or stale state.
            result => {
                let _ = cdp
                    .call(None, "Target.closeTarget", json!({"targetId":player.0}))
                    .await;
                result?;
            }
        }
    }
    let (target_id, session) = target(cdp, hidden).await?;
    let mut document = None;
    let mut api_received = false;
    let work = async {
        // This target resolves descriptors only; prevent page autoplay/artwork transfers.
        cdp.call(
            Some(&session),
            "Fetch.enable",
            json!({"patterns":[
                {"resourceType":"Media","requestStage":"Request"},
                {"resourceType":"Image","requestStage":"Request"}
            ]}),
        )
        .await?;
        let navigation = cdp
            .call(
                Some(&session),
                "Page.navigate",
                json!({"url":request.url()}),
            )
            .await?;
        if let Some(error) = navigation["errorText"].as_str() {
            return Err(format!("network-error:{error}"));
        }
        let frame = navigation["frameId"].as_str().unwrap_or("").to_owned();
        capture(
            cdp,
            &session,
            &request,
            Some(&frame),
            cancel,
            searches,
            &mut document,
            &mut api_received,
        )
        .await
    };
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("operation-cancelled:作品读取已取消。".into()),
        result = tokio::time::timeout_at(deadline, work) => match result {
            Ok(result) => result,
            // The official page can fetch media detail after its load event. Keep the target
            // alive for that exact API; SSR documents are only a bounded no-API fallback.
            Err(_) => document.filter(|_| !api_received)
                .ok_or_else(|| "request-timeout:官方作品详情加载超时，请重试。".to_string()),
        },
    };
    // Closing the fresh target also stops autoplay/media reads and pending navigation.
    // No detail response or media URL survives into another playback attempt.
    let _ = cdp
        .call(None, "Target.closeTarget", json!({"targetId":target_id}))
        .await;
    result
}

/// Wait for the warm page to hydrate, route it to the work and capture the client's detail
/// API. `Ok(None)` means the route produced nothing usable and a cold page should be tried.
async fn routed(
    cdp: &mut Cdp,
    session: &str,
    request: &Request,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
) -> Result<Option<Packet>, String> {
    let expression = format!(
        "({})({},{})",
        include_str!("route-detail.js"),
        json!(request.page_kind),
        json!(request.aweme_id)
    );
    let mut timer = tokio::time::interval(Duration::from_millis(250));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err("operation-cancelled:作品读取已取消。".into()),
            event = cdp.events.recv() => {
                let event = event.ok_or("network-error:账号页面连接中断。")?;
                if event["sessionId"] != session {
                    searches.observe(cdp, &event).await;
                } else if event["method"] == "Fetch.requestPaused" {
                    cdp.call(Some(session), "Fetch.failRequest", json!({
                        "requestId":event["params"]["requestId"], "errorReason":"Aborted"
                    })).await?;
                }
            }
            _ = timer.tick() => {
                inspect(cdp, session).await?;
                let result = cdp.call(Some(session), "Runtime.evaluate", json!({"expression":expression,"returnByValue":true,"userGesture":true})).await?;
                match result["result"]["value"].as_str() {
                    Some("routed") => break,
                    Some(_) => return Ok(None),
                    None => {}
                }
            }
        }
    }
    let (mut document, mut api_received) = (None, false);
    let captured = tokio::time::timeout(
        ROUTE_GRACE,
        capture(
            cdp,
            session,
            request,
            None,
            cancel,
            searches,
            &mut document,
            &mut api_received,
        ),
    )
    .await;
    captured.map_or(Ok(None), |result| result.map(Some))
}

/// Read the matching detail API (or, for a navigated `frame`, its main document) from one
/// page until the API arrives. Media and image requests are refused at the network layer.
#[allow(clippy::too_many_arguments)] // Both detail paths share one bounded capture state.
async fn capture(
    cdp: &mut Cdp,
    session: &str,
    request: &Request,
    frame: Option<&str>,
    cancel: &CancellationToken,
    searches: &mut search::Pages,
    document: &mut Option<Packet>,
    api_received: &mut bool,
) -> Result<Packet, String> {
    let mut pending = HashMap::new();
    let mut timer = tokio::time::interval(Duration::from_millis(250));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err("operation-cancelled:作品读取已取消。".into()),
            event = cdp.events.recv() => {
                let event = event.ok_or("network-error:账号页面连接中断。")?;
                if event["sessionId"] != session {
                    searches.observe(cdp, &event).await;
                    continue;
                }
                let params = &event["params"];
                let id = params["requestId"].as_str().unwrap_or("");
                match event["method"].as_str() {
                    Some("Fetch.requestPaused") => {
                        cdp.call(Some(session), "Fetch.failRequest", json!({
                            "requestId":params["requestId"], "errorReason":"Aborted"
                        })).await?;
                    }
                    Some("Network.responseReceived") => {
                        if let Some(kind) = response_kind(params, request)
                            && (kind == ResponseKind::Api || frame.is_some_and(|frame| params["frameId"] == frame))
                            && let Some(status) = params["response"]["status"].as_u64()
                                .filter(|status| (100..=599).contains(status))
                        {
                            if pending.len() >= 8 { return Err("limit-exceeded:作品响应超过读取预算。".into()); }
                            *api_received |= kind == ResponseKind::Api;
                            pending.insert(id.to_owned(), (kind, status as u16));
                        }
                    }
                    Some("Network.loadingFinished") => {
                        if let Some((kind, status)) = pending.remove(id) {
                            if params["encodedDataLength"].as_u64().is_some_and(|size| size > MAX_BODY as u64) {
                                return Err("limit-exceeded:作品响应超过读取预算。".into());
                            }
                            let packet = Packet { status, body: body(cdp, session, id, MAX_BODY).await? };
                            if kind == ResponseKind::Api || status == 401 {
                                validate_authentication(cdp, &packet).await?;
                            }
                            if kind == ResponseKind::Api {
                                inspect(cdp, session).await?;
                                return Ok(packet);
                            }
                            *document = Some(packet);
                        }
                    }
                    Some("Network.loadingFailed") if pending.remove(id).is_some() => {
                        if let Some(error) = params["errorText"].as_str()
                            && crate::network::proxy_routing::is_browser_proxy_failure(error) {
                            return Err(format!("network-error:{error}"));
                        }
                        return Err("network-error:官方作品请求失败，请重试。".into());
                    }
                    _ => {},
                }
            }
            _ = timer.tick() => inspect(cdp, session).await?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;

    #[test]
    fn identities_and_responses_are_validated_before_capture() {
        for id in ["", "12/34", "１２３", "-1", &"1".repeat(33)] {
            assert!(Request::new(id.into(), None).is_err());
        }
        assert!(Request::new("123".into(), Some("user".into())).is_err());
        let request = Request::new("123".into(), Some("note".into())).unwrap();
        assert_eq!(request.url(), "https://www.douyin.com/note/123");
        for (kind, url) in [
            ("Document", "https://www.douyin.com/note/123"),
            ("Document", "https://www.douyin.com/video/123"),
            (
                "Fetch",
                "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123",
            ),
            (
                "XHR",
                "https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123",
            ),
        ] {
            assert!(
                response_kind(&json!({"type":kind,"response":{"url":url}}), &request).is_some()
            );
        }
        for (kind, url) in [
            ("Document", "https://www.douyin.com/video/456"),
            ("Document", "https://www.douyin.com/video/123?modal_id=456"),
            ("Document", "https://www.douyin.com/video/123#fragment"),
            ("Document", "https://www.douyin.com:444/video/123"),
            ("Document", "https://user@www.douyin.com/video/123"),
            ("Document", "http://www.douyin.com/video/123"),
            ("Document", "https://www.douyin.com.example/video/123"),
            // The API host serves no work documents.
            ("Document", "https://www-hj.douyin.com/video/123"),
            (
                "XHR",
                "https://www-hj.douyin.com.example/aweme/v1/web/aweme/detail/?aweme_id=123",
            ),
            (
                "Fetch",
                "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=456",
            ),
            (
                "Fetch",
                "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123&aweme_id=123",
            ),
            (
                "Fetch",
                "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=&aweme_id=123",
            ),
            (
                "Media",
                "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123",
            ),
        ] {
            assert!(
                response_kind(&json!({"type":kind,"response":{"url":url}}), &request).is_none()
            );
        }
    }

    #[test]
    fn fresh_targets_match_one_work_bound_reads_and_close_after_success_or_cancellation() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let cancel = CancellationToken::new();
            let cancel_on_navigation = cancel.clone();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let mut created = 0;
                let mut closed = 0;
                let mut read = 0;
                let mut blocked = 0;
                while let Some(Ok(message)) = ws.next().await {
                    let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    let method = command["method"].as_str().unwrap();
                    let result = match method {
                        "Target.createTarget" => {
                            created += 1;
                            assert_eq!(command["params"]["hidden"], true);
                            json!({"targetId":format!("target-{created}")})
                        }
                        "Target.attachToTarget" => {
                            json!({"sessionId":format!("session-{created}")})
                        }
                        "Network.enable" | "Page.enable" => json!({}),
                        "Fetch.enable" => {
                            assert_eq!(command["params"]["patterns"][0]["resourceType"], "Media");
                            json!({})
                        }
                        "Fetch.failRequest" => {
                            blocked += 1;
                            assert_eq!(command["params"]["errorReason"], "Aborted");
                            json!({})
                        }
                        "Page.navigate" => {
                            assert_eq!(command["params"]["url"], "https://www.douyin.com/note/123");
                            if created == 3 {
                                cancel_on_navigation.cancel();
                            }
                            json!({"frameId":"main"})
                        }
                        "Runtime.evaluate" => json!({"result":{"value":null}}),
                        "Network.getResponseBody" => {
                            read += 1;
                            let document =
                                command["params"]["requestId"] == format!("document-{created}");
                            assert!(
                                document
                                    || command["params"]["requestId"]
                                        == format!("wanted-{created}")
                            );
                            json!({"body":if document || created == 2 {"<script>metadata-only document</script>"} else {"{\"aweme_detail\":{\"aweme_id\":\"123\"}}"},"base64Encoded":false})
                        }
                        "Target.closeTarget" => {
                            closed += 1;
                            json!({"success":true})
                        }
                        other => panic!("unexpected detail command {other}"),
                    };
                    ws.send(Message::Text(
                        json!({"id":command["id"],"result":result})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                    if method == "Page.navigate" {
                        let session = format!("session-{created}");
                        ws.send(Message::Text(json!({"sessionId":session,"method":"Fetch.requestPaused","params":{"requestId":"autoplay"}}).to_string().into())).await.unwrap();
                        if matches!(created, 1 | 6 | 7) {
                            // The real page finishes its document/load event before asking for detail.
                            // Returning here loses the playable API response and manufactures AM-1004.
                            ws.send(Message::Text(json!({"sessionId":session,"method":"Network.responseReceived","params":{"requestId":format!("document-{created}"),"type":"Document","frameId":"main","response":{"url":"https://www.douyin.com/note/123","status":200}}}).to_string().into())).await.unwrap();
                            ws.send(Message::Text(json!({"sessionId":session,"method":"Network.loadingFinished","params":{"requestId":format!("document-{created}"),"encodedDataLength":50}}).to_string().into())).await.unwrap();
                            ws.send(Message::Text(json!({"sessionId":session,"method":"Page.loadEventFired","params":{}}).to_string().into())).await.unwrap();
                        }
                        if created == 5 {
                            continue;
                        }
                        let api = "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123";
                        let url = if created == 2 {
                            "https://www.douyin.com/note/123"
                        } else {
                            api
                        };
                        for (session, id, url, kind, frame) in [
                            ("other-account", "noise", url, "Fetch", "main"),
                            (
                                session.as_str(),
                                "noise",
                                "https://www.douyin.com/video/456",
                                "Document",
                                "main",
                            ),
                            (
                                session.as_str(),
                                "noise",
                                "https://www.douyin.com/note/123",
                                "Document",
                                "child",
                            ),
                            (
                                session.as_str(),
                                "wanted",
                                url,
                                if created == 2 { "Document" } else { "Fetch" },
                                "main",
                            ),
                        ] {
                            let id = format!("{id}-{created}");
                            ws.send(Message::Text(json!({"sessionId":session,"method":"Network.responseReceived","params":{"requestId":id,"type":kind,"frameId":frame,"response":{"url":url,"status":200}}}).to_string().into())).await.unwrap();
                            if created == 7 && id.starts_with("wanted") {
                                continue;
                            }
                            let event = if created == 6 && id.starts_with("wanted") {
                                json!({"sessionId":session,"method":"Network.loadingFailed","params":{"requestId":id,"errorText":"net::ERR_FAILED"}})
                            } else {
                                json!({"sessionId":session,"method":"Network.loadingFinished","params":{"requestId":id,"encodedDataLength":if created == 4 {MAX_BODY+1} else {50}}})
                            };
                            ws.send(Message::Text(event.to_string().into()))
                                .await
                                .unwrap();
                        }
                        ws.send(Message::Text(
                            json!({"sessionId":session,"method":"Page.loadEventFired","params":{}})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                    }
                    if closed == 7 {
                        return (created, closed, read, blocked);
                    }
                }
                panic!("detail target cleanup incomplete");
            });
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                .await
                .unwrap();
            let mut searches = search::Pages::new(true);
            for attempt in 1..=7 {
                let active = CancellationToken::new();
                let result = load_with_budget(
                    &mut cdp,
                    Request::new("123".into(), Some("note".into())).unwrap(),
                    true,
                    if attempt == 3 { &cancel } else { &active },
                    &mut searches,
                    Duration::from_millis(500),
                )
                .await;
                match attempt {
                    1 => assert!(
                        String::from_utf8(result.unwrap().body)
                            .unwrap()
                            .contains("aweme_detail")
                    ),
                    2 => assert!(
                        String::from_utf8(result.unwrap().body)
                            .unwrap()
                            .contains("metadata-only document")
                    ),
                    3 => assert!(result.unwrap_err().starts_with("operation-cancelled:")),
                    4 => assert!(result.unwrap_err().starts_with("limit-exceeded:")),
                    5 | 7 => assert!(result.unwrap_err().starts_with("request-timeout:")),
                    _ => assert!(result.unwrap_err().starts_with("network-error:")),
                }
            }
            assert_eq!(task.await.unwrap(), (7, 7, 5, 6));
            let already_cancelled = CancellationToken::new();
            already_cancelled.cancel();
            assert!(
                load(
                    &mut cdp,
                    Request::new("123".into(), None).unwrap(),
                    true,
                    &already_cancelled,
                    &mut searches
                )
                .await
                .unwrap_err()
                .starts_with("operation-cancelled:")
            );
        });
    }

    #[test]
    fn warm_player_routes_in_page_is_reused_and_falls_back_to_a_cold_target() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let (mut created, mut routes, mut navigations, mut closed) =
                    (0, 0, Vec::new(), Vec::new());
                while let Some(Ok(message)) = ws.next().await {
                    let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    let method = command["method"].as_str().unwrap();
                    let mut api = None;
                    let result = match method {
                        "Target.createTarget" => {
                            created += 1;
                            json!({"targetId":format!("target-{created}")})
                        }
                        "Target.attachToTarget" => {
                            json!({"sessionId":format!("session-{created}")})
                        }
                        "Network.enable" | "Page.enable" | "Fetch.enable" | "Fetch.failRequest" => {
                            json!({})
                        }
                        "Page.navigate" => {
                            navigations.push(command["params"]["url"].as_str().unwrap().to_owned());
                            if created == 2 {
                                api = Some(command["sessionId"].as_str().unwrap().to_owned());
                            }
                            json!({"frameId":"main"})
                        }
                        "Runtime.evaluate" => {
                            let expression = command["params"]["expression"].as_str().unwrap();
                            if expression.contains("routeDetail") {
                                routes += 1;
                                assert!(expression.ends_with(r#"("note","123")"#));
                                // Not hydrated, then routed; the reused page cannot revisit its route.
                                let value = match routes {
                                    1 => json!(false),
                                    2 => json!("routed"),
                                    _ => json!("unavailable"),
                                };
                                if routes == 2 {
                                    api = Some(command["sessionId"].as_str().unwrap().to_owned());
                                }
                                json!({"result":{"value":value}})
                            } else {
                                json!({"result":{"value":null}})
                            }
                        }
                        "Network.getResponseBody" => {
                            json!({"body":"{\"aweme_detail\":{\"aweme_id\":\"123\"}}","base64Encoded":false})
                        }
                        "Target.closeTarget" => {
                            closed.push(command["params"]["targetId"].as_str().unwrap().to_owned());
                            json!({"success":true})
                        }
                        other => panic!("unexpected player command {other}"),
                    };
                    ws.send(Message::Text(
                        json!({"id":command["id"],"result":result})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                    if let Some(session) = api {
                        for event in [
                            json!({"sessionId":session,"method":"Fetch.requestPaused","params":{"requestId":"cover"}}),
                            json!({"sessionId":session,"method":"Network.responseReceived","params":{"requestId":"detail","type":"XHR","response":{"url":"https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123","status":200}}}),
                            json!({"sessionId":session,"method":"Network.loadingFinished","params":{"requestId":"detail","encodedDataLength":50}}),
                        ] {
                            ws.send(Message::Text(event.to_string().into()))
                                .await
                                .unwrap();
                        }
                    }
                    if closed.len() == 2 {
                        return (created, routes, navigations, closed);
                    }
                }
                panic!("player cleanup incomplete");
            });
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                .await
                .unwrap();
            let mut searches = search::Pages::new(true);
            searches.warm_player(&mut cdp).await.unwrap();
            for _ in 0..2 {
                let packet = load_with_budget(
                    &mut cdp,
                    Request::new("123".into(), Some("note".into())).unwrap(),
                    true,
                    &CancellationToken::new(),
                    &mut searches,
                    Duration::from_secs(5),
                )
                .await
                .unwrap();
                assert!(
                    String::from_utf8(packet.body)
                        .unwrap()
                        .contains("aweme_detail")
                );
            }
            // The second read routed nothing new, closed the player and used one cold target.
            assert!(searches.take_player().is_none());
            let (created, routes, navigations, closed) = task.await.unwrap();
            assert_eq!(created, 2);
            assert_eq!(routes, 3);
            assert_eq!(
                navigations,
                [
                    "https://www.douyin.com/jingxuan",
                    "https://www.douyin.com/note/123"
                ]
            );
            assert_eq!(closed, ["target-1", "target-2"]);
        });
    }
}
