use crate::{
    browser::verification::require_main,
    model::{HttpRequest, classify, validate_public_url},
    state::RuntimeState,
};
use futures_util::StreamExt;
use std::time::Duration;
use tauri::{State, WebviewWindow};
use tokio_util::sync::CancellationToken;

mod response;
use response::HttpResponse;

pub fn anonymous_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|_| "network-error:无法创建匿名请求。".into())
}
pub fn apply_headers(
    mut request: reqwest::RequestBuilder,
    headers: Option<&std::collections::HashMap<String, String>>,
) -> Result<reqwest::RequestBuilder, String> {
    if let Some(headers) = headers {
        for (key, value) in headers {
            if [
                "cookie",
                "authorization",
                "proxy-authorization",
                "host",
                "set-cookie",
            ]
            .iter()
            .any(|blocked| key.eq_ignore_ascii_case(blocked))
            {
                return Err("invalid-input:请求头不能携带凭证。".into());
            }
            request = request.header(key, value);
        }
    }
    Ok(request)
}

fn response_headers(headers: &reqwest::header::HeaderMap) -> String {
    use std::fmt::Write;
    let mut result = String::new();
    for (name, value) in headers {
        if name == reqwest::header::SET_COOKIE {
            continue;
        }
        if !result.is_empty() {
            result.push_str("\r\n");
        }
        // Write directly into the IPC header string, preserving duplicates and iteration order.
        write!(&mut result, "{name}: {}", value.to_str().unwrap_or(""))
            .expect("writing to a String cannot fail");
    }
    result
}

fn require_http_route(url: &reqwest::Url) -> Result<(), String> {
    let douyin = url
        .host_str()
        .is_some_and(|host| host == "douyin.com" || host.ends_with(".douyin.com"));
    if douyin
        && url.path().starts_with("/aweme/v1/web/")
        && url
            .path_segments()
            .is_some_and(|mut segments| segments.any(|part| part == "search"))
    {
        // Search signing and pagination belong to the official page, even if a stale renderer
        // accidentally calls the general HTTP port. Never send or replay its signed search URL.
        return Err("invalid-input:抖音搜索必须通过账号 CDP 页面执行，请重新搜索。".into());
    }
    Ok(())
}

