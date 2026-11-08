//! Streaming cache adapter. A one-MiB accumulator never reads ahead of consumer demand.
#[cfg(test)]
mod tests;
use super::MediaGrant;
use crate::{
    accounts::usage::AccountUse,
    network::http::apply_headers,
    storage::resource_cache::{CHUNK_BYTES, Piece, ResourceCache},
};
use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::{Stream, StreamExt, stream};
use std::{io, pin::Pin, sync::Arc};
use tokio_util::sync::CancellationToken;

fn representation(response: &reqwest::Response) -> Option<(u64, u64, String)> {
    let mime = response
        .headers()
        .get("content-type")?
        .to_str()
        .ok()?
        .to_owned();
    if !(mime.starts_with("audio/")
        || mime.starts_with("video/")
        || mime.starts_with("application/octet-stream"))
        || response.headers().contains_key("content-encoding")
        || response.headers().get("cache-control").is_some_and(|v| {
            v.to_str()
                .unwrap_or("")
                .to_ascii_lowercase()
                .contains("no-store")
        })
    {
        return None;
    }
    if response.status() == StatusCode::PARTIAL_CONTENT {
        let (bounds, total) = response
            .headers()
            .get("content-range")?
            .to_str()
            .ok()?
            .strip_prefix("bytes ")?
            .split_once('/')?;
        let (start, end) = bounds.split_once('-')?;
        let (start, end, total) = (
            start.parse::<u64>().ok()?,
            end.parse::<u64>().ok()?,
            total.parse::<u64>().ok()?,
        );
        if start > end || end >= total || response.content_length()? != end - start + 1 {
            return None;
        }
        Some((start, total, mime))
    } else if response.status() == StatusCode::OK {
        Some((0, response.content_length()?, mime))
    } else {
        None
    }
}

pub fn record(
    response: reqwest::Response,
    cache: ResourceCache,
    key: String,
    epoch: u64,
) -> impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static {
    let info = representation(&response);
    stream::unfold(
        (
            Box::pin(response.bytes_stream()),
            Pending {
                bytes: Vec::new(),
                info,
                cache,
                key,
                epoch,
            },
        ),
        |(mut source, mut pending)| async move {
            let chunk = source.next().await;
            if let Some(Ok(bytes)) = &chunk
                && pending.info.is_some()
            {
                let mut input = bytes.as_ref();
                while !input.is_empty() {
                    let length = input.len().min(CHUNK_BYTES - pending.bytes.len());
                    pending.bytes.extend_from_slice(&input[..length]);
                    input = &input[length..];
                    if pending.bytes.len() == CHUNK_BYTES {
                        pending.flush();
                    }
                }
            }
            chunk.map(|item| (item, (source, pending)))
        },
    )
}

// Preserve bytes already delivered when a consumer switches tracks. This schedules only
// a bounded disk write; it never continues reading the abandoned network response.
struct Pending {
    bytes: Vec<u8>,
    info: Option<(u64, u64, String)>,
    cache: ResourceCache,
    key: String,
    epoch: u64,
}
impl Pending {
    fn flush(&mut self) {
        let Some((offset, total, mime)) = &mut self.info else {
            return;
        };
        if self.bytes.is_empty() {
            return;
        }
        let piece = Piece {
            offset: *offset,
            total: *total,
            mime: mime.clone(),
            bytes: std::mem::take(&mut self.bytes),
        };
        *offset += piece.bytes.len() as u64;
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let Some(permit) = self.cache.reserve_deferred_write() else {
            return;
        };
        let cache = self.cache.clone();
        let key = self.key.clone();
        let epoch = self.epoch;
        runtime.spawn(async move {
            let _permit = permit;
            cache.put_deferred(epoch, key, "audio", piece).await;
        });
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.flush();
    }
}

fn range(value: Option<&str>, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let Some(value) = value else {
        return Some((0, total - 1));
    };
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start = if start.is_empty() {
        total.saturating_sub(end.parse::<u64>().ok()?.min(total))
    } else {
        start.parse().ok()?
    };
    let end = if end.is_empty() || value.starts_with("bytes=-") {
        total - 1
    } else {
        end.parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end && end < total).then_some((start, end))
}

type RemoteStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;
struct CachedBody {
    offset: u64,
    end: u64,
    total: u64,
    mime: String,
    first: Option<Piece>,
    remote: Option<RemoteStream>,
    cache: ResourceCache,
    grant: MediaGrant,
    epoch: u64,
    client: reqwest::Client,
    cancelled: CancellationToken,
    _usage: Arc<Option<AccountUse>>,
}
impl CachedBody {
    async fn next(mut self) -> Result<Option<(Bytes, Self)>, io::Error> {
        loop {
            if self.offset > self.end || self.cancelled.is_cancelled() {
                return Ok(None);
            }
            let bytes = if let Some(remote) = &mut self.remote {
                let result = tokio::select! {biased; _=self.cancelled.cancelled()=>return Ok(None), result=tokio::time::timeout(std::time::Duration::from_secs(30),remote.next())=>result.map_err(io::Error::other)?};
                let Some(bytes) = result else {
                    return Err(io::Error::other("incomplete cached media continuation"));
                };
                bytes.map_err(io::Error::other)?
            } else {
                let piece = match self.first.take() {
                    Some(p)
                        if p.offset <= self.offset
                            && p.offset + p.bytes.len() as u64 > self.offset =>
                    {
                        Some(p)
                    }
                    _ => {
                        self.cache
                            .read(self.grant.cache_key.clone(), self.offset)
                            .await
                    }
                };
                if let Some(piece) = piece.filter(|p| p.total == self.total) {
                    let start = (self.offset - piece.offset) as usize;
                    let length =
                        (piece.bytes.len() - start).min((self.end - self.offset + 1) as usize);
                    Bytes::from(piece.bytes).slice(start..start + length)
                } else {
                    // Clear/eviction after header delivery resumes one continuous upstream
                    // stream. Never issue one network request for every missing cache chunk.
                    let request =
                        apply_headers(self.client.get(&self.grant.url), Some(&self.grant.headers))
                            .map_err(io::Error::other)?
                            .header("range", format!("bytes={}-{}", self.offset, self.end));
                    let response = tokio::select! {biased; _=self.cancelled.cancelled()=>return Ok(None), result=tokio::time::timeout(std::time::Duration::from_secs(30),request.send())=>result.map_err(io::Error::other)?.map_err(io::Error::other)?};
                    if response.status() != StatusCode::PARTIAL_CONTENT
                        || response.headers().contains_key("content-encoding")
                        || response
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            != Some(self.mime.as_str())
                        || response
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            != Some(&format!(
                                "bytes {}-{}/{}",
                                self.offset, self.end, self.total
                            ))
                    {
                        return Err(io::Error::other("cached media representation changed"));
                    }
                    self.remote = Some(Box::pin(record(
                        response,
                        self.cache.clone(),
                        self.grant.cache_key.clone(),
                        self.epoch,
                    )));
                    continue;
                }
            };
            if bytes.len() as u64 > self.end - self.offset + 1 {
                return Err(io::Error::other(
                    "media continuation exceeded requested range",
                ));
            }
            self.offset += bytes.len() as u64;
            return Ok(Some((bytes, self)));
        }
    }
}

pub async fn response(
    cache: &ResourceCache,
    grant: &MediaGrant,
    headers: &HeaderMap,
    client: reqwest::Client,
    cancelled: CancellationToken,
    usage: Arc<Option<AccountUse>>,
) -> Option<Response> {
    let requested = headers.get("range").and_then(|v| v.to_str().ok());
    let start = requested
        .and_then(|v| {
            v.strip_prefix("bytes=")?
                .split_once('-')?
                .0
                .parse::<u64>()
                .ok()
        })
        .unwrap_or(0);
    let first = cache.read(grant.cache_key.clone(), start).await?;
    let (offset, end) = range(requested, first.total)?;
    let total = first.total;
    // Cached prefixes and Range fragments are useful even when the rest is absent.
    // CachedBody resumes exactly once with an upstream Range at the first gap.
    let mime = first.mime.clone();
    let cache_epoch = cache.epoch();
    let cache = cache.clone();
    let grant = grant.clone();
    let stream = stream::try_unfold(
        CachedBody {
            offset,
            end,
            total,
            mime: mime.clone(),
            first: Some(first),
            remote: None,
            cache,
            grant,
            epoch: cache_epoch,
            client,
            cancelled: cancelled.clone(),
            _usage: usage,
        },
        CachedBody::next,
    );
    let mut response = Response::builder()
        .status(if requested.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header("content-type", mime)
        .header("content-length", end - offset + 1)
        .header("accept-ranges", "bytes")
        .header("access-control-allow-origin", "*")
        .header("cache-control", "no-store");
    if requested.is_some() {
        response = response.header("content-range", format!("bytes {offset}-{end}/{total}"));
    }
    response
        .body(Body::from_stream(
            stream.take_until(cancelled.cancelled_owned()),
        ))
        .ok()
}
