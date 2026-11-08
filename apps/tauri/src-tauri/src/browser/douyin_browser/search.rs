//! A listing owns a target and cursor chain; responses from other tabs/keywords are never reused.
mod cache;
mod scroll;
use super::{Packet, body, target};
use crate::browser::cdp::Cdp;
use cache::{MAX_BODY, ResponseCache};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Request {
    pub listing: String,
    pub query: String,
    pub offset: u64,
    pub(super) import: Option<super::import::Target>,
}
impl Request {
    pub fn new(listing: String, query: String, offset: u64) -> Result<Self, String> {
        crate::model::validate_id(&listing)?;
        let query = query.trim();
        if query.is_empty() || query.chars().take(201).count() > 200 || offset > 100000 {
            return Err("invalid-input:搜索关键词或游标无效。".into());
        }
        Ok(Self {
            listing,
            query: query.into(),
            offset,
            import: None,
        })
    }
    pub(super) fn for_import(
        listing: String,
        kind: &str,
        mix_id: Option<String>,
        cursor: u64,
    ) -> Result<Self, String> {
        crate::model::validate_id(&listing)?;
        if cursor > 9_007_199_254_740_991 {
            return Err("invalid-input:导入游标无效。".into());
        }
        Ok(Self {
            listing,
            query: String::new(),
            offset: cursor,
            import: Some(super::import::Target::new(kind, mix_id)?),
        })
    }
}
struct Page {
    target: String,
    session: String,
    query: String,
    import: Option<super::import::Target>,
    last_offset: Option<u64>,
    touched: Instant,
}
pub struct Pages {
    pages: HashMap<String, Page>,
    sessions: HashMap<String, String>,
    responses: ResponseCache,
    hidden: bool,
}
pub const HOME_URL: &str = "https://www.douyin.com/jingxuan";

#[derive(Clone, Copy)]
enum Progress {
    Controls,
    Clicked,
    Requested,
}
impl Progress {
    fn timeout_message(self) -> String {
        let reason = match self {
            Self::Controls => "搜索控件尚未就绪",
            Self::Clicked => "搜索尚未成功提交",
            Self::Requested => "搜索结果响应尚未完成",
        };
        format!("request-timeout:官方搜索页面加载超时（{reason}），请稍后重试。")
    }
}

fn submit_expression(query: &str) -> String {
    format!("({})({})", include_str!("submit-search.js"), json!(query))
}

