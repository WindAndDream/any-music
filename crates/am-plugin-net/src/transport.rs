use crate::{Error, Exit, Request, Scope, Target};
use futures_util::StreamExt;
use std::{
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    time::Duration,
};
use tokio_util::sync::CancellationToken;

/// Supplied by the native host. Each check re-reads durable identity/epoch/data history.
/// `charge` precedes dispatch/delivery; implementations share revocation's serial barrier.
pub trait Gate: Send + Sync {
    fn scope(&self) -> Scope;
    fn check(&self, exit: Exit) -> Result<(), Error>;
    fn charge(&self, requests: u64, bytes: u64) -> Result<(), Error>;
    fn cancellation(&self) -> CancellationToken;
    fn audit(&self, _host: &str, _status: u16, _denied: bool) {}
    /// Native adapters serialize the final host sink action with revocation acknowledgement.
    fn deliver(
        &self,
        exit: Exit,
        bytes: u64,
        action: &mut dyn FnMut() -> Result<(), Error>,
    ) -> Result<(), Error> {
        self.check(exit)?;
        self.charge(0, bytes)?;
        action()
    }
}
pub trait Sink {
    /// Only trusted host sinks receive bytes. Media sinks use backpressure and own local grants.
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), Error>;
}
impl Sink for Vec<u8> {
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), Error> {
        self.extend_from_slice(bytes);
        Ok(())
    }
}
pub trait Resolver: Send + Sync {
    fn resolve<'a>(
        &'a self,
        host: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IpAddr>, Error>> + Send + 'a>>;
}
pub struct SystemResolver;
impl Resolver for SystemResolver {
    fn resolve<'a>(
        &'a self,
        host: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<IpAddr>, Error>> + Send + 'a>> {
        Box::pin(async move {
            if let Ok(ip) = host.trim_matches(['[', ']']).parse() {
                return Ok(vec![ip]);
            }
            let mut addresses = vec![];
            for address in tokio::net::lookup_host((host, 443))
                .await
                .map_err(|_| Error::Network)?
            {
                if !addresses.contains(&address.ip()) {
                    addresses.push(address.ip());
                }
                if addresses.len() > 32 {
                    return Err(Error::Budget);
                }
            }
            Ok(addresses)
        })
    }
}
pub struct Response {
    pub status: u16,
    /// Only inert metadata. No Set-Cookie, Location, arbitrary headers or upstream errors.
    pub content_type: Option<String>,
    pub bytes: u64,
}
pub struct Network<R = SystemResolver> {
    resolver: R,
    #[cfg(test)]
    endpoint: Option<(SocketAddr, reqwest::Certificate)>,
}
impl Default for Network {
    fn default() -> Self {
        Self::new(SystemResolver)
    }
}
impl<R: Resolver> Network<R> {
    pub fn new(resolver: R) -> Self {
        Self {
            resolver,
            #[cfg(test)]
            endpoint: None,
        }
    }
    #[cfg(test)]
    pub(crate) fn local_backend(
        mut self,
        address: SocketAddr,
        certificate: reqwest::Certificate,
    ) -> Self {
        self.endpoint = Some((address, certificate));
        self
    }
    fn client(&self, target: &Target, addresses: &[IpAddr]) -> Result<reqwest::Client, Error> {
        let sockets: Vec<_> = addresses
            .iter()
            .map(|ip| SocketAddr::new(*ip, 443))
            .collect();
        let builder = pinned_builder(target, &sockets);
        // This seam is compiled only into the crate's test harness. It keeps real TLS/SNI
        // and production policy/DNS checks while connecting to a controlled local backend.
        #[cfg(test)]
        let builder = if let Some((address, cert)) = &self.endpoint {
            builder
                .resolve_to_addrs(target.host(), &[*address])
                .add_root_certificate(cert.clone())
        } else {
            builder
        };
        builder.build().map_err(|_| Error::Network)
    }
    pub async fn execute(
        &self,
        gate: &dyn Gate,
        input: Request,
        sink: &mut dyn Sink,
    ) -> Result<Response, Error> {
        let cancel = gate.cancellation();
        let host = Target::parse(&input.url, &gate.scope())
            .ok()
            .map(|t| t.host);
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(Error::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(30), self.run(gate,input,sink)) =>
                result.unwrap_or(Err(Error::Timeout)),
        };
        gate.audit(
            host.as_deref().unwrap_or("invalid"),
            result.as_ref().map_or(0, |r| r.status),
            result.is_err(),
        );
        result
    }
    async fn run(
        &self,
        gate: &dyn Gate,
        input: Request,
        sink: &mut dyn Sink,
    ) -> Result<Response, Error> {
        let mut headers = input.validate()?;
        let scope = gate.scope();
        let mut target = Target::parse(&input.url, &scope)?;
        let mut method = input.method.clone();
        let mut body = input.body.clone();
        let mut total = 0u64;
        for hop in 0..=3 {
            gate.check(input.exit)?;
            let addresses = self.resolver.resolve(target.host()).await?;
            target.validate_addresses(&addresses)?;
            gate.check(input.exit)?;
            // A fresh single-origin client per hop has no reusable old-epoch connections,
            // ambient proxy, account jar, Alt-Svc/H2 coalescing or automatic retries.
            let client = self.client(&target, &addresses)?;
            gate.charge(
                1,
                (target.url().len()
                    + body.len()
                    + headers
                        .iter()
                        .map(|(k, v)| k.as_str().len() + v.len() + 4)
                        .sum::<usize>()) as u64,
            )?;
            gate.check(input.exit)?;
            let request = client
                .request(
                    method.parse().map_err(|_| Error::Denied)?,
                    target.url.clone(),
                )
                .headers(headers.clone())
                .body(body.clone());
            let mut sending = Box::pin(request.send());
            // Every poll that can dispatch request bytes passes the native revoke barrier;
            // no standard lock is held across an await. Already admitted traffic is in flight.
            let response = futures_util::future::poll_fn(|cx| {
                let mut outcome = std::task::Poll::Pending;
                match gate.deliver(input.exit, 0, &mut || {
                    outcome = sending.as_mut().poll(cx).map_err(|_| Error::Network);
                    Ok(())
                }) {
                    Ok(()) => outcome,
                    Err(error) => std::task::Poll::Ready(Err(error)),
                }
            })
            .await?;
            gate.check(input.exit)?;
            let peer_valid = response
                .remote_addr()
                .is_some_and(|a| addresses.contains(&a.ip()));
            #[cfg(test)]
            let peer_valid = if let Some((address, _)) = &self.endpoint {
                response.remote_addr() == Some(*address)
            } else {
                peer_valid
            };
            if !peer_valid {
                return Err(Error::Target);
            }
            if response.headers().contains_key("content-encoding")
                && response.headers()["content-encoding"] != "identity"
            {
                return Err(Error::Unsupported);
            }
            let status = response.status().as_u16();
            gate.audit(target.host(), status, false);
            if [301, 302, 303, 307, 308].contains(&status) {
                if hop == 3 {
                    return Err(Error::Redirect);
                }
                let location = response
                    .headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or(Error::Redirect)?;
                let next_url = target.url.join(location).map_err(|_| Error::Redirect)?;
                let next = Target::parse(next_url.as_str(), &scope)?;
                if next.url.origin() != target.url.origin() {
                    // Reconstruct cross-origin GET/HEAD with no plugin headers or POST body.
                    if method == "POST" && status != 303 {
                        return Err(Error::Redirect);
                    }
                    headers.clear();
                    headers.insert(
                        "accept-encoding",
                        reqwest::header::HeaderValue::from_static("identity"),
                    );
                    body.clear();
                }
                if status == 303 && method != "HEAD" {
                    method = "GET".into();
                    body.clear();
                }
                target = next;
                continue;
            }
            if status == 101
                || response
                    .content_length()
                    .is_some_and(|n| n > input.max_bytes as u64)
            {
                return Err(Error::Budget);
            }
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .filter(|v| v.len() <= 200)
                .map(str::to_owned);
            if input.exit == Exit::Image
                && !content_type.as_deref().is_some_and(|v| {
                    [
                        "image/png",
                        "image/jpeg",
                        "image/webp",
                        "image/gif",
                        "image/avif",
                    ]
                    .contains(&v.split(';').next().unwrap_or(""))
                })
            {
                return Err(Error::Unsupported);
            }
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| Error::Network)?;
                total = total.checked_add(chunk.len() as u64).ok_or(Error::Budget)?;
                if total > input.max_bytes as u64 {
                    return Err(Error::Budget);
                }
                gate.deliver(input.exit, chunk.len() as u64, &mut || sink.chunk(&chunk))?;
            }
            gate.check(input.exit)?;
            return Ok(Response {
                status,
                content_type,
                bytes: total,
            });
        }
        Err(Error::Redirect)
    }
}
fn pinned_builder(target: &Target, sockets: &[SocketAddr]) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .http1_only()
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .retry(reqwest::retry::never())
        .pool_max_idle_per_host(0)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .resolve_to_addrs(target.host(), sockets)
        .connect_timeout(Duration::from_secs(10))
}
