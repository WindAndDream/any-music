use crate::model::{ProxyProfile, Snapshot};

/// Keep explicit default ports and canonicalize SOCKS hosts with the same rules as HTTP hosts.
/// This checks endpoint syntax only; it does not probe the network or claim connectivity.
pub fn normalize_proxy_url(value: &str) -> Result<String, String> {
    let input = value.trim();
    if input.is_empty() {
        return Err("请填写代理地址。".into());
    }
    if input
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '\\' | '%'))
    {
        return Err("代理地址不能包含空白、反斜杠或转义字符。".into());
    }
    let (scheme, endpoint) = input
        .split_once("://")
        .ok_or("请使用 http://、https://、socks5:// 或 socks5h:// 开头的地址。")?;
    let scheme = scheme.to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https" | "socks5" | "socks5h") {
        return Err("请使用 http://、https://、socks5:// 或 socks5h:// 开头的地址。".into());
    }
    let authority = endpoint.strip_suffix('/').unwrap_or(endpoint);
    if authority.contains(['/', '?', '#']) {
        return Err("代理地址只能包含主机和端口，不能包含路径、查询或片段。".into());
    }
    if authority.contains('@') {
        return Err("暂不支持代理认证，请移除地址中的用户名和密码。".into());
    }
    let port_error = "请填写主机和端口；IPv6 地址需使用方括号，例如 [::1]:1080。";
    let (raw_host, raw_port) = authority.rsplit_once(':').ok_or(port_error)?;
    if raw_host.is_empty()
        || (raw_host.contains(':') && !(raw_host.starts_with('[') && raw_host.ends_with(']')))
        || raw_port.is_empty()
        || !raw_port.bytes().all(|c| c.is_ascii_digit())
    {
        return Err(port_error.into());
    }
    let port = raw_port
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or("代理端口必须是 1–65535 之间的整数。")?;
    let parsed = reqwest::Url::parse(&format!("http://{authority}/"))
        .map_err(|_| "请填写有效的 IPv4、IPv6 地址或域名。")?;
    let parsed_host = parsed
        .host_str()
        .ok_or("请填写有效的 IPv4、IPv6 地址或域名。")?;
    let host = parsed_host
        .strip_suffix('.')
        .unwrap_or(parsed_host)
        .to_ascii_lowercase();
    if host.chars().all(|c| c.is_ascii_digit() || c == '.') {
        if host != raw_host {
            return Err("IPv4 地址需填写完整的四段十进制数字。".into());
        }
    } else if !host.starts_with('[') {
        let valid = host.len() <= 253
            && host.split('.').all(|label| {
                let bytes = label.as_bytes();
                !bytes.is_empty()
                    && bytes.len() <= 63
                    && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
                    && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
                    && bytes
                        .iter()
                        .all(|c| c.is_ascii_alphanumeric() || *c == b'-')
            });
        if !valid {
            return Err("请填写有效的 IPv4、IPv6 地址或域名。".into());
        }
    }
    Ok(format!("{scheme}://{host}:{port}"))
}

/// Called inside RuntimeState::mutate so concurrent IPC saves cannot bypass duplicate checks.
pub fn save_proxy(snapshot: &mut Snapshot, name: &str, url: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("代理名称需要 1–80 个字符。".into());
    }
    let url = normalize_proxy_url(url)?;
    if snapshot
        .proxies
        .iter()
        .any(|proxy| proxy.name.trim() == name)
    {
        return Err("代理名称已存在，请使用其他名称。".into());
    }
    if snapshot
        .proxies
        .iter()
        .any(|proxy| normalize_proxy_url(&proxy.url).is_ok_and(|existing| existing == url))
    {
        return Err("该代理地址已存在，请勿重复添加。".into());
    }
    if snapshot.proxies.len() >= 128 {
        return Err("代理数量已达上限。".into());
    }
    snapshot.proxies.push(ProxyProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        url,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::RuntimeState;

    #[test]
    fn frontend_and_native_share_endpoint_cases() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../test/fixtures/proxy-endpoints.json"))
                .unwrap();
        for case in cases["accepted"].as_array().unwrap() {
            let input = case["input"].as_str().unwrap();
            let normalized = normalize_proxy_url(input).unwrap();
            assert_eq!(normalized, case["normalized"].as_str().unwrap(), "{input}");
            assert!(reqwest::Proxy::all(&normalized).is_ok(), "{input}");
        }
        for case in cases["rejected"].as_array().unwrap() {
            let input = case.as_str().unwrap();
            assert!(normalize_proxy_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn duplicate_and_invalid_saves_do_not_change_existing_profiles() {
        let mut snapshot = Snapshot::default();
        save_proxy(&mut snapshot, " 中文代理 ", " HTTP://Proxy.Example:8080/ ").unwrap();
        assert_eq!(snapshot.proxies[0].name, "中文代理");
        assert_eq!(snapshot.proxies[0].url, "http://proxy.example:8080");
        // Existing stores may contain the pre-normalization spelling.
        snapshot.proxies[0].url = "HTTP://Proxy.Example:8080/".into();
        let before = serde_json::to_value(&snapshot).unwrap();
        assert!(
            save_proxy(&mut snapshot, "其他名称", "http://proxy.example:08080")
                .unwrap_err()
                .contains("地址已存在")
        );
        assert!(
            save_proxy(&mut snapshot, " 中文代理 ", "http://localhost:1080")
                .unwrap_err()
                .contains("名称已存在")
        );
        assert!(save_proxy(&mut snapshot, "空端口", "http://localhost:0").is_err());
        assert!(save_proxy(&mut snapshot, &"字".repeat(81), "http://localhost:80").is_err());
        assert_eq!(serde_json::to_value(&snapshot).unwrap(), before);
        save_proxy(&mut snapshot, &"字".repeat(80), "http://localhost:80").unwrap();
        save_proxy(&mut snapshot, "另一协议", "socks5://proxy.example:8080").unwrap();
        save_proxy(&mut snapshot, "另一端口", "http://proxy.example:8081").unwrap();
    }

    #[test]
    fn concurrent_saves_persist_only_one_copy_and_keep_the_limit() {
        let directory =
            std::env::temp_dir().join(format!("any-music-proxy-test-{}", uuid::Uuid::new_v4()));
        let state = std::sync::Arc::new(RuntimeState::new(directory.clone()).unwrap());
        let workers: Vec<_> = (0..2)
            .map(|index| {
                let state = state.clone();
                std::thread::spawn(move || {
                    state.mutate(|snapshot| {
                        save_proxy(
                            snapshot,
                            &format!("代理{index}"),
                            "socks5h://localhost:1080",
                        )
                    })
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| worker.join().unwrap())
                .filter(Result::is_ok)
                .count(),
            1
        );
        assert_eq!(state.snapshot.lock().unwrap().proxies.len(), 1);
        let persisted: Snapshot =
            serde_json::from_slice(&std::fs::read(directory.join("accounts.json")).unwrap())
                .unwrap();
        assert_eq!(persisted.proxies.len(), 1);
        let mut full = Snapshot {
            proxies: (0..128)
                .map(|index| ProxyProfile {
                    id: index.to_string(),
                    name: index.to_string(),
                    url: format!("http://localhost:{}", index + 1),
                })
                .collect(),
            ..Snapshot::default()
        };
        assert!(
            save_proxy(&mut full, "超出上限", "http://localhost:9999")
                .unwrap_err()
                .contains("上限")
        );
        assert_eq!(full.proxies.len(), 128);
        drop(state);
        std::fs::remove_file(directory.join("accounts.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
