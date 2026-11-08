//! Signed, bounded artwork relay; the URL exists only in the short-lived renderer address.
use crate::{
    model::validate_public_url,
    state::RuntimeState,
    storage::resource_cache::{CHUNK_BYTES, Piece, digest},
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
};
use tauri::Manager;

pub(crate) struct ArtworkState {
    key: [u8; 32],
    client: reqwest::Client,
    active: Arc<tokio::sync::Semaphore>,
    admission: Arc<tokio::sync::Semaphore>,
    writes: Arc<tokio::sync::Semaphore>,
    flights: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
}
impl ArtworkState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            key: rand::random(),
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .pool_max_idle_per_host(4)
                .build()
                .map_err(|_| "无法初始化图片请求客户端。")?,
            active: Arc::new(tokio::sync::Semaphore::new(4)),
            admission: Arc::new(tokio::sync::Semaphore::new(32)),
            writes: Arc::new(tokio::sync::Semaphore::new(2)),
            flights: Mutex::default(),
        })
    }
    fn flight(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut flights = self.flights.lock().unwrap();
        flights.retain(|_, flight| flight.strong_count() > 0);
        if let Some(flight) = flights.get(key).and_then(Weak::upgrade) {
            return flight;
        }
        let flight = Arc::new(tokio::sync::Mutex::new(()));
        flights.insert(key.into(), Arc::downgrade(&flight));
        flight
    }
}