/// Let the official homepage generate the result route and its per-search aid.
/// Call from the event loop so loading the homepage never discards captured responses.
pub async fn submit(cdp: &mut Cdp, session: &str, query: &str) -> Result<bool, String> {
    let ready = cdp.call(Some(session), "Runtime.evaluate", json!({"expression":include_str!("prepare-search.js"),"returnByValue":true,"userGesture":true})).await?;
    if ready.get("exceptionDetails").is_some() {
        return Err("invalid-response:无法操作官方搜索控件，请在账号浏览器中查看。".into());
    }
    if ready["result"]["value"] != true {
        return Ok(false);
    }
    cdp.call(Some(session), "Input.insertText", json!({"text":query}))
        .await?;
    let result = cdp
        .call(
            Some(session),
            "Runtime.evaluate",
            json!({"expression":submit_expression(query),"returnByValue":true,"awaitPromise":true,"userGesture":true}),
        )
        .await?;
    if result.get("exceptionDetails").is_some() {
        return Err("invalid-response:无法操作官方搜索控件，请在账号浏览器中查看。".into());
    }
    let point = &result["result"]["value"];
    let (Some(x), Some(y)) = (point["x"].as_f64(), point["y"].as_f64()) else {
        return Ok(false);
    };
    for action in ["mousePressed", "mouseReleased"] {
        cdp.call(
            Some(session),
            "Input.dispatchMouseEvent",
            json!({"type":action,"x":x,"y":y,"button":"left","clickCount":1}),
        )
        .await?;
    }
    Ok(true)
}
pub(super) fn response_cursor(params: &Value, query: &str) -> Option<u64> {
    if !matches!(params["type"].as_str(), Some("XHR" | "Fetch")) {
        return None;
    }
    let url = params["response"]["url"]
        .as_str()
        .and_then(|v| reqwest::Url::parse(v).ok())?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.douyin.com")
        || url.port_or_known_default() != Some(443)
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.path(),
            "/aweme/v1/web/general/search/stream/" | "/aweme/v1/web/general/search/single/"
        )
    {
        return None;
    }
    // Reject ambiguous identities instead of allocating a map and silently accepting
    // the last duplicate parameter. Each response must match one exact cursor.
    let mut keyword = None;
    let mut offset = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "keyword" if keyword.is_none() => keyword = Some(value),
            "offset" if offset.is_none() => offset = Some(value),
            "keyword" | "offset" => return None,
            _ => {}
        }
    }
    if keyword.as_deref()? != query {
        return None;
    }
    let offset = offset?;
    if offset.is_empty() || !offset.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    offset
        .parse::<u64>()
        .ok()
        .filter(|offset| *offset <= 100000)
}
impl Pages {
    #[cfg(test)]
    pub fn contains(&self, listing: &str) -> bool {
        self.pages.contains_key(listing)
    }
    /// Keep DTO parsing portable; only the owning official page can establish
    /// whether an ambiguous empty response coincides with a visible challenge.
    pub async fn report_failure(
        &self,
        cdp: &mut Cdp,
        listing: &str,
        code: &str,
    ) -> Result<Value, String> {
        let page = self
            .pages
            .get(listing)
            .ok_or("operation-cancelled:搜索列表已结束或账号环境已改变。")?;
        let status = if code == "pagination-unavailable" {
            let result = cdp
                .call(
                    Some(&page.session),
                    "Runtime.evaluate",
                    json!({"expression":include_str!("inspect-search-page.js"),"returnByValue":true}),
                )
                .await?;
            match result["result"]["value"].as_str() {
                Some("verification-required") => "verification-required",
                Some("login-required") => "not-authenticated",
                _ => "pagination-unavailable",
            }
        } else {
            code
        };
        if status == "not-authenticated" {
            let cookies = cdp.call(None, "Storage.getCookies", json!({})).await?;
            let error = super::projection::authentication_error(super::projection::has_login(
                &super::projection::cookie_store(&cookies)?,
            ));
            return Ok(json!(error.split(':').next().unwrap()));
        }
        Ok(json!(status))
    }
    pub fn new(hidden: bool) -> Self {
        Self {
            pages: HashMap::new(),
            sessions: HashMap::new(),
            responses: ResponseCache::default(),
            hidden,
        }
    }
    pub async fn close(&mut self, cdp: &mut Cdp, id: &str) {
        if let Some(page) = self.pages.remove(id) {
            self.sessions.remove(&page.session);
            self.responses.remove(id);
            let _ = cdp
                .call(None, "Target.closeTarget", json!({"targetId":page.target}))
                .await;
        }
    }
    pub async fn reap(&mut self, cdp: &mut Cdp) {
        let stale = self
            .pages
            .iter()
            .filter(|(_, page)| page.touched.elapsed() >= Duration::from_secs(120))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in stale {
            self.close(cdp, &id).await;
        }
    }
    /// The official client may preload the next cursor before the consumer asks for it.
    /// Keep those exact responses bounded and account/target/keyword scoped; never refetch
    /// a signed URL or serve one listing's cursor to another listing.
    pub async fn observe(&mut self, cdp: &mut Cdp, event: &Value) {
        let Some(id) = event["sessionId"]
            .as_str()
            .and_then(|session| self.sessions.get(session))
        else {
            return;
        };
        let params = &event["params"];
        let request_id = params["requestId"].as_str().unwrap_or("");
        let page = &self.pages[id];
        match event["method"].as_str() {
            Some("Network.requestWillBeSent") => {
                let request =
                    json!({"type":params["type"],"response":{"url":params["request"]["url"]}});
                let cursor = if let Some(target) = &page.import {
                    target.request_cursor(params)
                } else {
                    response_cursor(&request, &page.query)
                };
                if let Some(offset) = cursor {
                    self.responses.started(id, request_id, offset);
                }
            }
            Some("Network.responseReceived") => {
                let cursor = if let Some(target) = &page.import {
                    target
                        .matches_response(params)
                        .then(|| self.responses.request_cursor(id, request_id))
                        .flatten()
                } else {
                    response_cursor(params, &page.query)
                };
                if let Some(offset) = cursor
                    && let Some(status) = params["response"]["status"]
                        .as_u64()
                        .and_then(|status| u16::try_from(status).ok())
                {
                    self.responses.track(id, request_id, offset, status);
                }
            }
            Some("Network.loadingFailed") => {
                if let Some(offset) = self.responses.failed(id, request_id) {
                    self.responses.store(
                        id,
                        offset,
                        Err(
                            if params["errorText"].as_str().is_some_and(
                                crate::network::proxy_routing::is_browser_proxy_failure,
                            ) {
                                format!("network-error:{}", params["errorText"].as_str().unwrap())
                            } else {
                                "network-error:官方搜索请求失败，请重试。".into()
                            },
                        ),
                    );
                }
            }
            Some("Network.loadingFinished") => {
                let Some((offset, status)) = self.responses.finish(id, request_id) else {
                    return;
                };
                let result = if params["encodedDataLength"]
                    .as_u64()
                    .is_some_and(|v| v > MAX_BODY as u64)
                {
                    Err("limit-exceeded:搜索响应超过读取预算。".into())
                } else {
                    body(cdp, &page.session, request_id, MAX_BODY).await
                };
                self.responses
                    .store(id, offset, result.map(|body| Packet { status, body }));
            }
            _ => {}
        }
    }
    pub async fn load(
        &mut self,
        cdp: &mut Cdp,
        request: Request,
        cancel: &CancellationToken,
    ) -> Result<Packet, String> {
        if cancel.is_cancelled() {
            return Err("operation-cancelled:搜索已取消。".into());
        }
        self.reap(cdp).await;
        if !self.pages.contains_key(&request.listing) {
            if self.pages.len() >= 8 {
                return Err("limit-exceeded:此账号打开的搜索列表过多，请关闭旧列表。".into());
            }
            if request.offset != 0 {
                return Err("pagination-unavailable:搜索会话已结束，请从第一页重新搜索。".into());
            }
            let (target, session) = target(cdp, self.hidden).await?;
            self.sessions
                .insert(session.clone(), request.listing.clone());
            if request.import.is_some() {
                self.responses.register_import(&request.listing);
            } else {
                self.responses.register(&request.listing);
            }
            self.pages.insert(
                request.listing.clone(),
                Page {
                    target,
                    session,
                    query: request.query.clone(),
                    import: request.import.clone(),
                    last_offset: None,
                    touched: Instant::now(),
                },
            );
        }
        let page = self.pages.get_mut(&request.listing).unwrap();
        if page.query != request.query
            || page.import != request.import
            || self.responses.consumed(&request.listing, request.offset)
            || page.last_offset.is_some_and(|offset| {
                if request.import.is_some() {
                    request.offset == offset
                } else {
                    request.offset <= offset
                }
            })
        {
            return Err("invalid-input:搜索列表关键词或游标不匹配。".into());
        }
        page.touched = Instant::now();
        let session = page.session.clone();
        let first = page.last_offset.is_none();
        let mut progress = if first {
            Progress::Controls
        } else {
            Progress::Requested
        };
        let work = async {
            if first {
                let url = request
                    .import
                    .as_ref()
                    .map_or_else(|| HOME_URL.into(), super::import::Target::url);
                cdp.call(Some(&session), "Page.navigate", json!({"url":url}))
                    .await?;
            }
            let mut submitted = !first || request.import.is_some();
            let mut scroller = scroll::Scroller::new();
            let scroll_timer = tokio::time::sleep(scroller.initial_delay());
            tokio::pin!(scroll_timer);
            // Poll controls quickly only until one successful click. This adds no
            // search requests and avoids a full second of idle readiness latency.
            let mut inspect = tokio::time::interval(if first {
                Duration::from_millis(250)
            } else {
                Duration::from_secs(1)
            });
            inspect.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                if cancel.is_cancelled() {
                    return Err("operation-cancelled:搜索已取消。".into());
                }
                if let Some(result) = self.responses.take(&request.listing, request.offset) {
                    if request.import.is_some()
                        && let Ok(packet) = &result
                    {
                        super::detail::validate_authentication(cdp, packet).await?;
                    }
                    return result;
                }
                tokio::select! {
                    // Process an arrived response/cancellation before another wheel input.
                    biased;
                    _=cancel.cancelled()=>return Err("operation-cancelled:搜索已取消。".into()),
                    event=cdp.events.recv()=>{
                        let Some(event)=event else{return Err("network-error:账号浏览器连接中断。".into())};
                        if event["sessionId"] == session {
                            let params = match event["method"].as_str() {
                                Some("Network.requestWillBeSent") => json!({"type":event["params"]["type"],"response":{"url":event["params"]["request"]["url"]}}),
                                Some("Network.responseReceived") => event["params"].clone(),
                                _ => Value::Null,
                            };
                            if response_cursor(&params, &request.query) == Some(request.offset) {
                                progress = Progress::Requested;
                            }
                        }
                        if cancel.is_cancelled() {
                            return Err("operation-cancelled:搜索已取消。".into());
                        }
                        self.observe(cdp,&event).await;
                    }
                    _=inspect.tick()=>{
                        let result = cdp.call(Some(&session), "Runtime.evaluate", json!({"expression":include_str!("inspect-search-page.js"),"returnByValue":true})).await?;
                        match result["result"]["value"].as_str() {
                            Some("verification-required") => return Err("verification-required:抖音搜索需要完成安全验证，请点击验证。".into()),
                            Some("login-required") => {
                                let cookies = cdp.call(None, "Storage.getCookies", json!({})).await?;
                                return Err(super::projection::authentication_error(super::projection::has_login(&super::projection::cookie_store(&cookies)?)));
                            },
                            _ => {},
                        }
                        if !submitted {
                            submitted = submit(cdp, &session, &request.query).await?;
                            if submitted {
                                progress = Progress::Clicked;
                                inspect = tokio::time::interval(Duration::from_secs(1));
                                inspect.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                                inspect.reset();
                            }
                        }
                    }
                    _=&mut scroll_timer,if !first && !self.responses.pending(&request.listing, request.offset)=>{
                        // No page-side timers: a completed/cancelled read drops the entire burst.
                        let delay = scroller.advance(cdp, &session).await?;
                        scroll_timer.as_mut().reset(tokio::time::Instant::now() + delay);
                    }
                }
            }
        };
        let result = tokio::select! {biased; _=cancel.cancelled()=>Err("operation-cancelled:列表读取已取消。".into()),result=tokio::time::timeout(Duration::from_secs(18),work)=>result.map_err(|_| if request.import.is_some() { "request-timeout:官方抖音导入页面加载超时，请稍后重试。".into() } else { progress.timeout_message() }).and_then(|v|v)};
        if result.is_ok() {
            self.pages.get_mut(&request.listing).unwrap().last_offset = Some(request.offset);
        } else {
            self.close(cdp, &request.listing).await;
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    #[test]
    fn empty_page_diagnostics_inspect_only_the_owned_target_without_replaying_search() {
        tauri::async_runtime::block_on(async {
            for (signal, has_login, expected) in [
                (None, false, "pagination-unavailable"),
                (Some("verification-required"), true, "verification-required"),
                (Some("login-required"), true, "verification-required"),
                (Some("login-required"), false, "not-authenticated"),
            ] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let server = tauri::async_runtime::spawn(async move {
                    let (stream, _) = listener.accept().await.unwrap();
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    let mut methods = Vec::new();
                    while let Some(Ok(message)) = ws.next().await {
                        let command: Value =
                            serde_json::from_str(message.to_text().unwrap()).unwrap();
                        let method = command["method"].as_str().unwrap();
                        methods.push(method.to_owned());
                        let result = match method {
                            "Runtime.evaluate" => {
                                assert_eq!(command["sessionId"], "owned-session");
                                assert_eq!(
                                    command["params"]["expression"],
                                    include_str!("inspect-search-page.js")
                                );
                                json!({"result":{"value":signal}})
                            }
                            "Storage.getCookies" => json!({"cookies":if has_login {
                                vec![json!({"name":"sessionid","value":"fixture","domain":".douyin.com","path":"/","secure":true,"httpOnly":true})]
                            } else { vec![] }}),
                            "Target.closeTarget" => {
                                assert_eq!(command["params"]["targetId"], "owned-target");
                                json!({})
                            }
                            _ => panic!(
                                "diagnostics must not navigate, scroll or request data: {method}"
                            ),
                        };
                        ws.send(Message::Text(
                            json!({"id":command["id"],"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        if method == "Target.closeTarget" {
                            break;
                        }
                    }
                    methods
                });
                let cancel = CancellationToken::new();
                let mut cdp = Cdp::connect(&format!("ws://{address}"), &cancel)
                    .await
                    .unwrap();
                let mut pages = Pages::new(true);
                pages.pages.insert(
                    "owned".into(),
                    Page {
                        target: "owned-target".into(),
                        session: "owned-session".into(),
                        query: "music".into(),
                        import: None,
                        last_offset: Some(70),
                        touched: Instant::now(),
                    },
                );
                assert!(
                    pages
                        .report_failure(&mut cdp, "other", "pagination-unavailable")
                        .await
                        .unwrap_err()
                        .starts_with("operation-cancelled:")
                );
                assert_eq!(
                    pages
                        .report_failure(&mut cdp, "owned", "pagination-unavailable")
                        .await
                        .unwrap(),
                    expected
                );
                pages.close(&mut cdp, "owned").await;
                let mut methods = vec!["Runtime.evaluate"];
                if signal == Some("login-required") {
                    methods.push("Storage.getCookies");
                }
                methods.push("Target.closeTarget");
                assert_eq!(server.await.unwrap(), methods);
                cancel.cancel();
            }
        });
    }
    #[test]
    fn import_targets_capture_exact_get_or_post_cursors_and_clean_up_without_signed_replay() {
        tauri::async_runtime::block_on(async {
            for (kind, mix_id, path, method, query) in [
                ("self-history", None, "history/read", "GET", "max_cursor="),
                (
                    "self-favorites",
                    None,
                    "aweme/favorite",
                    "GET",
                    "sec_user_id=self&max_cursor=",
                ),
                (
                    "self-collected-videos",
                    None,
                    "aweme/listcollection",
                    "POST",
                    "",
                ),
                (
                    "self-collected-mixes",
                    None,
                    "mix/listcollection",
                    "GET",
                    "cursor=",
                ),
                (
                    "mix",
                    Some("123".into()),
                    "mix/aweme",
                    "GET",
                    "mix_id=123&cursor=",
                ),
            ] {
                let request =
                    Request::for_import(uuid::Uuid::new_v4().to_string(), kind, mix_id, 0).unwrap();
                let route = request.import.as_ref().unwrap().url();
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let task = tauri::async_runtime::spawn(async move {
                    let (stream, _) = listener.accept().await.unwrap();
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    let mut reads = 0;
                    let mut wheels = 0;
                    while let Some(Ok(message)) = ws.next().await {
                        let command: Value =
                            serde_json::from_str(message.to_text().unwrap()).unwrap();
                        let action = command["method"].as_str().unwrap();
                        let result = match action {
                            "Target.createTarget" => json!({"targetId":"import-target"}),
                            "Target.attachToTarget" => json!({"sessionId":"import-session"}),
                            "Network.enable" | "Page.enable" => json!({}),
                            "Page.navigate" => {
                                assert_eq!(command["params"]["url"], route);
                                json!({"frameId":"main"})
                            }
                            "Runtime.evaluate" => {
                                json!({"result":{"value":{"x":500,"y":400,"viewportHeight":800,"remaining":800}}})
                            }
                            "Input.dispatchMouseEvent" => {
                                wheels += 1;
                                json!({})
                            }
                            "Network.getResponseBody" => {
                                reads += 1;
                                assert_eq!(
                                    command["params"]["requestId"],
                                    format!("wanted-{reads}")
                                );
                                json!({"body":"{\"status_code\":0,\"aweme_list\":[]}","base64Encoded":false})
                            }
                            "Target.closeTarget" => json!({"success":true}),
                            other => panic!("unexpected import command {other}"),
                        };
                        ws.send(Message::Text(
                            json!({"id":command["id"],"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        if action == "Target.closeTarget" {
                            return (reads, wheels);
                        }
                        if action != "Page.navigate"
                            && !(action == "Input.dispatchMouseEvent"
                                && wheels <= if kind == "self-history" { 2 } else { 1 })
                        {
                            continue;
                        }
                        let cursor: u64 = if action == "Page.navigate" {
                            0
                        } else if kind == "self-history" {
                            if wheels == 1 {
                                1723456789123
                            } else {
                                1723456789000
                            }
                        } else {
                            18
                        };
                        let url = format!(
                            "https://www-hj.douyin.com/aweme/v1/web/{path}/?{query}{}",
                            if method == "GET" {
                                cursor.to_string()
                            } else {
                                String::new()
                            }
                        );
                        for (session, id) in [
                            ("other-account", "noise"),
                            ("import-session", "wanted"),
                            ("import-session", "duplicate"),
                        ] {
                            let id = format!("{id}-{}", wheels + 1);
                            for event in [
                                json!({"sessionId":session,"method":"Network.requestWillBeSent","params":{"requestId":id,"type":"Fetch","request":{"url":url,"method":method,"postData":format!("cursor={cursor}&count=18")}}}),
                                json!({"sessionId":session,"method":"Network.responseReceived","params":{"requestId":id,"type":"Fetch","response":{"url":url,"status":200}}}),
                                json!({"sessionId":session,"method":"Network.loadingFinished","params":{"requestId":id,"encodedDataLength":50}}),
                            ] {
                                ws.send(Message::Text(event.to_string().into()))
                                    .await
                                    .unwrap();
                            }
                        }
                    }
                    panic!("import target was not closed");
                });
                let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                    .await
                    .unwrap();
                let mut pages = Pages::new(true);
                let token = CancellationToken::new();
                assert_eq!(
                    pages
                        .load(&mut cdp, request.clone(), &token)
                        .await
                        .unwrap()
                        .status,
                    200
                );
                let mut next = request.clone();
                next.offset = if kind == "self-history" {
                    1723456789123
                } else {
                    18
                };
                assert_eq!(
                    pages
                        .load(&mut cdp, next.clone(), &token)
                        .await
                        .unwrap()
                        .status,
                    200
                );
                assert!(
                    pages
                        .load(&mut cdp, next.clone(), &token)
                        .await
                        .unwrap_err()
                        .starts_with("invalid-input:")
                );
                if kind == "self-history" {
                    // The third page's timestamp decreases; account/session and request ID stay exact.
                    next.offset = 1723456789000;
                    assert_eq!(
                        pages.load(&mut cdp, next, &token).await.unwrap().status,
                        200
                    );
                }
                token.cancel();
                assert!(
                    pages
                        .load(&mut cdp, request.clone(), &token)
                        .await
                        .unwrap_err()
                        .starts_with("operation-cancelled:")
                );
                pages.close(&mut cdp, &request.listing).await;
                assert!(!pages.contains(&request.listing));
                assert_eq!(
                    task.await.unwrap(),
                    if kind == "self-history" {
                        (3, 2)
                    } else {
                        (2, 1)
                    }
                );
            }
        });
    }
    #[test]
    fn response_requires_exact_origin_keyword_cursor_and_data_type() {
        let request =
            Request::new(uuid::Uuid::new_v4().to_string(), "中文 & 空格".into(), 10).unwrap();
        let mut url =
            reqwest::Url::parse("https://www.douyin.com/aweme/v1/web/general/search/stream/")
                .unwrap();
        url.query_pairs_mut()
            .append_pair("keyword", &request.query)
            .append_pair("offset", "10");
        let value = json!({"type":"Fetch","response":{"url":url.as_str()}});
        assert_eq!(response_cursor(&value, &request.query), Some(10));
        assert_eq!(
            response_cursor(
                &json!({"type":"Fetch","response":{"url":url.to_string().replace("/stream/", "/single/")}}),
                &request.query
            ),
            Some(10)
        );
        for (kind, url) in [
            ("Preflight", url.to_string()),
            (
                "Fetch",
                url.to_string()
                    .replace("www.douyin.com", "www.douyin.com.evil"),
            ),
            ("Fetch", url.to_string().replace("offset=10", "offset=bad")),
            (
                "Fetch",
                url.to_string().replace("keyword=", "keyword=other"),
            ),
        ] {
            assert_eq!(
                response_cursor(&json!({"type":kind,"response":{"url":url}}), &request.query),
                None
            );
        }
        for suffix in ["&keyword=other", "&offset=20", "#ignored"] {
            assert_eq!(
                response_cursor(
                    &json!({"type":"Fetch","response":{"url":format!("{url}{suffix}")}}),
                    &request.query
                ),
                None
            );
        }
        for changed in [
            url.to_string()
                .replace("www.douyin.com", "www.douyin.com:444"),
            url.to_string().replace("offset=10", "offset=%2B10"),
        ] {
            assert_eq!(
                response_cursor(
                    &json!({"type":"Fetch","response":{"url":changed}}),
                    &request.query
                ),
                None
            );
        }
    }
    #[test]
    fn login_panels_require_same_browser_credentials_and_close_the_failed_target_once() {
        tauri::async_runtime::block_on(async {
            for has_login in [true, false] {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let task = tauri::async_runtime::spawn(async move {
                    let (stream, _) = listener.accept().await.unwrap();
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    let mut cookie_reads = 0;
                    loop {
                        let message = ws.next().await.unwrap().unwrap();
                        let command: Value =
                            serde_json::from_str(message.to_text().unwrap()).unwrap();
                        let method = command["method"].as_str().unwrap();
                        let result = match method {
                            "Target.createTarget" => json!({"targetId":"target"}),
                            "Target.attachToTarget" => json!({"sessionId":"page"}),
                            "Network.enable" | "Page.enable" | "Page.navigate" => json!({}),
                            "Runtime.evaluate" => {
                                assert_eq!(
                                    command["params"]["expression"],
                                    include_str!("inspect-search-page.js")
                                );
                                json!({"result":{"value":"login-required"}})
                            }
                            "Storage.getCookies" => {
                                cookie_reads += 1;
                                json!({"cookies": if has_login { vec![json!({"name":"sessionid","value":"fixture","domain":".douyin.com","path":"/","httpOnly":true})] } else { vec![] }})
                            }
                            "Target.closeTarget" => json!({"success":true}),
                            other => {
                                panic!("a login panel must stop before search submission: {other}")
                            }
                        };
                        ws.send(Message::Text(
                            json!({"id":command["id"],"result":result})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                        if method == "Target.closeTarget" {
                            return cookie_reads;
                        }
                    }
                });
                let mut cdp = Cdp::connect(&format!("ws://{address}"), &CancellationToken::new())
                    .await
                    .unwrap();
                let mut pages = Pages::new(true);
                let id = uuid::Uuid::new_v4().to_string();
                let error = pages
                    .load(
                        &mut cdp,
                        Request::new(id.clone(), "音乐".into(), 0).unwrap(),
                        &CancellationToken::new(),
                    )
                    .await
                    .unwrap_err();
                assert!(error.starts_with(if has_login {
                    "verification-required:"
                } else {
                    "not-authenticated:"
                }));
                assert!(!pages.contains(&id));
                assert_eq!(task.await.unwrap(), 1);
            }
        });
    }
    #[test]
    fn listing_targets_are_lazy_independent_and_read_only_the_requested_response() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let pending_cancel = CancellationToken::new();
            let cancel_on_scroll = pending_cancel.clone();
            let task = tauri::async_runtime::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let mut created = 0;
                let mut navigated = 0;
                let mut submitted = 0;
                let mut submit_attempts = 0;
                let mut scrolled = 0;
                let mut read = 0;
                let mut closed = 0;
                while let Some(Ok(message)) = ws.next().await {
                    if !message.is_text() {
                        continue;
                    }
                    let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
                    let method = command["method"].as_str().unwrap();
                    let mut result = json!({});
                    let mut response = None;
                    match method {
                        "Target.createTarget" => {
                            created += 1;
                            assert_eq!(command["params"]["hidden"], true);
                            result = json!({"targetId":format!("target-{created}")});
                        }
                        "Target.attachToTarget" => {
                            result = json!({"sessionId":command["params"]["targetId"].as_str().unwrap().replace("target", "session")});
                        }
                        "Page.navigate" => {
                            navigated += 1;
                            let url =
                                reqwest::Url::parse(command["params"]["url"].as_str().unwrap())
                                    .unwrap();
                            assert_eq!(url.path(), "/jingxuan");
                            assert_eq!(url.scheme(), "https");
                            assert_eq!(url.host_str(), Some("www.douyin.com"));
                            assert_eq!(url.query(), None);
                        }
                        "Runtime.evaluate" => {
                            if command["params"]["expression"] == include_str!("scroll-page.js") {
                                result = json!({"result":{"value":{"x":500,"y":400,"viewportHeight":800,"remaining":1000}}});
                            } else if command["params"]["expression"]
                                == include_str!("prepare-search.js")
                            {
                                assert_eq!(command["params"]["userGesture"], true);
                                result = json!({"result":{"value":true}});
                            } else if command["params"]["expression"] == submit_expression("测试")
                            {
                                assert_eq!(command["params"]["awaitPromise"], true);
                                assert_eq!(command["params"]["userGesture"], true);
                                submit_attempts += 1;
                                if submit_attempts == 1 {
                                    // Homepage controls are not ready on the first inspection.
                                    result = json!({"result":{"value":false}});
                                } else {
                                    result = json!({"result":{"value":{"x":20,"y":30}}});
                                }
                            } else {
                                assert_eq!(
                                    command["params"]["expression"],
                                    include_str!("inspect-search-page.js")
                                );
                                result = json!({"result":{"value":null}});
                            }
                        }
                        "Input.insertText" => {
                            assert_eq!(command["params"]["text"], "测试");
                        }
                        "Input.dispatchMouseEvent" => {
                            if command["params"]["type"] == "mouseWheel" {
                                assert_eq!(command["params"]["x"], 500.0);
                                assert_eq!(command["params"]["y"], 400.0);
                                assert_eq!(command["params"]["deltaX"], 0);
                                let delta = command["params"]["deltaY"].as_f64().unwrap();
                                assert!(delta > 0.0 && delta <= 45.0);
                                scrolled += 1;
                                if scrolled == 2 {
                                    cancel_on_scroll.cancel();
                                    response = Some(20);
                                } else {
                                    response = Some(10);
                                }
                            } else {
                                assert_eq!(command["params"]["button"], "left");
                                assert_eq!(command["params"]["clickCount"], 1);
                                assert_eq!(command["params"]["x"], 20.0);
                                assert_eq!(command["params"]["y"], 30.0);
                                if command["params"]["type"] == "mouseReleased" {
                                    submitted += 1;
                                    assert_eq!(submitted, navigated);
                                    response = Some(0);
                                } else {
                                    assert_eq!(command["params"]["type"], "mousePressed");
                                }
                            }
                        }
                        "Network.getResponseBody" => {
                            read += 1;
                            let id = command["params"]["requestId"].as_str().unwrap();
                            assert!(id.starts_with("wanted-"));
                            result = json!({"body":if id == "wanted-10" {"9\n{\"next\":1}"} else {"8\n{\"ok\":1}"},"base64Encoded":false});
                        }
                        "Target.closeTarget" => {
                            closed += 1;
                            result = json!({"success":true});
                        }
                        "Network.enable" | "Page.enable" => {}
                        _ => panic!(
                            "search must only navigate/scroll/observe official pages: {method}"
                        ),
                    }
                    ws.send(Message::Text(
                        json!({"id":command["id"],"result":result})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                    if let Some(offset) = response {
                        let session = command["sessionId"].as_str().unwrap();
                        let offsets = if navigated == 1 {
                            vec![offset, 10]
                        } else {
                            vec![offset]
                        };
                        for offset in offsets {
                            let endpoint = if offset == 0 { "stream" } else { "single" };
                            let url = format!(
                                "https://www.douyin.com/aweme/v1/web/general/search/{endpoint}/?keyword=%E6%B5%8B%E8%AF%95&offset={offset}"
                            );
                            // Another account and an unrelated keyword cannot win.
                            for (sid, request, address) in [
                                ("another-account", "noise".to_string(), url.clone()),
                                (
                                    session,
                                    "noise".to_string(),
                                    url.replace("keyword=", "keyword=wrong"),
                                ),
                                (session, format!("wanted-{offset}"), url),
                            ] {
                                ws.send(Message::Text(json!({"sessionId":sid,"method":"Network.requestWillBeSent","params":{"requestId":request,"type":"Fetch","request":{"url":address}}}).to_string().into())).await.unwrap();
                                if method == "Input.dispatchMouseEvent"
                                    && offset == 10
                                    && sid == session
                                    && request.starts_with("wanted-")
                                {
                                    // More than several wheel intervals without headers/body.
                                    // Exactly one wheel must suffice once the official request starts.
                                    tokio::time::sleep(Duration::from_millis(180)).await;
                                }
                                ws.send(Message::Text(json!({"sessionId":sid,"method":"Network.responseReceived","params":{"requestId":request,"type":"Fetch","response":{"url":address,"status":200}}}).to_string().into())).await.unwrap();
                                ws.send(Message::Text(json!({"sessionId":sid,"method":"Network.loadingFinished","params":{"requestId":request,"encodedDataLength":10}}).to_string().into())).await.unwrap();
                            }
                        }
                    }
                    if closed == 2 {
                        break;
                    }
                }
                (
                    created,
                    navigated,
                    submit_attempts,
                    submitted,
                    scrolled,
                    read,
                    closed,
                )
            });
            let stop = CancellationToken::new();
            let mut cdp = Cdp::connect(&format!("ws://{address}"), &stop)
                .await
                .unwrap();
            let mut pages = Pages::new(true);
            let a = uuid::Uuid::new_v4().to_string();
            let b = uuid::Uuid::new_v4().to_string();
            let cancelled = CancellationToken::new();
            cancelled.cancel();
            assert!(
                pages
                    .load(
                        &mut cdp,
                        Request::new(a.clone(), "测试".into(), 0).unwrap(),
                        &cancelled
                    )
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
            assert!(pages.pages.is_empty());
            for (id, offset) in [(&a, 0), (&b, 0), (&a, 10), (&b, 10)] {
                let response = pages
                    .load(
                        &mut cdp,
                        Request::new(id.clone(), "测试".into(), offset).unwrap(),
                        &stop,
                    )
                    .await
                    .unwrap();
                let expected: &[u8] = if offset == 10 {
                    b"9\n{\"next\":1}"
                } else {
                    b"8\n{\"ok\":1}"
                };
                assert_eq!(response.body, expected);
                if id == &a && offset == 0 {
                    // Model the actor while the UI is idle: retain official preloading,
                    // but do not scroll or deliver the next page before consumer demand.
                    tokio::time::timeout(Duration::from_secs(2), async {
                        while !pages.responses.contains(&a, 10) {
                            let event = cdp.events.recv().await.unwrap();
                            pages.observe(&mut cdp, &event).await;
                        }
                    })
                    .await
                    .unwrap();
                }
            }
            assert_eq!(pages.pages.len(), 2);
            assert_ne!(pages.pages[&a].session, pages.pages[&b].session);
            pages.close(&mut cdp, &a).await;
            assert_eq!(pages.pages.len(), 1);
            assert!(
                pages
                    .load(
                        &mut cdp,
                        Request::new(b.clone(), "测试".into(), 20).unwrap(),
                        &pending_cancel
                    )
                    .await
                    .unwrap_err()
                    .starts_with("operation-cancelled:")
            );
            assert!(pages.pages.is_empty());
            pages.close(&mut cdp, &b).await;
            assert_eq!(task.await.unwrap(), (2, 2, 3, 2, 2, 4, 2));
        });
    }
}
