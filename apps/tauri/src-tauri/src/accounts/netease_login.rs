//! Official NetEase login requests stay account-bound; only QR content/status leaves Rust.
use crate::state::{AccountSession, RuntimeState};
use serde_json::{Value, json};

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
    let url = format!("https://music.163.com/api/{path}");
    let work = async {
        let mut response = state
            .send_routed(
                &account,
                session,
                |client| {
                    let request = if let Some(form) = form {
                        client.post(&url).form(form)
                    } else {
                        client.get(&url)
                    };
                    Ok(request.header("Referer", "https://music.163.com/"))
                },
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
    qr_status(&value)
}

fn qr_status(value: &Value) -> Result<Value, String> {
    let status = match value["code"].as_i64() {
        Some(800) => "expired",
        Some(801) => "waiting",
        Some(802) => "scanned",
        Some(803) => "signed-in",
        Some(8821) => {
            return Err("网易云未完成授权（状态码 8821），可能需要额外安全验证。当前暂不支持此验证，请稍后重试。".into());
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
            "网易云未完成授权（状态码 8821），可能需要额外安全验证。当前暂不支持此验证，请稍后重试。"
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
