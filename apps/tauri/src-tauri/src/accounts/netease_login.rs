//! Official NetEase login requests stay account-bound; only QR content/status leaves Rust.
use crate::state::{AccountSession, RuntimeState};
use reqwest_cookie_store::CookieStore;
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

const ORIGIN: &str = "https://music.163.com/";
const QR_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";

fn initialize_qr_cookies(cookies: &mut CookieStore, visitor: u128, now_ms: u128) {
    let url = reqwest::Url::parse(ORIGIN).unwrap();
    let visitor = format!("{visitor:032x}");
    // Match WangYiMusicApi's anonymous QR session; keep these cookies in the attempt's jar.
    for (name, value) in [
        ("_ntes_nuid", visitor.clone()),
        ("_ntes_nnid", format!("{visitor},{now_ms}")),
        ("os", "pc".into()),
        (
            "osver",
            "Microsoft-Windows-10-Professional-build-19045-64bit".into(),
        ),
        ("appver", "3.0.18.203152".into()),
    ] {
        cookies
            .parse(&format!("{name}={value}; Path=/; Secure"), &url)
            .expect("fixed QR cookie profile");
    }
}

fn build_login_request(
    client: &reqwest::Client,
    url: &str,
    form: Option<&[(&str, &str)]>,
) -> reqwest::RequestBuilder {
    let request = match form {
        Some(form) => client
            .post(url)
            .header(reqwest::header::USER_AGENT, QR_USER_AGENT)
            .form(form),
        None => client.get(url),
    };
    request
        .header(reqwest::header::REFERER, ORIGIN)
        .header(reqwest::header::ORIGIN, "https://music.163.com")
}

