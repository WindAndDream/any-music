//! Read the current account's nickname from Douyin's server-rendered profile data.
use crate::model::HttpRequest;
use serde_json::Value;

const PROFILE_URL: &str = "https://www.douyin.com/user/self";
pub(super) const BODY_LIMIT: usize = 2 * 1024 * 1024;
const RENDER_DATA: &str = r#"<script id="RENDER_DATA" type="application/json">"#;

pub(super) fn is_request(input: &HttpRequest, url: &reqwest::Url) -> bool {
    url.as_str() == PROFILE_URL
        && input.method.as_deref().unwrap_or("GET") == "GET"
        && input.body.is_none()
}

pub(super) fn nickname(body: &[u8], expected_uid: &str) -> Option<String> {
    // The official document embeds percent-encoded JSON in a nonexecutable script.
    let (_, remaining) = std::str::from_utf8(body).ok()?.split_once(RENDER_DATA)?;
    let (encoded, _) = remaining.split_once("</script>")?;
    let json = percent_encoding::percent_decode_str(encoded.trim())
        .decode_utf8()
        .ok()?;
    let data: Value = serde_json::from_str(&json).ok()?;
    let user = data.pointer("/app/user/info")?;
    if data.pointer("/app/odin/user_is_auth")?.as_u64() != Some(1)
        || user["uid"].as_str() != Some(expected_uid)
    {
        return None;
    }
    let name = user["nickname"].as_str()?.trim();
    (!name.is_empty() && name.chars().count() <= 128 && !name.chars().any(char::is_control))
        .then(|| name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};

    fn document(auth: u8, uid: &str, name: &str) -> String {
        let json = serde_json::json!({
            "app":{"odin":{"user_is_auth":auth},"user":{"info":{"uid":uid,"nickname":name}}}
        })
        .to_string();
        let encoded = utf8_percent_encode(&json, NON_ALPHANUMERIC);
        format!("<html><title>Generic title</title>{RENDER_DATA}{encoded}</script></html>")
    }

    #[test]
    fn only_the_authenticated_self_profile_can_supply_a_nickname() {
        assert_eq!(
            nickname(
                document(1, "9007199254740993", "测试昵称 + 音乐").as_bytes(),
                "9007199254740993"
            )
            .as_deref(),
            Some("测试昵称 + 音乐")
        );
        for html in [
            document(0, "123", "访客名称"),
            document(1, "456", "另一账号"),
            document(1, "123", "  "),
            format!("{RENDER_DATA}%ff</script>"),
            "<title>Profile unavailable</title>".into(),
        ] {
            assert_eq!(nickname(html.as_bytes(), "123"), None);
        }
    }
}
