use super::*;
use std::{collections::HashMap, time::Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn fixture() -> (std::path::PathBuf, ResourceCache) {
    let root = std::env::temp_dir().join(format!("am-stream-cache-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let cache = ResourceCache::new(root.clone(), root.join("cache"))
        .with_test_io_deadline(std::time::Duration::from_secs(30));
    (root, cache)
}
async fn store(cache: &ResourceCache, offset: u64, bytes: &[u8]) {
    cache
        .put(
            cache.epoch(),
            "media".into(),
            "audio",
            Piece {
                bytes: bytes.to_vec(),
                offset,
                total: 12,
                mime: "audio/mp4".into(),
            },
        )
        .await;
}
fn grant(url: String) -> MediaGrant {
    MediaGrant {
        cache_key: "media".into(),
        account_id: None,
        url,
        headers: HashMap::new(),
        expires: Instant::now() + std::time::Duration::from_secs(60),
    }
}

#[tokio::test]
async fn dropping_a_stream_saves_only_already_received_bytes() {
    let (root, cache) = fixture();
    let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/audio", server.local_addr().unwrap());
    let backend = tokio::spawn(async move {
        let (mut socket, _) = server.accept().await.unwrap();
        let mut request = [0; 2048];
        assert!(socket.read(&mut request).await.unwrap() > 0);
        socket
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nContent-Length: 12\r\n\r\npartial",
            )
            .await
            .unwrap();
        let mut byte = [0; 1];
        assert_eq!(socket.read(&mut byte).await.unwrap(), 0);
    });
    let response = reqwest::get(url).await.unwrap();
    let stream = record(response, cache.clone(), "media".into(), cache.epoch());
    let mut stream = Box::pin(stream);
    assert_eq!(stream.next().await.unwrap().unwrap().as_ref(), b"partial");
    drop(stream);
    // Dropping the stream reserves a deferred-write permit synchronously.
    // Wait for that write instead of racing the disk worker with timed polling.
    cache.wait_deferred_writes().await;
    let piece = cache
        .read("media".into(), 0)
        .await
        .expect("already received bytes should be cached after the deferred write");
    assert_eq!(piece.bytes, b"partial");
    assert_eq!(piece.total, 12);
    backend.await.unwrap();
    cache.wait_deferred_writes().await;
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn short_probes_cannot_fragment_a_full_upstream_stream() {
    let (root, cache) = fixture();
    store(&cache, 0, b"ab").await;
    let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/audio", server.local_addr().unwrap());
    let backend = tokio::spawn(async move {
        let (mut socket, _) = server.accept().await.unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut bytes = [0; 1024];
            let count = socket.read(&mut bytes).await.unwrap();
            assert!(count > 0 && request.len() < 8192);
            request.extend_from_slice(&bytes[..count]);
        }
        assert!(
            String::from_utf8(request)
                .unwrap()
                .to_ascii_lowercase()
                .contains("range: bytes=2-11\r\n")
        );
        socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nContent-Range: bytes 2-11/12\r\nContent-Length: 10\r\nConnection: close\r\n\r\ncdefghijkl").await.unwrap();
    });
    let cached = response(
        &cache,
        &grant(url),
        &HeaderMap::new(),
        reqwest::Client::new(),
        CancellationToken::new(),
        Arc::new(None),
    )
    .await
    .unwrap();
    assert_eq!(
        axum::body::to_bytes(cached.into_body(), 12)
            .await
            .unwrap()
            .as_ref(),
        b"abcdefghijkl"
    );
    backend.await.unwrap();
    cache.wait_deferred_writes().await;
    assert!(cache.covers("media".into(), 0, 1).await);
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn clear_after_headers_resumes_once_from_the_exact_byte_without_buffering_a_song() {
    let (root, cache) = fixture();
    store(&cache, 0, b"abcd").await;
    store(&cache, 4, b"efgh").await;
    store(&cache, 8, b"ijkl").await;
    let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/audio", server.local_addr().unwrap());
    let backend = tokio::spawn(async move {
        let (mut socket, _) = server.accept().await.unwrap();
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            let mut chunk = [0; 1024];
            let count = socket.read(&mut chunk).await.unwrap();
            assert!(count > 0 && bytes.len() < 8192);
            bytes.extend_from_slice(&chunk[..count]);
        }
        assert!(
            String::from_utf8(bytes)
                .unwrap()
                .to_ascii_lowercase()
                .contains("range: bytes=4-11\r\n")
        );
        socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nContent-Range: bytes 4-11/12\r\nContent-Length: 8\r\nConnection: close\r\n\r\nefghijkl").await.unwrap();
    });
    let cached = response(
        &cache,
        &grant(url),
        &HeaderMap::new(),
        reqwest::Client::new(),
        CancellationToken::new(),
        Arc::new(None),
    )
    .await
    .unwrap();
    cache.clear().await.unwrap();
    let bytes = axum::body::to_bytes(cached.into_body(), 12).await.unwrap();
    assert_eq!(bytes.as_ref(), b"abcdefghijkl");
    backend.await.unwrap();
    cache.wait_deferred_writes().await;
    assert_eq!(
        serde_json::to_value(cache.snapshot().await.unwrap()).unwrap()["usedBytes"],
        0
    );
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn byte_range_parsing_rejects_invalid_or_multiple_ranges() {
    assert_eq!(range(Some("bytes=2-5"), 12), Some((2, 5)));
    assert_eq!(range(Some("bytes=4-"), 12), Some((4, 11)));
    assert_eq!(range(Some("bytes=-4"), 12), Some((8, 11)));
    for input in [
        "bytes=2-1",
        "bytes=12-",
        "bytes=1-2,4-6",
        "bytes=-0",
        "garbage",
    ] {
        assert!(range(Some(input), 12).is_none());
    }
}
