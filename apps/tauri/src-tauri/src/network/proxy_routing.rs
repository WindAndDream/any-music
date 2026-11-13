//! Ordered failover retains the account jar. No anonymous/direct fallback or write replay.
use crate::{
    model::Account,
    state::{AccountSession, RuntimeState},
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Native route identity and its optional URL; neither is exposed in source DTOs.
pub type ProxyRoute = (Option<String>, Option<String>);

pub fn validate_assignment(
    account: &Account,
    proxies: &[crate::model::ProxyProfile],
) -> Result<(), String> {
    if account.backup_proxy_ids.len() > 8 {
        return Err("最多选择 8 个备用代理。".into());
    }
    if account.proxy_id.is_none() && !account.backup_proxy_ids.is_empty() {
        return Err("请先选择主要代理。".into());
    }
    let mut seen = std::collections::HashSet::new();
    for id in account
        .proxy_id
        .iter()
        .chain(account.backup_proxy_ids.iter())
    {
        if !seen.insert(id) {
            return Err("主代理和备用代理不能重复。".into());
        }
        if !proxies.iter().any(|proxy| &proxy.id == id) {
            return Err("代理不存在，请重新选择请求连接。".into());
        }
    }
    Ok(())
}
impl RuntimeState {
    pub fn proxy_routes(&self, account: &Account) -> Result<Vec<ProxyRoute>, String> {
        let snapshot = self.snapshot.lock().unwrap();
        validate_assignment(account, &snapshot.proxies)?;
        if account.proxy_id.is_none() {
            return Ok(vec![(None, None)]);
        }
        let routes: Vec<_> = account
            .proxy_id
            .iter()
            .chain(account.backup_proxy_ids.iter())
            .map(|id| {
                let proxy = snapshot
                    .proxies
                    .iter()
                    .find(|proxy| &proxy.id == id)
                    .unwrap();
                (Some(id.clone()), Some(proxy.url.clone()))
            })
            .collect();
        Ok(routes)
    }
    pub fn active_proxy(&self, account: &Account) -> Option<String> {
        self.active_proxies
            .lock()
            .unwrap()
            .get(&account.id)
            .cloned()
            .filter(|id| {
                account.proxy_id.as_ref() == Some(id) || account.backup_proxy_ids.contains(id)
            })
            .or_else(|| account.proxy_id.clone())
    }
    pub fn routed_client(
        &self,
        account: &Account,
        cookies: std::sync::Arc<reqwest_cookie_store::CookieStoreMutex>,
        proxy: Option<&str>,
    ) -> Result<reqwest::Client, String> {
        let mut builder = reqwest::Client::builder()
            .cookie_provider(cookies)
            .user_agent(&account.user_agent)
            .redirect(reqwest::redirect::Policy::limited(5))
            .no_proxy();
        if let Some(proxy) = proxy {
            builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效。")?);
        }
        builder
            .build()
            .map_err(|_| "network-error:无法创建账号请求客户端。".into())
    }
    pub async fn send_routed(
        &self,
        account: &Account,
        session: &AccountSession,
        build: impl Fn(reqwest::Client) -> Result<reqwest::RequestBuilder, String>,
        replay_safe: bool,
        budget: Duration,
        cancellation: &CancellationToken,
    ) -> Result<reqwest::Response, String> {
        if cancellation.is_cancelled() || session.cancelled.is_cancelled() {
            return Err("operation-cancelled:请求已取消。".into());
        }
        let routes = self.proxy_routes(account)?;
        let active = self.active_proxy(account);
        let start = routes.iter().position(|(id, _)| *id == active).unwrap_or(0);
        let deadline = tokio::time::Instant::now() + budget;
        // A successful backup is reused for the account epoch; a later failure tries remaining routes.
        for index in (start..routes.len()).chain(0..start) {
            let (id, proxy) = &routes[index];
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err("request-timeout:连接尝试总预算已用尽。".into());
            }
            let timeout = if replay_safe && routes.len() > 1 {
                remaining.min(Duration::from_secs(8))
            } else {
                remaining
            };
            let client = {
                let mut clients = session.route_clients.lock().unwrap();
                if let Some(client) = clients.get(id) {
                    client.clone()
                } else {
                    let client =
                        self.routed_client(account, session.cookies.clone(), proxy.as_deref())?;
                    clients.insert(id.clone(), client.clone());
                    client
                }
            };
            let result = tokio::select! {
                _ = cancellation.cancelled() => return Err("operation-cancelled:请求已取消。".into()),
                _ = session.cancelled.cancelled() => return Err("operation-cancelled:账号环境已改变。".into()),
                // Bound connection/header attempts only; a successful media stream must not
                // inherit the short failover timeout. The caller owns body/total budgets.
                result = tokio::time::timeout(timeout, build(client)?.send()) => match result {
                    Ok(result) => result.map_err(|error| (error.is_timeout(), error.is_connect())),
                    Err(_) => Err((true, false)),
                },
            };
            match result {
                Ok(response)
                    if response.status() == reqwest::StatusCode::PROXY_AUTHENTICATION_REQUIRED
                        && replay_safe
                        && proxy.is_some() => {}
                Ok(response) => {
                    if let Some(id) = id {
                        self.active_proxies
                            .lock()
                            .unwrap()
                            .insert(account.id.clone(), id.clone());
                    }
                    return Ok(response);
                }
                Err((timeout, connect))
                    if replay_safe && proxy.is_some() && (connect || timeout) => {}
                Err((timeout, _)) => {
                    return Err(if timeout {
                        "request-timeout:连接请求超时。"
                    } else {
                        "network-error:无法连接音乐源，请检查账号代理或网络。"
                    }
                    .into());
                }
            }
            if !replay_safe {
                break;
            }
        }
        Err("network-error:主代理与备用代理均无法连接，请检查请求连接。".into())
    }
}