async fn execute(
    state: &RuntimeState,
    input: &HttpRequest,
    cancellation: &CancellationToken,
) -> Result<HttpResponse, String> {
    let url = validate_public_url(&input.url)?;
    if input.credentials.as_deref() != Some("include") {
        require_anonymous_grant(&url, *state.media_port.lock().unwrap())?;
    }
    require_http_route(&url)?;
    let _usage = if input.credentials.as_deref() == Some("include") {
        input
            .account_id
            .as_deref()
            .map(|id| state.use_account(id, "请求数据"))
            .transpose()?
    } else {
        None
    };
    let session = if input.credentials.as_deref() == Some("include") {
        let id = input
            .account_id
            .as_deref()
            .ok_or("account-unavailable:缺少账号请求上下文。")?;
        let account = state.account(id)?;
        if !account.enabled {
            return Err("operation-cancelled:账号已停用。".into());
        }
        if let Some(error) = account.content_error()
            && !crate::accounts::session::is_identity_probe(&account, input, &url)
        {
            return Err(error.into());
        }
        Some(state.session(id)?)
    } else {
        None
    };
    let owned_session = session.clone();
    let _permit = if let Some(session) = &session {
        Some(tokio::select! {
            _ = cancellation.cancelled() => return Err("operation-cancelled:请求已中止。".into()),
            _ = session.cancelled.cancelled() => return Err("operation-cancelled:账号环境已释放。".into()),
            permit = session.queue.acquire() => permit.map_err(|_| "operation-cancelled:账号队列已关闭。")?,
        })
    } else {
        None
    };
    if let Some(session) = &session {
        if session.cancelled.is_cancelled() {
            return Err("operation-cancelled:账号环境已更改。".into());
        }
        let id = input.account_id.as_ref().unwrap();
        let current = state.account(id)?;
        if let Some(error) = current.content_error()
            && !crate::accounts::session::is_identity_probe(&current, input, &url)
        {
            return Err(error.into());
        }
        let failures = *session.failures.lock().unwrap();
        let delay = if failures == 0 {
            80
        } else {
            (250_u64 << failures.min(5)).min(8000)
        } + u64::from(rand::random::<u8>());
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
    let client = match &session {
        Some(session) => session.client.clone(),
        None => anonymous_client()?,
    };
    let method = input
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .map_err(|_| "invalid-input:无效请求方法。")?;
    if ![
        reqwest::Method::GET,
        reqwest::Method::POST,
        reqwest::Method::PUT,
        reqwest::Method::PATCH,
        reqwest::Method::DELETE,
    ]
    .contains(&method)
    {
        return Err("invalid-input:不支持的请求方法。".into());
    }
    if let Some(body) = &input.body
        && body.len() > 16 * 1024 * 1024
    {
        return Err("limit-exceeded:请求体超过预算。".into());
    }
    let build = |client: reqwest::Client| {
        let mut request = apply_headers(
            client.request(method.clone(), url.clone()),
            input.headers.as_ref(),
        )?;
        if let Some(body) = &input.body {
            request = request.body(body.clone());
        }
        Ok(request)
    };
    let work = async {
        let response = if let Some(session) = &session {
            let account = state.account(input.account_id.as_ref().unwrap())?;
            state
                .send_routed(
                    &account,
                    session,
                    build,
                    method == reqwest::Method::GET,
                    Duration::from_millis(input.timeout_ms.unwrap_or(30_000).clamp(100, 120_000)),
                    cancellation,
                )
                .await?
        } else {
            build(client)?
                .send()
                .await
                .map_err(|_| "network-error:无法连接音乐源。".to_string())?
        };
        let status = response.status();
        let final_url = response.url().clone();
        let headers = response_headers(response.headers());
        let limit = input
            .max_response_bytes
            .unwrap_or(16 * 1024 * 1024)
            .min(512 * 1024 * 1024);
        let retry_url = if final_url.host_str() == Some("127.0.0.1")
            && final_url.path().starts_with("/media/")
        {
            response
                .headers()
                .get("x-any-music-retry-url")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        } else {
            None
        };
        let over_budget = || {
            format!(
                "response-too-large:{}",
                serde_json::json!({"maxResponseBytes":limit,"finalUrl":retry_url})
            )
        };
        if response.content_length().is_some_and(|v| v > limit as u64) {
            return Err(over_budget());
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "network-error:媒体读取中断。")?;
            if bytes.len() + chunk.len() > limit {
                return Err(over_budget());
            }
            bytes.extend_from_slice(&chunk);
        }
        if let Some(id) = &input.account_id
            && session.is_some()
        {
            let text = String::from_utf8_lossy(&bytes);
            let account = state.account(id)?;
            let classification = classify(&account.platform_id, status.as_u16(), &text);
            if classification != "ready"
                && !(classification == "expired" && account.authentication == "anonymous")
            {
                state.status(id, classification)?;
                // Identity probes keep the official expired envelope so the portable nav
                // adapter can report not-authenticated instead of wrapping a transport error.
                if classification != "expired"
                    || !crate::accounts::session::is_identity_probe(&account, input, &url)
                {
                    return Err(format!(
                        "{classification}:账号需要登录或验证，请完成后重试。"
                    ));
                }
            }
            if account.authentication == "credential" {
                state.save_credentials(id)?;
            }
            if crate::accounts::session::is_identity_probe(&account, input, &url)
                && final_url == url
                && let Some(next) =
                    crate::accounts::session::identity_status(&account, status.as_u16(), &text)
            {
                if next == "ready" {
                    let value: serde_json::Value =
                        serde_json::from_str(&text).map_err(|_| "账号身份响应无效。")?;
                    let user = if account.platform_id == "netease" {
                        crate::accounts::netease_login::identity(&value)
                            .ok_or("平台未返回有效用户身份。")?
                    } else {
                        value["data"]["mid"]
                            .as_u64()
                            .ok_or("平台未返回用户 ID。")?
                            .to_string()
                    };
                    crate::accounts::session::confirm_identity(state, id, &user)?;
                } else if next == "signed-out" {
                    state.mutate(|snapshot| {
                        let account = snapshot
                            .accounts
                            .iter_mut()
                            .find(|account| account.id == *id)
                            .ok_or("账号不存在。")?;
                        account.set_status("signed-out");
                        // Anonymous browsing remains permitted, independently of the observed login fact.
                        account.resume_after_login();
                        Ok(())
                    })?;
                } else {
                    state.status(id, next)?;
                }
            }
            if final_url.host_str() != validate_public_url(&input.url)?.host_str()
                && final_url.path().contains("login")
            {
                state.status(id, "expired")?;
                return Err("not-authenticated:请求被重定向到登录页面。".into());
            }
        }
        Ok(HttpResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").into(),
            headers,
            body: bytes,
            is_binary: input.response_type.as_deref() == Some("bytes"),
        })
    };
    let expiry = session
        .as_ref()
        .map(|s| s.cancelled.clone())
        .unwrap_or_default();
    let result = tokio::select! {
        _ = cancellation.cancelled() => Err("operation-cancelled:请求已中止。".into()),
        _ = expiry.cancelled() => Err("operation-cancelled:账号环境已释放。".into()),
        result = tokio::time::timeout(Duration::from_millis(input.timeout_ms.unwrap_or(30_000).clamp(100,120_000)), work) => result.unwrap_or_else(|_|Err("request-timeout:请求超时。".into())),
    };
    if let Some(session) = owned_session {
        let mut count = session.failures.lock().unwrap();
        match &result {
            Ok(_) => {
                *count = 0;
            }
            Err(error)
                if error.starts_with("network-error:") || error.starts_with("request-timeout:") =>
            {
                *count += 1;
                // Connection failures do not establish an authentication challenge.
            }
            _ => {}
        }
    }
    result
}

