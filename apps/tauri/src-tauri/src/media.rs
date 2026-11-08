#[cfg(any(desktop, target_os = "android"))]
use crate::network::http::{anonymous_client, apply_headers};
use crate::{browser::verification::require_main, model::validate_public_url, state::RuntimeState};
#[cfg(any(desktop, target_os = "android"))]
use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
#[cfg(any(desktop, target_os = "android"))]
use futures_util::StreamExt;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
#[cfg(any(desktop, target_os = "android"))]
use tauri::Manager;
use tauri::WebviewWindow;

#[cfg(any(desktop, target_os = "android"))]
pub(crate) mod artwork;
#[cfg(any(desktop, target_os = "android"))]
mod cache;
#[tauri::command]
pub fn register_artwork(
    window: WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    url: String,
) -> Result<String, String> {
    require_main(&window)?;
    #[cfg(any(desktop, target_os = "android"))]
    {
        artwork::register_artwork(&state, url)
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (state, url);
        Err("unsupported-operation:此运行端尚未提供原生图片服务。".into())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCacheIdentity {
    track_id: String,
    quality_id: String,
}

#[derive(Clone)]
pub struct MediaGrant {
    pub cache_key: String,
    pub account_id: Option<String>,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub expires: Instant,
}

#[tauri::command]
pub fn register_media(
    window: WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    account_id: Option<String>,
    url: String,
    headers: HashMap<String, String>,
    cache_identity: Option<MediaCacheIdentity>,
) -> Result<String, String> {
    require_main(&window)?;
    if *state.media_port.lock().unwrap() == 0 {
        return Err("network-error:本机媒体服务正在初始化，请重试。".into());
    }
    validate_public_url(&url)?;
    let _usage = account_id
        .as_deref()
        .map(|id| state.use_account(id, "准备媒体"))
        .transpose()?;
    let key = if let Some(identity) = cache_identity {
        if identity.track_id.is_empty()
            || identity.track_id.len() > 1024
            || identity.quality_id.is_empty()
            || identity.quality_id.len() > 128
        {
            return Err("invalid-input:媒体缓存身份无效。".into());
        }
        crate::storage::resource_cache::digest(&[
            "audio",
            account_id.as_deref().unwrap_or(""),
            &identity.track_id,
            &identity.quality_id,
        ])
    } else {
        crate::storage::resource_cache::digest(&[
            "audio",
            account_id.as_deref().unwrap_or(""),
            &url,
        ])
    };
    create_grant_with_cache(&state, account_id, url, headers, key)
}

#[tauri::command]
pub fn release_media(
    window: WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    urls: Vec<String>,
) -> Result<(), String> {
    require_main(&window)?;
    if urls.len() > 32 {
        return Err("媒体释放数量超过预算。".into());
    }
    let port = *state.media_port.lock().unwrap();
    let mut grants = state.media.lock().unwrap();
    for value in urls {
        let url = validate_public_url(&value)?;
        if url.host_str() != Some("127.0.0.1") || url.port() != Some(port) {
            return Err("无效本机媒体地址。".into());
        }
        if let Some(id) = url.path().strip_prefix("/media/") {
            grants.remove(id);
        }
    }
    Ok(())
}

#[cfg(test)]
fn create_grant(
    state: &RuntimeState,
    account_id: Option<String>,
    url: String,
    headers: HashMap<String, String>,
) -> Result<String, String> {
    let key = crate::storage::resource_cache::digest(&[
        "audio",
        account_id.as_deref().unwrap_or(""),
        &url,
    ]);
    create_grant_with_cache(state, account_id, url, headers, key)
}

fn create_grant_with_cache(
    state: &RuntimeState,
    account_id: Option<String>,
    url: String,
    headers: HashMap<String, String>,
    cache_key: String,
) -> Result<String, String> {
    if account_id.is_none() {
        return Err("unsupported-operation:外置媒体必须使用绑定原生插件会话的资源引用。".into());
    }
    let mut grants = state.media.lock().unwrap();
    // Under the grant lock, a deletion either rejects this registration or removes it next.
    // An older request must not recreate a grant after account cleanup has passed this lock.
    if let Some(id) = &account_id {
        let account = state.account(id)?;
        if !account.enabled {
            return Err("operation-cancelled:账号已停用，无法创建媒体会话。".into());
        }
        if account.platform_id.starts_with("external:") {
            return Err("unsupported-operation:外置来源尚不支持媒体解析。".into());
        }
        if let Some(error) = account.content_error() {
            return Err(error.into());
        }
    }
    grants.retain(|_, g| g.expires > Instant::now());
    if grants.len() >= 256 {
        return Err("limit-exceeded:媒体会话数量超过预算。".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    grants.insert(
        id.clone(),
        MediaGrant {
            cache_key,
            account_id,
            url,
            headers,
            expires: Instant::now() + Duration::from_secs(4 * 3600),
        },
    );
    Ok(format!(
        "http://127.0.0.1:{}/media/{id}",
        *state.media_port.lock().unwrap()
    ))
}

#[cfg(any(desktop, target_os = "android"))]
async fn serve_media(
    State(app): State<tauri::AppHandle>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let state = app.state::<RuntimeState>();
    media_response(&state, &id, headers).await
}

#[cfg(any(desktop, target_os = "android"))]
async fn media_response(state: &RuntimeState, id: &str, headers: HeaderMap) -> Response {
    let grant = state
        .media
        .lock()
        .unwrap()
        .get(id)
        .filter(|g| g.expires > Instant::now())
        .cloned();
    let Some(grant) = grant else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let usage = match grant
        .account_id
        .as_deref()
        .map(|id| state.use_account(id, "播放或下载媒体"))
        .transpose()
    {
        Ok(usage) => usage,
        Err(_) => return StatusCode::GONE.into_response(),
    };
    let usage = std::sync::Arc::new(usage);
    let session = match &grant.account_id {
        Some(id) => match state.account(id) {
            Ok(a) if a.enabled && a.content_error().is_none() => match state.session(id) {
                Ok(session) => Some(session),
                Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
            },
            _ => return StatusCode::UNAUTHORIZED.into_response(),
        },
        None => None,
    };
    let client = match session
        .as_ref()
        .map(|s| Ok(s.client.clone()))
        .unwrap_or_else(anonymous_client)
    {
        Ok(c) => c,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let build = |client: reqwest::Client| {
        let mut request = apply_headers(client.get(&grant.url), Some(&grant.headers))?;
        if let Some(range) = headers.get("range") {
            request = request.header("range", range);
        }
        Ok(request)
    };
    let cancellation = session
        .as_ref()
        .map(|s| s.cancelled.clone())
        .unwrap_or_default();
    // Account revocation must precede both cached bytes and upstream transport.
    if cancellation.is_cancelled() {
        return StatusCode::GONE.into_response();
    }
    if let Some(cached) = cache::response(
        &state.resource_cache,
        &grant,
        &headers,
        client.clone(),
        cancellation.clone(),
        usage.clone(),
    )
    .await
    {
        return cached;
    }
    let cache_epoch = state.resource_cache.epoch();
    let response = match tokio::select! {
        biased;
        _ = cancellation.cancelled() => return StatusCode::GONE.into_response(),
        result = tokio::time::timeout(Duration::from_secs(30), async {
            if let Some(session) = &session {
                let account = state.account(grant.account_id.as_ref().unwrap())?;
                state.send_routed(&account, session, build, true, Duration::from_secs(30), &cancellation).await
            } else { build(client)?.send().await.map_err(|_| "network-error:媒体连接失败。".into()) }
        }) => result,
    } {
        Ok(Ok(r)) => r,
        _ => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let redirected_url = response.url().as_str();
    let mut builder = Response::builder()
        .status(response.status().as_u16())
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*");
    // A Range-ignoring playback entry may redirect to a Range-capable CDN. Keep the retry inside native credentials/proxy grants.
    if redirected_url != grant.url
        && let Ok(retry) = create_grant_with_cache(
            state,
            grant.account_id.clone(),
            redirected_url.into(),
            grant.headers.clone(),
            grant.cache_key.clone(),
        )
    {
        builder = builder.header("x-any-music-retry-url", retry);
    }
    for key in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
    ] {
        if let Some(value) = response.headers().get(key) {
            builder = builder.header(key, value);
        }
    }
    // Tee only bytes already requested by the player. Dropping the body stops upstream reads;
    // the bounded partial chunk can still be committed without downloading more media.
    let body = cache::record(
        response,
        state.resource_cache.clone(),
        grant.cache_key,
        cache_epoch,
    );
    builder
        .body(Body::from_stream(
            body.take_until(cancellation.cancelled_owned())
                .map(move |chunk| {
                    let _keep_account_alive = &usage;
                    chunk
                }),
        ))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}
#[cfg(any(desktop, target_os = "android"))]
pub fn start(app: tauri::AppHandle) -> Result<(), String> {
    // Bind before the workbench can discover media support. Android and desktop
    // share account-owned streaming, without exposing remote cookies to WebView.
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| "无法启动本机媒体流。")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法配置本机媒体流。")?;
    *app.state::<RuntimeState>().media_port.lock().unwrap() = listener
        .local_addr()
        .map_err(|_| "无法读取媒体端口。")?
        .port();
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(_) => {
                *app.state::<RuntimeState>().media_port.lock().unwrap() = 0;
                return;
            }
        };
        let router = Router::new()
            .route("/media/{id}", get(serve_media))
            .route("/artwork/{encoded}", get(artwork::serve))
            .with_state(app.clone());
        if let Err(error) = axum::serve(listener, router).await {
            *app.state::<RuntimeState>().media_port.lock().unwrap() = 0;
            eprintln!("本机媒体服务结束：{error}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_media_preserves_range_cookies_proxy_and_cancels_the_body() {
        let directory = std::env::temp_dir().join(format!("media-stream-{}", uuid::Uuid::new_v4()));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(check_account_media_stream(directory.clone()));
        // Join cache work that outlived its I/O deadline before deleting SQLite files.
        drop(runtime);
        std::fs::remove_dir_all(directory).unwrap();
    }

    async fn check_account_media_stream(directory: std::path::PathBuf) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let state = RuntimeState::new(directory).unwrap();
        let account = crate::state::add_test_account(&state, "bilibili");
        // A local proxy is the only server: the fixture hostname must never be contacted.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy = format!("http://{}", listener.local_addr().unwrap());
        {
            let mut snapshot = state.snapshot.lock().unwrap();
            snapshot.proxies.push(crate::model::ProxyProfile {
                id: "media-proxy".into(),
                name: "Media proxy".into(),
                url: proxy,
            });
            snapshot.accounts[0].proxy_id = Some("media-proxy".into());
        }
        let session = state.session(&account.id).unwrap();
        session
            .cookies
            .lock()
            .unwrap()
            .parse(
                "test=native-only; Path=/",
                &"http://media.bilibili.com/".parse().unwrap(),
            )
            .unwrap();
        // Leave byte 3 uncached so the cancellation request must reach the proxy.
        let backend = tokio::spawn(async move {
            for (range, content_range, body) in [
                ("bytes=0-2", "bytes 0-2/8", "abc"),
                ("bytes=4-7", "bytes 4-7/8", "efgh"),
                ("bytes=0-7", "bytes 0-7/8", ""),
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut chunk = [0; 1024];
                    let count = socket.read(&mut chunk).await.unwrap();
                    assert!(count > 0 && bytes.len() < 8192);
                    bytes.extend_from_slice(&chunk[..count]);
                }
                let request = String::from_utf8(bytes).unwrap().to_ascii_lowercase();
                assert!(request.starts_with("get http://media.bilibili.com/audio "));
                assert!(request.contains(&format!("range: {range}\r\n")));
                assert!(request.contains("cookie: test=native-only\r\n"));
                assert!(request.contains("referer: https://www.bilibili.com/\r\n"));
                socket.write_all(format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nContent-Range: {content_range}\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    if body.is_empty() { 8 } else { body.len() },
                ).as_bytes()).await.unwrap();
                if body.is_empty() {
                    // Headers arrive immediately; cancellation must not wait for these bytes.
                    std::future::pending::<()>().await;
                }
            }
        });
        *state.media_port.lock().unwrap() = 12345;
        let url = create_grant(
            &state,
            Some(account.id),
            "http://media.bilibili.com/audio".into(),
            HashMap::from([("Referer".into(), "https://www.bilibili.com/".into())]),
        )
        .unwrap();
        let id = url.rsplit('/').next().unwrap();
        for (range, expected) in [("bytes=0-2", "abc"), ("bytes=4-7", "efgh")] {
            let headers =
                HeaderMap::from_iter([(axum::http::header::RANGE, range.parse().unwrap())]);
            let response = media_response(&state, id, headers).await;
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(response.headers()["content-type"], "audio/mp4");
            assert_eq!(response.headers()["accept-ranges"], "bytes");
            assert!(response.headers().get("set-cookie").is_none());
            let bytes = axum::body::to_bytes(response.into_body(), 8).await.unwrap();
            assert_eq!(bytes.as_ref(), expected.as_bytes());
        }
        let headers =
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=0-7".parse().unwrap())]);
        let response = media_response(&state, id, headers).await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        session.cancelled.cancel();
        let bytes = tokio::time::timeout(
            Duration::from_secs(1),
            axum::body::to_bytes(response.into_body(), 8),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(bytes.is_empty());
        assert_eq!(
            media_response(&state, id, HeaderMap::new()).await.status(),
            StatusCode::GONE
        );
        state.media.lock().unwrap().remove(id);
        assert_eq!(
            media_response(&state, id, HeaderMap::new()).await.status(),
            StatusCode::NOT_FOUND
        );
        backend.abort();
        let shutdown = backend.await.unwrap_err();
        assert!(shutdown.is_cancelled(), "{shutdown}");
        state.resource_cache.wait_deferred_writes().await;
    }

    #[test]
    fn unverified_builtin_accounts_cannot_register_media() {
        let directory =
            std::env::temp_dir().join(format!("any-music-unverified-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        for platform in ["bilibili", "douyin", "netease"] {
            let account = crate::state::add_test_account(&state, platform);
            state
                .mutate(|s| {
                    let a = s.accounts.iter_mut().find(|a| a.id == account.id).unwrap();
                    a.authentication = "anonymous".into();
                    a.state.login = crate::accounts::state::LoginState::SignedOut;
                    Ok(())
                })
                .unwrap();
            assert!(
                create_grant(
                    &state,
                    Some(account.id),
                    "https://example.com/audio".into(),
                    HashMap::new()
                )
                .unwrap_err()
                .starts_with("not-authenticated:")
            );
        }
        assert!(state.media.lock().unwrap().is_empty());
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn account_deletion_rejects_late_media_registration() {
        let directory =
            std::env::temp_dir().join(format!("any-music-grant-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account_id = crate::state::add_test_account(&state, "bilibili").id;
        let deletion = state.usage.delete(&account_id).unwrap();
        let result = create_grant(
            &state,
            Some(account_id),
            "https://example.com/audio".into(),
            HashMap::new(),
        );
        assert!(result.unwrap_err().starts_with("operation-cancelled:"));
        assert!(state.media.lock().unwrap().is_empty());
        drop(deletion);
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
