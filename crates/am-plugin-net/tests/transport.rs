use crate::*;
use std::{
    collections::VecDeque,
    net::{IpAddr, SocketAddr},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn revocation_during_streaming_stops_chunks_and_late_results() {
    let backend = start_backend(vec![response(
        "200 OK",
        "Content-Type: audio/mpeg\r\n",
        &"x".repeat(256 * 1024),
    )])
    .await;
    let gate = TestGate::new(Scope::Public);
    struct StopAfterChunk {
        token: CancellationToken,
        bytes: usize,
    }
    impl Sink for StopAfterChunk {
        fn chunk(&mut self, bytes: &[u8]) -> Result<(), Error> {
            self.bytes += bytes.len();
            self.token.cancel();
            Ok(())
        }
    }
    let mut sink = StopAfterChunk {
        token: gate.cancel.clone(),
        bytes: 0,
    };
    let result = network(&backend, Dns::public())
        .execute(
            &gate,
            Request::get("https://public.example.com/media".into(), Exit::Media),
            &mut sink,
        )
        .await;
    assert!(result.is_err());
    assert!(sink.bytes > 0 && sink.bytes < 256 * 1024);
    assert!(
        network(&backend, Dns::public())
            .execute(&gate, request(), &mut vec![])
            .await
            .is_err()
    );
    assert_eq!(backend.requests.lock().unwrap().len(), 1);
}

#[derive(Clone)]
struct TestGate {
    cancel: CancellationToken,
    scope: Scope,
    requests: Arc<AtomicU64>,
    bytes: Arc<AtomicU64>,
    limit: u64,
}
impl TestGate {
    fn new(scope: Scope) -> Self {
        Self {
            cancel: CancellationToken::new(),
            scope,
            requests: Arc::new(AtomicU64::new(0)),
            bytes: Arc::new(AtomicU64::new(0)),
            limit: 128 * 1024 * 1024,
        }
    }
}
impl Gate for TestGate {
    fn scope(&self) -> Scope {
        self.scope.clone()
    }
    fn check(&self, _: Exit) -> Result<(), Error> {
        if self.cancel.is_cancelled() {
            Err(Error::Denied)
        } else {
            Ok(())
        }
    }
    fn charge(&self, requests: u64, bytes: u64) -> Result<(), Error> {
        if self.cancel.is_cancelled() {
            return Err(Error::Denied);
        }
        self.requests.fetch_add(requests, Ordering::SeqCst);
        if self.bytes.fetch_add(bytes, Ordering::SeqCst) + bytes > self.limit {
            Err(Error::Budget)
        } else {
            Ok(())
        }
    }
    fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
}
#[derive(Clone)]
struct Dns(Arc<Mutex<VecDeque<Vec<IpAddr>>>>);
impl Dns {
    fn public() -> Self {
        Self(Arc::new(Mutex::new(VecDeque::from([vec![
            "8.8.8.8".parse().unwrap(),
        ]]))))
    }
}
impl Resolver for Dns {
    fn resolve<'a>(
        &'a self,
        _: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<IpAddr>, Error>> + Send + 'a>>
    {
        Box::pin(async move {
            let mut answers = self.0.lock().unwrap();
            Ok(if answers.len() > 1 {
                answers.pop_front().unwrap()
            } else {
                answers[0].clone()
            })
        })
    }
}
struct Backend {
    address: SocketAddr,
    certificate: reqwest::Certificate,
    requests: Arc<Mutex<Vec<String>>>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.task.abort()
    }
}
async fn start_backend(replies: Vec<String>) -> Backend {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    // Each backend owns fresh in-memory TLS material; no private fixture is committed.
    let rcgen::CertifiedKey { cert, key_pair } = rcgen::generate_simple_self_signed(vec![
        "public.example.com".into(),
        "cdn.example.com".into(),
    ])
    .unwrap();
    let certificate = reqwest::Certificate::from_der(cert.der()).unwrap();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![cert.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into(),
        )
        .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let requests = Arc::new(Mutex::new(vec![]));
    let captured = requests.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                break;
            };
            let Ok(mut tls) = acceptor.accept(socket).await else {
                continue;
            };
            let mut bytes = vec![];
            let mut buffer = [0; 2048];
            loop {
                let Ok(n) = tls.read(&mut buffer).await else {
                    break;
                };
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let text = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                    let length = text
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length: "))
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let index = {
                let mut list = captured.lock().unwrap();
                list.push(String::from_utf8_lossy(&bytes).into_owned());
                list.len() - 1
            };
            let response = replies
                .get(index)
                .unwrap_or_else(|| replies.last().unwrap());
            let _ = tls.write_all(response.as_bytes()).await;
            let _ = tls.shutdown().await;
        }
    });
    Backend {
        address,
        certificate,
        requests,
        task,
    }
}
fn response(status: &str, headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    )
}
fn network(backend: &Backend, dns: Dns) -> Network<Dns> {
    Network::new(dns).local_backend(backend.address, backend.certificate.clone())
}
fn request() -> Request {
    Request::get(
        "https://public.example.com/data?private=query".into(),
        Exit::Sandbox,
    )
}

