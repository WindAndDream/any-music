use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub platform_id: String,
    pub name: String,
    /// Verified platform identity is independent of the local browser/profile UUID.
    #[serde(default)]
    pub platform_user_id: Option<String>,
    pub status: String,
    pub state: crate::accounts::state::AccountState,
    pub enabled: bool,
    pub authentication: String,
    /// A login draft is not selectable or published as an account until native verification.
    #[serde(default)]
    pub pending: bool,
    pub user_agent: String,
    pub web_id: String,
    pub proxy_id: Option<String>,
    pub backup_proxy_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub accounts: Vec<Account>,
    pub proxies: Vec<ProxyProfile>,
    #[serde(default)]
    pub account_history: Vec<crate::accounts::identity::AccountHistory>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub request_id: String,
    pub account_id: Option<String>,
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub credentials: Option<String>,
    pub response_type: Option<String>,
    pub max_response_bytes: Option<usize>,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: String,
    pub body: serde_json::Value,
}

pub fn platform_url(platform: &str) -> Result<reqwest::Url, String> {
    match platform {
        "bilibili" => Ok("https://www.bilibili.com/".parse().unwrap()),
        "douyin" => Ok("https://www.douyin.com/".parse().unwrap()),
        "netease" => Ok("https://music.163.com/".parse().unwrap()),
        _ => Err("不支持的账号平台。".into()),
    }
}

pub fn validate_public_url(value: &str) -> Result<reqwest::Url, String> {
    let url: reqwest::Url = value.parse().map_err(|_| "无效请求地址。")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("只允许没有 URL 凭证的 HTTP(S) 地址。".into());
    }
    Ok(url)
}

pub fn validate_id(value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "无效账号标识。".into())
}

pub fn classify(platform: &str, status: u16, body: &str) -> &'static str {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        let code = if matches!(platform, "bilibili" | "netease") {
            value.get("code")
        } else {
            value.get("status_code").or_else(|| value.get("statusCode"))
        }
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|text| text.parse().ok()))
        });
        // Mirror the source adapters' validated platform codes; unrelated business errors stay source-owned.
        match (platform, code) {
            ("bilibili", Some(-412 | -352)) | ("douyin", Some(2483)) => {
                return "verification-required";
            }
            ("netease", Some(-460)) => return "verification-required",
            _ => {}
        }
        if value
            .get("verify_url")
            .or_else(|| value.pointer("/data/verify_url"))
            .and_then(|v| v.as_str())
            .is_some_and(|v| !v.is_empty())
        {
            return "verification-required";
        }
        match (platform, code) {
            ("bilibili", Some(-101))
            | ("douyin", Some(8 | 9 | 10002))
            | ("netease", Some(301 | 401)) => return "expired",
            _ => {}
        }
    }
    if body.trim_start().starts_with('<') && (body.contains("验证码") || body.contains("captcha"))
    {
        return "verification-required";
    }
    if status == 401 { "expired" } else { "ready" }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_rejects_paths_and_credentials() {
        assert!(validate_id("../../other").is_err());
        assert!(validate_public_url("file:///etc/passwd").is_err());
        assert!(validate_public_url("https://user:pass@example.com").is_err());
    }
    #[test]
    fn netease_content_denial_and_rate_limits_do_not_establish_logout() {
        assert_eq!(classify("netease", 200, r#"{"code":301}"#), "expired");
        assert_eq!(
            classify("netease", 200, r#"{"code":-460}"#),
            "verification-required"
        );
        assert_eq!(classify("netease", 200, r#"{"code":405}"#), "ready");
        assert_eq!(
            classify("netease", 200, r#"{"code":200,"data":[{"code":-110}]}"#),
            "ready"
        );
    }
    #[test]
    fn verification_pauses_without_classifying_generic_failure_as_proxy() {
        for body in [
            r#"{"status_code":2483}"#,
            r#"{"status_code":8,"verify_url":"https://www.douyin.com/verify"}"#,
            "<html>captcha</html>",
        ] {
            assert_eq!(classify("douyin", 401, body), "verification-required");
        }
        assert_eq!(classify("douyin", 401, ""), "expired");
        // HTTP denial/rate limits alone do not establish an authentication challenge.
        assert_eq!(classify("douyin", 429, ""), "ready");
        assert_eq!(classify("douyin", 403, ""), "ready");
        assert_eq!(
            classify(
                "douyin",
                429,
                "{\"verify_url\":\"https://www.douyin.com/verify\"}"
            ),
            "verification-required"
        );
        assert_eq!(classify("bilibili", 200, "{\"code\":-101}"), "expired");
        assert_eq!(
            classify("douyin", 200, "{\"status_code\":2483}"),
            "verification-required"
        );
        assert_eq!(classify("douyin", 200, "{\"statusCode\":\"8\"}"), "expired");
        assert_eq!(classify("bilibili", 200, "{\"code\":8}"), "ready");
        assert_eq!(classify("douyin", 503, "unavailable"), "ready");
    }
}
