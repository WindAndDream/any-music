//! Allowlisted response projections, never the official SDK's private challenge context.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::collections::HashMap;

pub const PROFILE_PATH: &str = "/aweme/v1/web/user/profile/self/";
pub fn endpoint(url: &str) -> Option<&'static str> {
    let url = reqwest::Url::parse(url).ok()?;
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    match (url.host_str()?, url.path()) {
        // The official SDK can issue Passport requests on the page origin instead
        // of login.douyin.com. Observe both exact origins, never suffix matches.
        ("login.douyin.com" | "www.douyin.com", "/passport/web/get_qrcode/") => Some("qr"),
        ("login.douyin.com" | "www.douyin.com", "/passport/web/check_qrconnect/") => Some("poll"),
        ("www.douyin.com", "/passport/web/send_code/") => Some("send"),
        ("www.douyin.com", "/passport/web/validate_code/") => Some("validate"),
        ("www.douyin.com", PROFILE_PATH) => Some("profile"),
        _ => None,
    }
}
/// Preflight and navigation bodies are not Passport application responses.
pub fn response_endpoint(params: &Value) -> Option<&'static str> {
    if !matches!(params["type"].as_str(), Some("XHR" | "Fetch")) {
        return None;
    }
    endpoint(params["response"]["url"].as_str()?)
}
pub fn project(kind: &str, value: &Value) -> Option<Value> {
    let data = &value["data"];
    let code = data["error_code"]
        .as_i64()
        .or_else(|| value["error_code"].as_i64())
        .unwrap_or_else(|| {
            if matches!(kind, "send" | "validate") && value["message"] == "success" {
                0
            } else {
                -1
            }
        });
    if code == 4031 || data["captcha"].as_str().is_some_and(|v| !v.is_empty()) {
        return Some(
            json!({"status":"blocked","message":"官方页面要求安全验证，请主动打开官方浏览器。"}),
        );
    }
    if code == 2046 {
        let methods = data["verify_ways"]
            .as_array()?
            .iter()
            .map(|way| {
                let id = way["verify_way"].as_str().unwrap_or("other");
                match id {
                    "mobile_sms_verify" => json!({"id":id,"label":"接收短信验证码","inApp":true}),
                    "face_verify" => json!({"id":id,"label":"手机刷脸验证","inApp":false}),
                    "mobile_up_sms_verify" => json!({"id":id,"label":"发送短信验证","inApp":false}),
                    _ => json!({"id":"other","label":"其他验证方式","inApp":false}),
                }
            })
            .collect::<Vec<_>>();
        return Some(json!({"status":"verification-required","verification":{
            "methods":methods,"selectedMethod":"","maskedMobile":"","retryAfter":0,"codeLength":6
        }}));
    }
    if code != 0 {
        if matches!(kind, "send" | "validate") {
            return Some(json!({"smsResult":kind,"accepted":false}));
        }
        return Some(
            json!({"status":"blocked","message":"官方登录请求未成功，已停止自动操作。可主动打开官方浏览器。"}),
        );
    }
    if let Some(image) = data["qrcode"].as_str().filter(|v| v.len() <= 512 * 1024) {
        let bytes = STANDARD.decode(image).ok()?;
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return None;
        }
        return Some(
            json!({"status":"waiting","qrImage":format!("data:image/png;base64,{image}")}),
        );
    }
    if kind == "send" || kind == "validate" {
        let mobile = data["mobile"]
            .as_str()
            .filter(|v| {
                v.len() <= 32
                    && v.contains('*')
                    && v.chars().all(|c| c.is_ascii_digit() || c == '*')
            })
            .unwrap_or("");
        return Some(
            json!({"status":"verification-required","smsResult":kind,"accepted":true,"maskedMobile":mobile,"retryAfter":data["retry_time"].as_u64().unwrap_or(60).min(600)}),
        );
    }
    match data["status"].as_str()? {
        "new" => Some(json!({"status":"waiting"})),
        "scanned" => Some(json!({"status":"scanned"})),
        "confirmed" => Some(json!({"status":"signed-in"})),
        "expired" => Some(json!({"status":"expired"})),
        _ => None,
    }
}
pub fn authenticated_profile(value: &Value) -> bool {
    value["status_code"].as_i64() == Some(0) && value["user"].is_object()
}
/// Explicit authentication evidence is required before a status check invalidates an account.
pub fn validate_profile(value: &Value, status: u16) -> Result<(), String> {
    // A challenge can also use HTTP 401 or an authentication-looking business code.
    if value["status_code"].as_i64() == Some(2483)
        || value["verify_url"].as_str().is_some_and(|v| !v.is_empty())
        || value
            .pointer("/data/verify_url")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty())
    {
        return Err("verification-required:官方页面要求安全验证。".into());
    }
    match value["status_code"].as_i64() {
        Some(8 | 9 | 10002) => Err("not-authenticated:官方页面登录已失效，请重新登录。".into()),
        Some(2483) => Err("verification-required:官方页面要求安全验证。".into()),
        _ if status == 401 => Err("not-authenticated:官方页面登录已失效，请重新登录。".into()),
        _ if status != 200 => Err(format!("upstream-error:官方账号检查返回 HTTP {status}。")),
        Some(0) if value["user"].is_object() => Ok(()),
        Some(0) => Err("invalid-response:官方账号响应缺少用户资料，请重试。".into()),
        Some(_) => Err("upstream-error:官方账号检查暂不可用，请重试。".into()),
        None => Err("invalid-response:官方账号响应格式改变。".into()),
    }
}