/// Only browser-reported proxy/tunnel failures allow CDP replay, never a login/risk challenge.
pub fn is_browser_proxy_failure(value: &str) -> bool {
    [
        "ERR_PROXY_CONNECTION_FAILED",
        "ERR_TUNNEL_CONNECTION_FAILED",
        "ERR_NO_SUPPORTED_PROXIES",
        "ERR_SOCKS_CONNECTION_FAILED",
    ]
    .iter()
    .any(|code| value.contains(code))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ProxyProfile;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn proxy(
        status: u16,
        index: usize,
        count: usize,
        seen: Arc<Mutex<Vec<usize>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            for _ in 0..count {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = vec![0; 4096];
                let length = socket.read(&mut bytes).await.unwrap();
                let request = String::from_utf8_lossy(&bytes[..length]);
                assert!(
                    request.contains("Cookie: test=synthetic")
                        || request.contains("cookie: test=synthetic")
                );
                seen.lock().unwrap().push(index);
                socket.write_all(format!("HTTP/1.1 {status} Result\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").as_bytes()).await.unwrap();
            }
        });
        (url, task)
    }
    #[tokio::test]
    async fn sequential_backups_keep_identity_reuse_success_and_never_replay_writes() {
        let directory =
            std::env::temp_dir().join(format!("any-music-proxy-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (main, first) = proxy(407, 0, 2, seen.clone()).await;
        let (backup, second) = proxy(407, 1, 1, seen.clone()).await;
        let (working, third) = proxy(200, 2, 2, seen.clone()).await;
        let mut account = crate::state::add_test_account(&state, "bilibili");
        account.proxy_id = Some("main".into());
        account.backup_proxy_ids = vec!["backup".into(), "working".into()];
        state.snapshot.lock().unwrap().proxies =
            [("main", main), ("backup", backup), ("working", working)]
                .into_iter()
                .map(|(id, url)| ProxyProfile {
                    id: id.into(),
                    name: id.into(),
                    url,
                })
                .collect();
        let mut cookies = reqwest_cookie_store::CookieStore::default();
        cookies
            .parse(
                "test=synthetic; Domain=bilibili.com; Path=/",
                &"http://www.bilibili.com/".parse().unwrap(),
            )
            .unwrap();
        let session = state.create_session(&account, cookies).unwrap();
        let cancel = CancellationToken::new();
        let send = || {
            state.send_routed(
                &account,
                &session,
                |client| Ok(client.get("http://www.bilibili.com/test")),
                true,
                Duration::from_secs(3),
                &cancel,
            )
        };
        assert_eq!(send().await.unwrap().status(), 200);
        assert_eq!(send().await.unwrap().status(), 200);
        assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2, 2]);
        state.active_proxies.lock().unwrap().clear();
        assert_eq!(
            state
                .send_routed(
                    &account,
                    &session,
                    |client| Ok(client.post("http://www.bilibili.com/test")),
                    false,
                    Duration::from_secs(3),
                    &cancel
                )
                .await
                .unwrap()
                .status(),
            407
        );
        assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2, 2, 0]);
        cancel.cancel();
        assert!(
            send()
                .await
                .unwrap_err()
                .starts_with("operation-cancelled:")
        );
        first.await.unwrap();
        second.await.unwrap();
        third.await.unwrap();
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn assignments_exclude_duplicates_missing_proxies_and_implicit_direct_fallback() {
        let directory =
            std::env::temp_dir().join(format!("any-music-route-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let mut account = crate::state::add_test_account(&state, "bilibili");
        let proxies = vec![ProxyProfile {
            id: "p".into(),
            name: "p".into(),
            url: "http://127.0.0.1:80".into(),
        }];
        account.backup_proxy_ids = vec!["p".into()];
        assert!(validate_assignment(&account, &proxies).is_err());
        account.proxy_id = Some("p".into());
        assert!(validate_assignment(&account, &proxies).is_err());
        account.backup_proxy_ids = vec!["missing".into()];
        assert!(validate_assignment(&account, &proxies).is_err());
        account.backup_proxy_ids.clear();
        assert!(validate_assignment(&account, &proxies).is_ok());
        assert!(is_browser_proxy_failure("net::ERR_PROXY_CONNECTION_FAILED"));
        assert!(!is_browser_proxy_failure("verification-required:captcha"));
        assert!(!is_browser_proxy_failure(
            "request-timeout:page did not respond"
        ));
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