async fn request(
    state: &RuntimeState,
    account_id: &str,
    session: &AccountSession,
    path: &str,
    form: Option<&[(&str, &str)]>,
) -> Result<Value, String> {
    let account = state.account(account_id)?;
    if account.platform_id != "netease" {
        return Err("账号平台与网易云登录请求不匹配。".into());
    }
    let url = format!("{ORIGIN}api/{path}");
    let work = async {
        let mut response = state
            .send_routed(
                &account,
                session,
                |client| Ok(build_login_request(&client, &url, form)),
                form.is_none(),
                std::time::Duration::from_secs(15),
                &session.cancelled,
            )
            .await?;
        if response.status() != reqwest::StatusCode::OK || response.url().as_str() != url {
            return Err("网易云登录请求失败或被重定向。".into());
        }
        const LIMIT: usize = 256 * 1024;
        if response
            .content_length()
            .is_some_and(|length| length > LIMIT as u64)
        {
            return Err("网易云登录响应超过预算。".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "网易云登录响应读取失败。")?
        {
            if bytes.len() + chunk.len() > LIMIT {
                return Err("网易云登录响应超过预算。".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "网易云登录响应无效。".into())
    };
    tokio::select! {
        _ = session.cancelled.cancelled() => Err("operation-cancelled:网易云登录已取消。".into()),
        result = tokio::time::timeout(std::time::Duration::from_secs(15), work) =>
            result.map_err(|_| "网易云登录请求超时。".to_string()).and_then(|value| value),
    }
}

pub async fn generate(
    state: &RuntimeState,
    id: &str,
    session: &AccountSession,
) -> Result<(String, Value), String> {
    // Keep the anonymous visitor identity stable from QR creation through confirmation.
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    initialize_qr_cookies(&mut session.cookies.lock().unwrap(), rand::random(), now_ms);
    let value = request(
        state,
        id,
        session,
        "login/qrcode/unikey",
        Some(&[("type", "1")]),
    )
    .await?;
    if value["code"] != 200 {
        return Err("网易云拒绝生成二维码。".into());
    }
    let key = value["unikey"]
        .as_str()
        .or_else(|| value["data"]["unikey"].as_str())
        .ok_or("网易云未返回二维码标识。")?;
    if key.is_empty()
        || key.len() > 256
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("网易云二维码标识无效。".into());
    }
    let mut url = reqwest::Url::parse("https://music.163.com/login").unwrap();
    url.query_pairs_mut().append_pair("codekey", key);
    Ok((
        key.into(),
        json!({"status":"waiting","qrContent":url.as_str()}),
    ))
}

pub async fn poll(
    state: &RuntimeState,
    id: &str,
    session: &AccountSession,
    key: &str,
) -> Result<Value, String> {
    if key.is_empty() {
        return Err("二维码尚未生成。".into());
    }
    let value = request(
        state,
        id,
        session,
        "login/qrcode/client/login",
        Some(&[("key", key), ("type", "1")]),
    )
    .await?;
    let public = qr_status(&value)?;
    if public["status"] == "signed-in" {
        store_qr_credential(&mut session.cookies.lock().unwrap(), &value);
    }
    Ok(public)
}

fn store_qr_credential(cookies: &mut CookieStore, value: &Value) {
    let Some(body) = value["cookie"].as_str() else {
        return;
    };
    let origin = reqwest::Url::parse(ORIGIN).unwrap();
    if cookies
        .get_request_values(&origin)
        .any(|(name, token)| name == "MUSIC_U" && !token.is_empty())
    {
        return;
    }
    // The QR endpoint can return a Cookie header string in JSON. Import only the login
    // credential into the temporary native session, with host-only scope and fixed attributes.
    let mut tokens = body
        .split(';')
        .filter_map(|pair| pair.trim_matches(' ').strip_prefix("MUSIC_U="));
    let Some(token) = tokens.next() else {
        return;
    };
    if tokens.next().is_some()
        || token.is_empty()
        || !token.bytes().all(
            |byte| matches!(byte, b'!' | b'#'..=b'+' | b'-'..=b':' | b'<'..=b'[' | b']'..=b'~'),
        )
    {
        return;
    }
    let _ = cookies.parse(
        &format!("MUSIC_U={token}; Path=/; Secure; HttpOnly"),
        &origin,
    );
}

fn qr_status(value: &Value) -> Result<Value, String> {
    let status = match value["code"].as_i64() {
        Some(800) => "expired",
        Some(801) => "waiting",
        Some(802) => "scanned",
        Some(803) => "signed-in",
        Some(8821) => {
            return Err("网易云未完成授权（状态码 8821）。请返回选择登录方式，使用系统浏览器在网易云官网完成登录或安全验证。".into());
        }
        Some(code) => {
            return Err(format!(
                "网易云二维码登录未完成（状态码 {code}），请重新生成二维码重试。"
            ));
        }
        None => return Err("网易云未返回有效的二维码状态，请重新生成二维码重试。".into()),
    };
    Ok(json!({"status":status}))
}

pub async fn user_id(
    state: &RuntimeState,
    id: &str,
    session: &AccountSession,
) -> Result<String, String> {
    let value = request(state, id, session, "w/nuser/account/get", None).await?;
    identity(&value).ok_or_else(|| "网易云未确认已登录用户，请重新登录。".into())
}

pub fn identity(value: &Value) -> Option<String> {
    if value["code"] != 200 {
        return None;
    }
    let id = value["profile"]["userId"].as_u64().filter(|id| *id > 0)?;
    // A successful profile must describe the same account; neither a cookie nor code 200 proves login.
    if value["account"]["id"].as_u64() != Some(id) {
        return None;
    }
    Some(id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_creation_and_poll_use_the_demo_request_profile() {
        let mut cookies = CookieStore::default();
        initialize_qr_cookies(&mut cookies, 0xabc, 123);
        let token = "00000000000000000000000000000abc";
        let marker = format!("{token},123");
        let client = reqwest::Client::new();
        for (path, form, body) in [
            ("login/qrcode/unikey", &[("type", "1")][..], "type=1"),
            (
                "login/qrcode/client/login",
                &[("key", "synthetic"), ("type", "1")][..],
                "key=synthetic&type=1",
            ),
        ] {
            let url = format!("{ORIGIN}api/{path}");
            let request = build_login_request(&client, &url, Some(form))
                .build()
                .unwrap();
            assert_eq!(request.method(), reqwest::Method::POST);
            assert_eq!(request.body().unwrap().as_bytes().unwrap(), body.as_bytes());
            assert_eq!(request.headers()["user-agent"], QR_USER_AGENT);
            assert_eq!(
                request.headers()["content-type"],
                "application/x-www-form-urlencoded"
            );
            assert_eq!(request.headers()["origin"], "https://music.163.com");
            assert_eq!(request.headers()["referer"], ORIGIN);
            let actual: std::collections::HashMap<_, _> =
                cookies.get_request_values(request.url()).collect();
            assert_eq!(
                actual,
                std::collections::HashMap::from([
                    ("_ntes_nuid", token),
                    ("_ntes_nnid", marker.as_str()),
                    ("os", "pc"),
                    (
                        "osver",
                        "Microsoft-Windows-10-Professional-build-19045-64bit"
                    ),
                    ("appver", "3.0.18.203152"),
                ])
            );
        }
        let probe = build_login_request(
            &client,
            "https://music.163.com/api/w/nuser/account/get",
            None,
        )
        .build()
        .unwrap();
        assert_eq!(probe.method(), reqwest::Method::GET);
        assert!(!probe.headers().contains_key("user-agent"));
    }

    #[test]
    fn qr_body_credential_is_host_only_and_preserves_the_response_header() {
        let origin = "https://music.163.com/api/w/nuser/account/get"
            .parse()
            .unwrap();
        let mut store = CookieStore::default();
        for body in [
            "MUSIC_U=",
            "MUSIC_U=broken\r\n",
            "MUSIC_U=first; MUSIC_U=second",
        ] {
            store_qr_credential(&mut store, &json!({"cookie":body}));
            assert_eq!(store.get_request_values(&origin).count(), 0);
        }
        store_qr_credential(
            &mut store,
            &json!({"cookie":"other=ignored; MUSIC_U=synthetic=; Domain=163.com"}),
        );
        assert_eq!(
            store.get_request_values(&origin).collect::<Vec<_>>(),
            [("MUSIC_U", "synthetic=")]
        );
        for url in [
            "https://other.163.com/",
            "https://sub.music.163.com/",
            "http://music.163.com/",
        ] {
            assert_eq!(store.get_request_values(&url.parse().unwrap()).count(), 0);
        }
        let mut store = CookieStore::default();
        store
            .parse("MUSIC_U=header; Path=/; Secure; HttpOnly", &origin)
            .unwrap();
        store_qr_credential(&mut store, &json!({"cookie":"MUSIC_U=another"}));
        assert_eq!(
            store.get_request_values(&origin).next(),
            Some(("MUSIC_U", "header"))
        );
    }

    #[test]
    fn official_qr_codes_do_not_publish_credentials() {
        for (code, status) in [
            (800, "expired"),
            (801, "waiting"),
            (802, "scanned"),
            (803, "signed-in"),
        ] {
            assert_eq!(
                qr_status(&json!({"code":code,"cookie":"private"})).unwrap(),
                json!({"status":status})
            );
        }
        assert!(qr_status(&json!({"code":200})).is_err());
        assert_eq!(
            qr_status(&json!({"code":8821,"cookie":"private"})).unwrap_err(),
            "网易云未完成授权（状态码 8821）。请返回选择登录方式，使用系统浏览器在网易云官网完成登录或安全验证。"
        );
    }
    #[test]
    fn identity_requires_matching_positive_account_and_profile() {
        assert_eq!(
            identity(&json!({"code":200,"account":{"id":1},"profile":{"userId":1}})),
            Some("1".into())
        );
        for value in [
            json!({"code":200,"profile":null,"account":null}),
            json!({"code":200,"account":{"id":2},"profile":{"userId":1}}),
            json!({"code":301,"account":{"id":1},"profile":{"userId":1}}),
        ] {
            assert_eq!(identity(&value), None);
        }
    }
}