/// A login panel/rejected request alone cannot distinguish logout from a session challenge.
/// Retained browser credentials require verification; only their absence confirms logout.
pub fn authentication_error(has_login: bool) -> String {
    if has_login {
        "verification-required:账号仍有登录凭证，请在官方浏览器中完成验证后重试。".into()
    } else {
        "not-authenticated:官方页面未登录，请重新登录。".into()
    }
}
pub fn cookie_store(values: &Value) -> Result<reqwest_cookie_store::CookieStore, String> {
    let mut store = reqwest_cookie_store::CookieStore::default();
    for cookie in values["cookies"].as_array().ok_or("账号凭证响应无效。")? {
        let domain = cookie["domain"].as_str().unwrap_or("");
        let host = domain.trim_start_matches('.');
        if host != "douyin.com" && !host.ends_with(".douyin.com") {
            continue;
        }
        let name = cookie["name"].as_str().unwrap_or("");
        let value = cookie["value"].as_str().unwrap_or("");
        let path = cookie["path"].as_str().unwrap_or("/");
        if name.is_empty()
            || [name, value, path, domain]
                .iter()
                .any(|v| v.contains(['\r', '\n', ';']))
        {
            continue;
        }
        let domain = if domain.starts_with('.') {
            format!("; Domain={host}")
        } else {
            String::new()
        };
        let secure = if cookie["secure"] == true {
            "; Secure"
        } else {
            ""
        };
        let http_only = if cookie["httpOnly"] == true {
            "; HttpOnly"
        } else {
            ""
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let expires = cookie["expires"].as_f64().filter(|v| *v > 0.0);
        // A CDP snapshot may outlive a short-lived cookie. Never let that cookie
        // abort valid account credentials, or round a still-live cookie down to zero.
        if expires.is_some_and(|expires| expires <= now) {
            continue;
        }
        let expiry = expires
            .map(|expires| format!("; Max-Age={}", (expires - now).ceil() as u64))
            .unwrap_or_default();
        match store.parse(
            &format!("{name}={value}{domain}; Path={path}{secure}{http_only}{expiry}"),
            &format!("https://{host}/")
                .parse()
                .map_err(|_| "凭证域名无效。")?,
        ) {
            Ok(_) | Err(cookie_store::CookieError::Expired) => {}
            Err(_) => return Err("账号凭证导入失败。".into()),
        }
    }
    Ok(store)
}
pub fn has_login(store: &reqwest_cookie_store::CookieStore) -> bool {
    store
        .get_request_values(&"https://www.douyin.com/".parse().unwrap())
        .any(|(name, value)| matches!(name, "sessionid" | "sessionid_ss") && !value.is_empty())
}

/// Apply browser changes, preserving newer native HTTP cookies absent from this snapshot.
/// A serialized account queue prevents concurrent commits but cannot make an old browser
/// snapshot authoritative for cookies changed by a preceding native HTTP operation.
pub fn merge_cookie_changes(
    store: &mut reqwest_cookie_store::CookieStore,
    before: &Value,
    after: &Value,
) -> Result<(), String> {
    fn indexed(value: &Value) -> Result<HashMap<(&str, &str, &str), &Value>, String> {
        Ok(value["cookies"]
            .as_array()
            .ok_or("账号凭证响应无效。")?
            .iter()
            .filter_map(|cookie| {
                let domain = cookie["domain"].as_str()?;
                let host = domain.trim_start_matches('.');
                if host != "douyin.com" && !host.ends_with(".douyin.com") {
                    return None;
                }
                Some((
                    (
                        domain,
                        cookie["path"].as_str().unwrap_or("/"),
                        cookie["name"].as_str()?,
                    ),
                    cookie,
                ))
            })
            .collect())
    }
    let before = indexed(before)?;
    let after = indexed(after)?;
    let changed = after
        .iter()
        .filter(|(key, cookie)| before.get(*key) != Some(*cookie))
        .map(|(_, cookie)| (*cookie).clone())
        .collect::<Vec<_>>();
    let changes = cookie_store(&json!({"cookies":changed}))?;
    let mut next = store.clone();
    for (domain, path, name) in before.keys().filter(|key| !after.contains_key(*key)) {
        next.remove(domain.trim_start_matches('.'), path, name);
    }
    for cookie in changes.iter_any() {
        let domain = cookie.domain.as_cow().ok_or("凭证域名无效。")?;
        let url = format!("https://{domain}/")
            .parse()
            .map_err(|_| "凭证域名无效。")?;
        next.insert(cookie.clone(), &url)
            .map_err(|_| "账号凭证导入失败。")?;
    }
    *store = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_probe_requires_authentication_evidence_and_keeps_unknown_failures_distinct() {
        assert!(validate_profile(&json!({"status_code":0,"user":{"uid":"12"}}), 200).is_ok());
        for code in [8, 9, 10002] {
            assert!(
                validate_profile(&json!({"status_code":code}), 200)
                    .unwrap_err()
                    .starts_with("not-authenticated:")
            );
        }
        assert!(
            validate_profile(&json!({"status_code":2483}), 200)
                .unwrap_err()
                .starts_with("verification-required:")
        );
        assert!(
            validate_profile(&json!({"status_code":0,"user":null}), 200)
                .unwrap_err()
                .starts_with("invalid-response:")
        );
        assert!(
            validate_profile(&json!({"status_code":0,"user":null}), 503)
                .unwrap_err()
                .starts_with("upstream-error:")
        );
        assert!(
            validate_profile(&json!({"status_code":500}), 200)
                .unwrap_err()
                .starts_with("upstream-error:")
        );
        assert!(
            validate_profile(&json!({"message":"unexpected"}), 200)
                .unwrap_err()
                .starts_with("invalid-response:")
        );
    }
    #[test]
    fn security_evidence_takes_priority_over_http_or_business_authentication_rejections() {
        for profile in [
            json!({"status_code":2483}),
            json!({"status_code":8,"verify_url":"https://www.douyin.com/verify"}),
            json!({"status_code":9,"data":{"verify_url":"https://www.douyin.com/verify"}}),
        ] {
            for status in [200, 401, 403] {
                assert!(
                    validate_profile(&profile, status)
                        .unwrap_err()
                        .starts_with("verification-required:")
                );
            }
        }
        assert!(authentication_error(true).starts_with("verification-required:"));
        assert!(authentication_error(false).starts_with("not-authenticated:"));
    }
    #[test]
    fn browser_delta_preserves_native_updates_and_applies_changed_paths_and_deletions() {
        let before = json!({"cookies":[
            {"name":"sessionid","value":"old-browser","domain":".douyin.com","path":"/"},
            {"name":"remove","value":"old","domain":"www.douyin.com","path":"/"},
            {"name":"token","value":"old","domain":"www.douyin.com","path":"/search"}
        ]});
        let mut store = cookie_store(&before).unwrap();
        let url = "https://www.douyin.com/".parse().unwrap();
        store
            .parse("sessionid=new-native; Domain=douyin.com; Path=/", &url)
            .unwrap();
        store.parse("native-only=preserved; Path=/", &url).unwrap();
        let after = json!({"cookies":[
            before["cookies"][0].clone(),
            {"name":"token","value":"new-browser","domain":"www.douyin.com","path":"/search"},
            {"name":"fresh","value":"browser","domain":"www.douyin.com","path":"/"},
            {"name":"noise","value":"excluded","domain":"evil.test","path":"/"}
        ]});
        merge_cookie_changes(&mut store, &before, &after).unwrap();
        let values = store.get_request_values(&url).collect::<HashMap<_, _>>();
        assert_eq!(values.get("sessionid"), Some(&"new-native"));
        assert_eq!(values.get("native-only"), Some(&"preserved"));
        assert_eq!(values.get("fresh"), Some(&"browser"));
        assert!(!values.contains_key("remove"));
        assert!(!values.contains_key("token"));
        assert!(!values.contains_key("noise"));
        assert_eq!(
            store
                .get_request_values(&"https://www.douyin.com/search".parse().unwrap())
                .find(|(name, _)| *name == "token")
                .unwrap()
                .1,
            "new-browser"
        );
    }
    #[test]
    fn sms_uses_the_captured_web_origin_and_success_envelope() {
        assert_eq!(
            endpoint("https://www.douyin.com/passport/web/send_code/"),
            Some("send")
        );
        assert_eq!(
            endpoint("https://www.douyin.com/passport/web/validate_code/"),
            Some("validate")
        );
        assert_eq!(
            endpoint("https://login.douyin.com/passport/web/send_code/"),
            None
        );
        let public=project("send",&json!({"message":"success","data":{"mobile":"138****5678","retry_time":60,"mobile_ticket":"private"}})).unwrap();
        assert_eq!(public["accepted"], true);
        assert_eq!(public["retryAfter"], 60);
        assert_eq!(public["maskedMobile"], "138****5678");
        assert!(!public.to_string().contains("private"));
        assert_eq!(
            project(
                "validate",
                &json!({"message":"success","data":{"ticket":"private"}})
            )
            .unwrap()["accepted"],
            true
        );
        assert_eq!(
            project("validate", &json!({"data":{"error_code":1001}})).unwrap()["accepted"],
            false
        );
        assert_eq!(
            project(
                "send",
                &json!({"message":"success","data":{"mobile":"13812345678"}})
            )
            .unwrap()["maskedMobile"],
            ""
        );
    }
    #[test]
    fn preflight_never_enters_the_response_body_queue() {
        for kind in ["Preflight", "Document", "Image"] {
            assert_eq!(
                response_endpoint(
                    &json!({"type":kind,"response":{"url":"https://login.douyin.com/passport/web/get_qrcode/"}})
                ),
                None
            );
        }
        assert_eq!(
            response_endpoint(
                &json!({"type":"Fetch","response":{"url":"https://login.douyin.com/passport/web/get_qrcode/"}})
            ),
            Some("qr")
        );
    }
    #[test]
    fn only_exact_login_origins_and_no_private_context() {
        for host in ["login.douyin.com", "www.douyin.com"] {
            for (path, kind) in [("get_qrcode", "qr"), ("check_qrconnect", "poll")] {
                for resource_type in ["XHR", "Fetch"] {
                    assert_eq!(
                        response_endpoint(&json!({"type":resource_type,"response":{
                            "url":format!("https://{host}/passport/web/{path}/?token=secret")
                        }})),
                        Some(kind)
                    );
                }
            }
        }
        for url in [
            "https://login.douyin.com.evil/passport/web/get_qrcode/",
            "http://login.douyin.com/passport/web/get_qrcode/",
            "https://user@login.douyin.com/passport/web/get_qrcode/",
            "https://www.douyin.com.evil/passport/web/get_qrcode/",
            "https://www.douyin.com:8443/passport/web/get_qrcode/",
            "https://www.douyin.com/passport/web/other/",
        ] {
            assert_eq!(endpoint(url), None);
        }
        let value = json!({"data":{"error_code":2046,"verify_ways":[{"verify_way":"mobile_sms_verify"},{"verify_way":"secret-way"}],"common_params":{"std_verify_token":"private"},"description":"private","encrypt_uid":"private"}});
        let public = project("poll", &value).unwrap();
        assert_eq!(public["verification"]["methods"][0]["inApp"], true);
        assert!(!public.to_string().contains("private"));
        assert!(!public.to_string().contains("secret-way"));
    }
    #[test]
    fn qr_refresh_risk_and_final_login_are_distinct() {
        let image = STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture");
        assert_eq!(
            project(
                "poll",
                &json!({"data":{"error_code":0,"qrcode":image,"token":"private"}})
            )
            .unwrap()["status"],
            "waiting"
        );
        assert_eq!(
            project("poll", &json!({"data":{"error_code":4031}})).unwrap()["status"],
            "blocked"
        );
        assert_eq!(
            project(
                "poll",
                &json!({"data":{"error_code":0,"status":"confirmed"}})
            )
            .unwrap()["status"],
            "signed-in"
        );
        assert!(project("qr", &json!({"data":{"error_code":0,"qrcode":"invalid"}})).is_none());
        assert!(!authenticated_profile(&json!({"status_code":0})));
    }
    #[test]
    fn credentials_stay_platform_scoped_and_require_login_cookie() {
        let values = json!({"cookies":[{"name":"sessionid","value":"fixture","domain":".douyin.com","path":"/","secure":true,"httpOnly":true}, {"name":"outside","value":"private","domain":"evil.com"}]});
        let store = cookie_store(&values).unwrap();
        assert!(has_login(&store));
        assert_eq!(store.iter_any().count(), 1);
        assert!(!has_login(&cookie_store(&json!({"cookies":[]})).unwrap()));
    }
    #[test]
    fn expired_snapshot_cookies_do_not_abort_valid_credentials() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64();
        let values = json!({"cookies":[
            {"name":"sessionid","value":"fixture","domain":".douyin.com","path":"/","expires":now+3600.0},
            {"name":"expired","value":"fixture","domain":".douyin.com","path":"/","expires":now-1.0},
            {"name":"short","value":"fixture","domain":".douyin.com","path":"/","expires":now+0.5}
        ]});
        let store = cookie_store(&values).unwrap();
        assert!(has_login(&store));
        assert_eq!(store.iter_any().count(), 2);
        assert!(!has_login(&cookie_store(&json!({"cookies":[
            {"name":"sessionid","value":"fixture","domain":".douyin.com","path":"/","expires":now-1.0}
        ]})).unwrap()));
    }
}
