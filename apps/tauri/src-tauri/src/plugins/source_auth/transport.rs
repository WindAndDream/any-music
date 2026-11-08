//! Credentialed gateway transport is host-only. It reuses public-target policy and native
//! Gate barriers, but never lends a built-in CookieStore or credentials to am-plugin-net.
use am_plugin_net::{Exit, Gate, Resolver, SystemResolver, Target};
use futures_util::StreamExt;
use serde_json::Value;
use std::{net::SocketAddr, time::Duration};
use tokio_util::sync::CancellationToken;

pub(super) async fn request(
    gate: &impl Gate,
    base: &str,
    endpoint: &str,
    body: &Value,
    token: Option<&str>,
    cancelled: &CancellationToken,
) -> Result<Value, String> {
    let work = async {
        if cancelled.is_cancelled() {
            return Err("operation-cancelled:账号操作已取消。".into());
        }
        let target = Target::parse(&format!("{base}{endpoint}"), &gate.scope())
            .map_err(|_| "认证接口地址不在授权范围内。")?;
        let addresses = SystemResolver
            .resolve(target.host())
            .await
            .map_err(|_| "认证接口域名解析失败。")?;
        target
            .validate_addresses(&addresses)
            .map_err(|_| "认证接口必须解析到公网地址。")?;
        let sockets: Vec<_> = addresses
            .into_iter()
            .map(|ip| SocketAddr::new(ip, 443))
            .collect();
        let client = reqwest::Client::builder()
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
            .resolve_to_addrs(target.host(), &sockets)
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| "认证请求不可用。")?;
        let bytes = serde_json::to_vec(body).map_err(|_| "认证输入无效。")?;
        if bytes.len() > 16384 {
            return Err("认证输入超过预算。".into());
        }
        if cancelled.is_cancelled() {
            return Err("operation-cancelled:账号操作已取消。".into());
        }
        gate.check(Exit::Sandbox)
            .and_then(|()| gate.charge(1, bytes.len() as u64))
            .map_err(|_| "插件授权已失效或超出预算。")?;
        let mut request = client
            .post(target.url())
            .header("accept-encoding", "identity")
            .header("content-type", "application/json")
            .body(bytes);
        if let Some(token) = token {
            request = request.bearer_auth(token)
        }
        let response = request.send().await.map_err(|_| "认证接口连接失败。")?;
        let status = response.status();
        gate.audit(target.host(), status.as_u16(), !status.is_success());
        // No redirect, Set-Cookie, arbitrary upstream error or private response reaches IPC.
        if status.as_u16() == 401 {
            return Err("not-authenticated:登录已失效，请重新登录。".into());
        }
        if !status.is_success() {
            return Err("认证接口未接受此请求，请检查输入或稍后重试。".into());
        }
        if response.content_length().is_some_and(|n| n > 65536) {
            return Err("认证接口响应超过预算。".into());
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "认证接口读取失败。")?;
            if bytes.len().saturating_add(chunk.len()) > 65536 {
                return Err("认证接口响应超过预算。".into());
            }
            gate.deliver(Exit::Sandbox, chunk.len() as u64, &mut || {
                bytes.extend_from_slice(&chunk);
                Ok(())
            })
            .map_err(|_| "插件授权已失效或超出预算。")?;
        }
        am_plugin_protocol::parse_json(&bytes).map_err(|_| "认证接口返回了无效数据。".into())
    };
    let revoked = gate.cancellation();
    tokio::select! {
        biased;
        _ = cancelled.cancelled() => Err("operation-cancelled:账号操作已取消。".into()),
        _ = revoked.cancelled() => Err("operation-cancelled:插件授权已撤销。".into()),
        result = tokio::time::timeout(Duration::from_secs(15),work) => result.map_err(|_| "request-timeout:认证接口请求超时。".to_owned())?,
    }
}