fn require_anonymous_grant(url: &reqwest::Url, media_port: u16) -> Result<(), String> {
    if media_port != 0
        && url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(media_port)
        && url.query().is_none()
        && url
            .path()
            .strip_prefix("/media/")
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
    {
        return Ok(());
    }
    Err("unsupported-operation:外置请求需要已验证的原生插件会话；旧清单等待安装授权迁移。".into())
}

#[tauri::command]
pub async fn http_request(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    request: HttpRequest,
) -> Result<tauri::ipc::Response, String> {
    require_main(&window)?;
    request_http(&state, &request).await
}

async fn request_http(
    state: &RuntimeState,
    request: &HttpRequest,
) -> Result<tauri::ipc::Response, String> {
    crate::model::validate_id(&request.request_id)?;
    let cancellation = state.requests.lock().unwrap().begin(&request.request_id)?;
    let budget = Duration::from_millis(request.timeout_ms.unwrap_or(30_000).clamp(100, 120_000));
    let result = tokio::select! {
        _ = cancellation.cancelled() => Err("operation-cancelled:请求已取消。".into()),
        result = tokio::time::timeout(budget, execute(state,request,&cancellation)) => result.unwrap_or_else(|_| Err("request-timeout:请求总预算已用尽。".into())),
    };
    state.requests.lock().unwrap().finish(&request.request_id);
    result?.into_ipc()
}
#[tauri::command]
pub fn cancel_request(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    request_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    crate::model::validate_id(&request_id)?;
    state.requests.lock().unwrap().cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn read_headers(socket: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            let mut chunk = [0; 1024];
            let count = socket.read(&mut chunk).await.unwrap();
            assert!(count > 0 && bytes.len() < 8192);
            bytes.extend_from_slice(&chunk[..count]);
        }
        String::from_utf8(bytes).unwrap().to_ascii_lowercase()
    }

    fn test_request(url: String) -> HttpRequest {
        serde_json::from_value(serde_json::json!({
            "requestId": uuid::Uuid::new_v4().to_string(), "url": url,
            "credentials": "omit", "responseType": "bytes",
            "timeoutMs": 2000, "maxResponseBytes": 4
        }))
        .unwrap()
    }

    fn raw(response: tauri::ipc::Response) -> (serde_json::Value, Vec<u8>) {
        let InvokeResponseBody::Raw(bytes) = response.body().unwrap() else {
            panic!("HTTP response is not raw IPC");
        };
        let length = u32::from_be_bytes(bytes[..4].try_into().unwrap()) as usize;
        (
            serde_json::from_slice(&bytes[4..4 + length]).unwrap(),
            bytes[4 + length..].to_vec(),
        )
    }

    fn assert_finished(state: &RuntimeState, request: &HttpRequest) {
        let mut requests = state.requests.lock().unwrap();
        assert!(!requests.begin(&request.request_id).unwrap().is_cancelled());
        requests.finish(&request.request_id);
    }

    #[tokio::test]
    async fn native_read_keeps_account_cookies_range_and_binary_response() {
        for response_type in ["bytes", "text"] {
            let directory =
                std::env::temp_dir().join(format!("http-binary-{}", uuid::Uuid::new_v4()));
            let mut state = RuntimeState::new(directory.clone()).unwrap();
            // Persist test cookies without consulting the system keychain.
            state.credential_key_loader = Some(Arc::new(|| Ok([0x5a; 32])));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/body", listener.local_addr().unwrap());
            let account = crate::state::add_test_account(&state, "bilibili");
            state
                .session(&account.id)
                .unwrap()
                .cookies
                .lock()
                .unwrap()
                .parse("test=native-only; Path=/", &url.parse().unwrap())
                .unwrap();
            let backend = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let request = read_headers(&mut socket).await;
                assert!(request.contains("range: bytes=0-3\r\n"));
                assert!(request.contains("cookie: test=native-only\r\n"));
                socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/8\r\nSet-Cookie: private=yes\r\nConnection: close\r\n\r\n\x00\xff\x80\x01").await.unwrap();
            });
            let mut request = test_request(url);
            request.response_type = Some(response_type.into());
            request.credentials = Some("include".into());
            request.account_id = Some(account.id);
            request.headers = Some(std::collections::HashMap::from([(
                "Range".into(),
                "bytes=0-3".into(),
            )]));
            let (metadata, body) = raw(request_http(&state, &request).await.unwrap());
            assert_eq!(metadata["status"], 206);
            assert_eq!(metadata["statusText"], "Partial Content");
            assert_eq!(metadata["responseType"], response_type);
            let headers = metadata["headers"].as_str().unwrap();
            assert!(headers.contains("content-range: bytes 0-3/8"));
            assert!(!headers.contains("set-cookie"));
            assert_eq!(body, [0, 255, 128, 1]);
            assert_finished(&state, &request);
            backend.await.unwrap();
            drop(state);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[tokio::test]
    async fn declared_and_chunked_body_limits_keep_recovery_and_release_requests() {
        for response in [
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nx-any-music-retry-url: http://127.0.0.1:1/media/retry\r\nConnection: close\r\n\r\n12345",
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nx-any-music-retry-url: http://127.0.0.1:1/media/retry\r\nConnection: close\r\n\r\n5\r\n12345\r\n0\r\n\r\n",
        ] {
            let directory =
                std::env::temp_dir().join(format!("http-limit-{}", uuid::Uuid::new_v4()));
            let state = RuntimeState::new(directory.clone()).unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            *state.media_port.lock().unwrap() = address.port();
            let backend = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                read_headers(&mut socket).await;
                socket.write_all(response.as_bytes()).await.unwrap();
            });
            let request = test_request(format!("http://{address}/media/{}", uuid::Uuid::new_v4()));
            let error = request_http(&state, &request).await.err().unwrap();
            let details: serde_json::Value =
                serde_json::from_str(error.strip_prefix("response-too-large:").unwrap()).unwrap();
            assert_eq!(details["maxResponseBytes"], 4);
            assert_eq!(details["finalUrl"], "http://127.0.0.1:1/media/retry");
            assert_finished(&state, &request);
            backend.await.unwrap();
            drop(state);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[tokio::test]
    async fn stalled_native_body_cancellation_and_timeout_release_requests() {
        for cancel in [true, false] {
            let directory =
                std::env::temp_dir().join(format!("http-cancel-{}", uuid::Uuid::new_v4()));
            let state = Arc::new(RuntimeState::new(directory.clone()).unwrap());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            *state.media_port.lock().unwrap() = address.port();
            let (sent, received) = tokio::sync::oneshot::channel();
            let backend = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                read_headers(&mut socket).await;
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
                let _ = sent.send(());
                // Observe the real native read closing its connection, without a product UI.
                let mut buffer = [0; 4096];
                // Dropping a canceled native read may close with FIN or reset the
                // connection on macOS; both prove that the stalled read is gone.
                match socket.read(&mut buffer).await {
                    Ok(0) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
                    result => panic!("Expected the canceled connection to close: {result:?}"),
                }
            });
            let mut request =
                test_request(format!("http://{address}/media/{}", uuid::Uuid::new_v4()));
            if !cancel {
                request.timeout_ms = Some(100);
            }
            let state_for_cancel = state.clone();
            let id = request.request_id.clone();
            let cancel_task = tokio::spawn(async move {
                received.await.unwrap();
                if cancel {
                    state_for_cancel.requests.lock().unwrap().cancel(&id);
                }
            });
            let error =
                tokio::time::timeout(Duration::from_secs(3), request_http(&state, &request))
                    .await
                    .unwrap()
                    .err()
                    .unwrap();
            assert!(error.starts_with(if cancel {
                "operation-cancelled:"
            } else {
                "request-timeout:"
            }));
            assert_finished(&state, &request);
            cancel_task.await.unwrap();
            tokio::time::timeout(Duration::from_secs(3), backend)
                .await
                .unwrap()
                .unwrap();
            drop(state);
            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn unbound_anonymous_requests_cannot_bypass_plugin_authority() {
        for value in [
            "https://example.com/api",
            "http://127.0.0.1:9900/admin",
            "http://127.0.0.1:9901/media/00000000-0000-0000-0000-000000000000",
        ] {
            assert!(require_anonymous_grant(&value.parse().unwrap(), 9900).is_err());
        }
        assert!(
            require_anonymous_grant(
                &"http://127.0.0.1:9900/media/00000000-0000-0000-0000-000000000000"
                    .parse()
                    .unwrap(),
                9900
            )
            .is_ok()
        );
    }
    #[test]
    fn credential_headers_are_rejected_case_insensitively_and_public_headers_are_kept() {
        let client = anonymous_client().unwrap();
        for name in [
            "COOKIE",
            "aUtHoRiZaTiOn",
            "Proxy-Authorization",
            "Host",
            "Set-Cookie",
        ] {
            let headers = std::collections::HashMap::from([(name.to_owned(), "private".into())]);
            assert!(
                apply_headers(client.get("https://example.com/"), Some(&headers))
                    .err()
                    .unwrap()
                    .starts_with("invalid-input:")
            );
        }
        let headers = std::collections::HashMap::from([
            ("Range".into(), "bytes=0-1023".into()),
            ("X-Cookie-Hint".into(), "public".into()),
        ]);
        let request = apply_headers(client.get("https://example.com/"), Some(&headers))
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(request.headers()["range"], "bytes=0-1023");
        assert_eq!(request.headers()["x-cookie-hint"], "public");
    }

    #[test]
    fn response_header_projection_keeps_duplicates_and_invalid_text_without_credentials() {
        use reqwest::header::{HeaderMap, HeaderValue};
        let mut headers = HeaderMap::new();
        assert_eq!(response_headers(&headers), "");
        headers.append("set-cookie", "sessionid=private".parse().unwrap());
        assert_eq!(response_headers(&headers), "");
        headers.append("content-type", "application/json".parse().unwrap());
        assert_eq!(response_headers(&headers), "content-type: application/json");
        headers.append("x-public", "first".parse().unwrap());
        headers.append("x-public", "second".parse().unwrap());
        headers.append("x-binary", HeaderValue::from_bytes(b"\x80").unwrap());
        let output = response_headers(&headers);
        let mut lines: Vec<_> = output.split("\r\n").collect();
        lines.sort_unstable();
        assert_eq!(
            lines,
            vec![
                "content-type: application/json",
                "x-binary: ",
                "x-public: first",
                "x-public: second"
            ]
        );
        assert!(output.find("x-public: first").unwrap() < output.find("x-public: second").unwrap());
    }

    #[test]
    fn douyin_search_cannot_use_native_http_but_details_and_other_sources_can() {
        for url in [
            "https://www.douyin.com/aweme/v1/web/general/search/stream/?keyword=test",
            "https://www.douyin.com/aweme/v1/web/general/search/single/",
            "https://www-hj.douyin.com/aweme/v1/web/music/search/",
        ] {
            assert!(
                require_http_route(&url.parse().unwrap())
                    .unwrap_err()
                    .starts_with("invalid-input:")
            );
        }
        for url in [
            "https://www.douyin.com/aweme/v1/web/aweme/detail/",
            "https://www.douyin.com/aweme/v1/web/music/detail/",
            "https://www.douyin.com/search/test?type=general",
            "https://api.bilibili.com/x/web-interface/search/type",
            "https://douyin.com.example/aweme/v1/web/general/search/stream/",
        ] {
            assert!(require_http_route(&url.parse().unwrap()).is_ok());
        }
    }
}