#[tokio::test]
async fn real_tls_anonymous_channel_filters_cookie_and_response_headers() {
    let backend = start_backend(vec![response(
        "200 OK",
        "Set-Cookie: host=secret; HttpOnly; Secure\r\nContent-Type: application/json\r\n",
        "{}",
    )])
    .await;
    let net = network(&backend, Dns::public());
    let gate = TestGate::new(Scope::Public);
    for _ in 0..2 {
        let mut body = vec![];
        let r = net.execute(&gate, request(), &mut body).await.unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(body, b"{}");
    }
    let requests = backend.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    for request in requests.iter() {
        let text = request.to_ascii_lowercase();
        assert!(!text.contains("cookie:"));
        assert!(!text.contains("authorization:"));
        assert!(!text.contains("proxy-"));
    }
}
#[tokio::test]
async fn cross_origin_303_reconstructs_headers_and_body_without_secrets() {
    let backend = start_backend(vec![
        response(
            "303 See Other",
            "Location: https://cdn.example.com/next\r\n",
            "",
        ),
        response("200 OK", "", "ok"),
    ])
    .await;
    let gate = TestGate::new(Scope::Public);
    let mut input = request();
    input.method = "POST".into();
    input.body = b"private-body".to_vec();
    input.headers = vec![
        ("X-Business".into(), "private-header".into()),
        (
            "Referer".into(),
            "https://public.example.com/private".into(),
        ),
    ];
    network(&backend, Dns::public())
        .execute(&gate, input, &mut vec![])
        .await
        .unwrap();
    let requests = backend.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1].starts_with("GET /next "));
    assert!(!requests[1].contains("private"));
    assert_eq!(gate.requests.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn redirects_cannot_rebind_escape_hosts_or_preserve_cross_origin_post() {
    for (location, scope, dns, method) in [
        (
            "https://127.0.0.1/admin",
            Scope::Public,
            Dns::public(),
            "GET",
        ),
        (
            "https://cdn.example.com/",
            Scope::Hosts(vec!["public.example.com".into()]),
            Dns::public(),
            "GET",
        ),
        (
            "https://public.example.com/next",
            Scope::Public,
            Dns(Arc::new(Mutex::new(VecDeque::from([
                vec!["8.8.8.8".parse().unwrap()],
                vec!["127.0.0.1".parse().unwrap()],
            ])))),
            "GET",
        ),
        (
            "https://cdn.example.com/",
            Scope::Public,
            Dns::public(),
            "POST",
        ),
    ] {
        let backend = start_backend(vec![response(
            "307 Temporary Redirect",
            &format!("Location: {location}\r\n"),
            "",
        )])
        .await;
        let mut input = request();
        input.method = method.into();
        assert!(
            network(&backend, dns)
                .execute(&TestGate::new(scope), input, &mut vec![])
                .await
                .is_err()
        );
        assert_eq!(backend.requests.lock().unwrap().len(), 1);
    }
}
#[tokio::test]
async fn mixed_dns_and_unconstrained_proxy_routes_make_no_connection() {
    let backend = start_backend(vec![response("200 OK", "", "")]).await;
    let dns = Dns(Arc::new(Mutex::new(VecDeque::from([vec![
        "8.8.8.8".parse().unwrap(),
        "10.0.0.1".parse().unwrap(),
    ]]))));
    let gate = TestGate::new(Scope::Public);
    assert!(matches!(
        network(&backend, dns)
            .execute(&gate, request(), &mut vec![])
            .await,
        Err(Error::Target)
    ));
    for route in [Route::HttpProxy, Route::SocksProxy, Route::SystemProxy] {
        let mut input = request();
        input.route = route;
        assert!(matches!(
            network(&backend, Dns::public())
                .execute(&gate, input, &mut vec![])
                .await,
            Err(Error::Unsupported)
        ));
    }
    assert!(backend.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn tls_validation_still_uses_original_hostname() {
    let backend = start_backend(vec![response("200 OK", "", "")]).await;
    let mut input = request();
    input.url = "https://wrong.example.com/".into();
    assert!(matches!(
        network(&backend, Dns::public())
            .execute(&TestGate::new(Scope::Public), input, &mut vec![])
            .await,
        Err(Error::Network)
    ));
    assert!(backend.requests.lock().unwrap().is_empty());
}
#[tokio::test]
async fn redirect_and_byte_budgets_are_cumulative() {
    let backend = start_backend(vec![response("302 Found", "Location: /again\r\n", "")]).await;
    assert!(matches!(
        network(&backend, Dns::public())
            .execute(&TestGate::new(Scope::Public), request(), &mut vec![])
            .await,
        Err(Error::Redirect)
    ));
    assert_eq!(backend.requests.lock().unwrap().len(), 4);
    let backend = start_backend(vec![response("200 OK", "", "more-than-limit")]).await;
    let mut input = request();
    input.max_bytes = 3;
    assert!(matches!(
        network(&backend, Dns::public())
            .execute(&TestGate::new(Scope::Public), input, &mut vec![])
            .await,
        Err(Error::Budget)
    ));
}
#[tokio::test]
async fn resource_range_release_and_revocation_keep_the_same_gate() {
    let backend = start_backend(vec![response(
        "206 Partial Content",
        "Content-Type: audio/mpeg\r\nContent-Range: bytes 0-3/10\r\n",
        "data",
    )])
    .await;
    let net = network(&backend, Dns::public());
    let gate = Arc::new(TestGate::new(Scope::Public));
    let resources = Resources::default();
    let reference = resources
        .register(
            gate.clone(),
            "https://public.example.com/media",
            Exit::Media,
        )
        .unwrap();
    let mut body = vec![];
    resources
        .read(&net, &reference, Some((0, 3)), 4, &mut body)
        .await
        .unwrap();
    assert_eq!(body, b"data");
    assert!(
        backend.requests.lock().unwrap()[0]
            .to_ascii_lowercase()
            .contains("range: bytes=0-3")
    );
    resources.release(reference.clone());
    assert!(
        resources
            .read(&net, &reference, None, 4, &mut vec![])
            .await
            .is_err()
    );
    let reference = resources
        .register(
            gate.clone(),
            "https://public.example.com/media",
            Exit::Download,
        )
        .unwrap();
    gate.cancel.cancel();
    assert!(
        resources
            .read(&net, &reference, None, 4, &mut vec![])
            .await
            .is_err()
    );
    assert_eq!(backend.requests.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn hostile_headers_ranges_and_non_http_exits_never_dispatch() {
    let backend = start_backend(vec![response("200 OK", "", "")]).await;
    let net = network(&backend, Dns::public());
    let gate = TestGate::new(Scope::Public);
    for name in [
        "Cookie",
        "Cookie2",
        "Authorization",
        "Host",
        "Proxy-Authorization",
        "Connection",
        "Content-Length",
        "Transfer-Encoding",
        "X-Forwarded-Host",
    ] {
        let mut input = request();
        input.headers.push((name.into(), "secret".into()));
        assert!(net.execute(&gate, input, &mut vec![]).await.is_err());
    }
    for value in [
        "bytes=0-",
        "bytes=-10",
        "bytes=0-3,6-8",
        "bytes=0-18446744073709551615",
    ] {
        let mut input = Request::get("https://public.example.com/media".into(), Exit::Media);
        input.headers.push(("Range".into(), value.into()));
        assert!(net.execute(&gate, input, &mut vec![]).await.is_err());
    }
    for exit in [Exit::ExternalLink, Exit::Export, Exit::HostWrite] {
        let mut input = request();
        input.exit = exit;
        assert!(net.execute(&gate, input, &mut vec![]).await.is_err());
    }
    let mut input = request();
    input.headers = vec![("X-Data".into(), "x".into()), ("x-data".into(), "y".into())];
    assert!(net.execute(&gate, input, &mut vec![]).await.is_err());
    assert!(backend.requests.lock().unwrap().is_empty());
}