fn validate(value: &str) -> Result<(), String> {
    let url = validate_public_url(value)?;
    let host = url.host_str().ok_or("图片地址缺少主机。")?;
    // Built-in artwork is public CDN data. Do not turn this port into a local network relay.
    const DOMAINS: &[&str] = &[
        "hdslb.com",
        "bilibili.com",
        "byteimg.com",
        "douyinpic.com",
        "douyin.com",
        "douyincdn.com",
        "pstatp.com",
        "126.net",
        "music.163.com",
    ];
    if value.len() > 8192
        || url.scheme() != "https"
        || !DOMAINS
            .iter()
            .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
    {
        return Err("unsupported-operation:此图片地址不在内置来源的公共 CDN 范围内。".into());
    }
    Ok(())
}
fn signature(state: &RuntimeState, value: &str) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(&state.artwork.key).unwrap();
    mac.update(value.as_bytes());
    mac
}
pub fn register_artwork(state: &RuntimeState, url: String) -> Result<String, String> {
    validate(&url)?;
    let port = *state.media_port.lock().unwrap();
    if port == 0 {
        return Err("network-error:本机资源服务尚未就绪。".into());
    }
    Ok(format!(
        "http://127.0.0.1:{port}/artwork/{}.{}",
        URL_SAFE_NO_PAD.encode(signature(state, &url).finalize().into_bytes()),
        URL_SAFE_NO_PAD.encode(url.as_bytes())
    ))
}
pub async fn serve(State(app): State<tauri::AppHandle>, Path(encoded): Path<String>) -> Response {
    let state = app.state::<RuntimeState>();
    let Some((sig, url)) = encoded.split_once('.') else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (Ok(sig), Ok(url)) = (URL_SAFE_NO_PAD.decode(sig), URL_SAFE_NO_PAD.decode(url)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(url) = String::from_utf8(url) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if validate(&url).is_err() || signature(&state, &url).verify_slice(&sig).is_err() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let key = digest(&["image", &url]);
    let Ok(admission) = state.artwork.admission.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    let Ok(Ok(active)) =
        tokio::time::timeout_at(deadline, state.artwork.active.clone().acquire_owned()).await
    else {
        return StatusCode::GATEWAY_TIMEOUT.into_response();
    };
    let flight = state.artwork.flight(&key);
    let Ok(_flight) = tokio::time::timeout_at(deadline, flight.lock()).await else {
        return StatusCode::GATEWAY_TIMEOUT.into_response();
    };
    if let Some(first) = state.resource_cache.read(key.clone(), 0).await {
        let total = first.total;
        if total <= 8 * CHUNK_BYTES as u64 {
            let mime = first.mime.clone();
            let mut body = first.bytes;
            while (body.len() as u64) < total {
                let Some(piece) = state
                    .resource_cache
                    .read(key.clone(), body.len() as u64)
                    .await
                else {
                    break;
                };
                if piece.offset != body.len() as u64 || piece.total != total {
                    break;
                }
                body.extend_from_slice(&piece.bytes);
            }
            if body.len() as u64 == total {
                return result(body.into(), mime, (active, admission));
            }
        }
    }
    let epoch = state.resource_cache.epoch();
    let work = async {
        // No cookies, account clients, proxy passwords or upstream Set-Cookie enter artwork.
        // Redirects are disabled: the signed address grants this exact public CDN URL only.
        let response = state
            .artwork
            .client
            .get(&url)
            .send()
            .await
            .map_err(|_| ())?;
        if response.status() != StatusCode::OK
            || response
                .content_length()
                .is_some_and(|n| n > 8 * CHUNK_BYTES as u64)
        {
            return Err(());
        }
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .filter(|m| m.starts_with("image/") && m.len() <= 128)
            .ok_or(())?
            .to_owned();
        let store = !response.headers().get("cache-control").is_some_and(|v| {
            v.to_str()
                .unwrap_or("")
                .to_ascii_lowercase()
                .contains("no-store")
        });
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| ())?;
            if bytes.len() + chunk.len() > 8 * CHUNK_BYTES {
                return Err(());
            }
            bytes.extend_from_slice(&chunk);
        }
        let bytes = axum::body::Bytes::from(bytes);
        if store && let Ok(permit) = state.artwork.writes.clone().try_acquire_owned() {
            let cache = state.resource_cache.clone();
            let body = bytes.clone();
            let cache_mime = mime.clone();
            tokio::spawn(async move {
                let _permit = permit;
                for (index, chunk) in body.chunks(CHUNK_BYTES).enumerate() {
                    cache
                        .put_deferred(
                            epoch,
                            key.clone(),
                            "image",
                            Piece {
                                bytes: chunk.to_vec(),
                                offset: (index * CHUNK_BYTES) as u64,
                                total: body.len() as u64,
                                mime: cache_mime.clone(),
                            },
                        )
                        .await;
                }
            });
        }
        Ok(result(bytes, mime, (active, admission)))
    };
    match tokio::time::timeout_at(deadline, work).await {
        Ok(Ok(response)) => response,
        _ => StatusCode::BAD_GATEWAY.into_response(),
    }
}
fn result(
    bytes: axum::body::Bytes,
    mime: String,
    permits: (
        tokio::sync::OwnedSemaphorePermit,
        tokio::sync::OwnedSemaphorePermit,
    ),
) -> Response {
    let length = bytes.len();
    // Retain admission through body delivery, so slow consumers cannot accumulate
    // completed eight-MiB response buffers outside the active-read budget.
    let body = futures_util::stream::iter([bytes]).map(move |bytes| {
        let _keep_permits = &permits;
        Ok::<_, std::convert::Infallible>(bytes)
    });
    Response::builder()
        .header("content-type", mime)
        .header("content-length", length)
        .header("cache-control", "no-store")
        .header("access-control-allow-origin", "*")
        .header("x-content-type-options", "nosniff")
        .body(Body::from_stream(body))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn artwork_is_exactly_signed_and_restricted_to_public_builtin_cdns() {
        let root = std::env::temp_dir().join(format!("am-artwork-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(root.clone()).unwrap();
        let url = "https://i0.hdslb.com/bfs/archive/test.jpg";
        assert!(validate(url).is_ok());
        for value in [
            "http://i0.hdslb.com/cover.jpg",
            "https://127.0.0.1/cover.jpg",
            "https://hdslb.com.evil.test/cover.jpg",
            "https://user:secret@i0.hdslb.com/cover.jpg",
        ] {
            assert!(validate(value).is_err());
        }
        let signed = signature(&state, url).finalize().into_bytes();
        assert!(signature(&state, url).verify_slice(&signed).is_ok());
        assert!(
            signature(&state, &format!("{url}?changed=1"))
                .verify_slice(&signed)
                .is_err()
        );
        let first = state.artwork.flight("same");
        assert!(Arc::ptr_eq(&first, &state.artwork.flight("same")));
        drop(first);
        state.artwork.flight("next");
        assert_eq!(state.artwork.flights.lock().unwrap().len(), 1);
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }
}
