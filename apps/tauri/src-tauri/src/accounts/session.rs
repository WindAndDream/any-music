//! Session recovery is limited to official identity probes; content requests remain paused.
use crate::model::{Account, HttpRequest};
use serde_json::Value;

/// Abandoning verification supplies no logout evidence and cannot clear a content challenge.
pub fn cancel_verification(state: &crate::state::RuntimeState, id: &str) -> Result<(), String> {
    state.mutate(|snapshot| {
        snapshot
            .accounts
            .iter_mut()
            .find(|account| account.id == id)
            .ok_or("账号不存在。")?
            .resume_after_login();
        Ok(())
    })
}

/// A valid identity does not prove that a separate content security challenge was completed.
pub fn confirm_identity(
    state: &crate::state::RuntimeState,
    id: &str,
    user_id: &str,
) -> Result<(), String> {
    state.mutate(|snapshot| {
        crate::accounts::identity::bind(snapshot, id, user_id)?;
        let account = snapshot
            .accounts
            .iter_mut()
            .find(|account| account.id == id)
            .ok_or("账号不存在。")?;
        account.confirm_identity();
        Ok(())
    })
}

pub fn is_bilibili_probe(account: &Account, input: &HttpRequest, url: &reqwest::Url) -> bool {
    account.platform_id == "bilibili"
        && input.method.as_deref().unwrap_or("GET") == "GET"
        && input.body.is_none()
        && url.scheme() == "https"
        && url.host_str() == Some("api.bilibili.com")
        && url.port_or_known_default() == Some(443)
        && url.path() == "/x/web-interface/nav"
        && url.query().is_none()
        && url.fragment().is_none()
}

pub fn is_identity_probe(account: &Account, input: &HttpRequest, url: &reqwest::Url) -> bool {
    is_bilibili_probe(account, input, url)
        || (account.platform_id == "netease"
            && input.method.as_deref().unwrap_or("GET") == "GET"
            && input.body.is_none()
            && url.scheme() == "https"
            && url.host_str() == Some("music.163.com")
            && url.port_or_known_default() == Some(443)
            && url.path() == "/api/w/nuser/account/get"
            && url.query().is_none()
            && url.fragment().is_none())
}

pub fn identity_status(account: &Account, status: u16, body: &str) -> Option<&'static str> {
    if account.platform_id != "netease" {
        return bilibili_status(&account.authentication, status, body);
    }
    if status != 200 {
        return None;
    }
    let value: Value = serde_json::from_str(body).ok()?;
    if super::netease_login::identity(&value).is_some() {
        return Some("ready");
    }
    if value["code"] == 200
        && value.get("profile").is_some_and(Value::is_null)
        && value.get("account").is_some_and(Value::is_null)
    {
        return Some(if account.authentication == "credential" {
            "expired"
        } else {
            "signed-out"
        });
    }
    None
}

/// A malformed/error response must never clear a pause or invalidate stored credentials.
pub fn bilibili_status(authentication: &str, status: u16, body: &str) -> Option<&'static str> {
    if status != 200 {
        return None;
    }
    let value: Value = serde_json::from_str(body).ok()?;
    if value["code"].as_i64() != Some(0) {
        return None;
    }
    match value.pointer("/data/isLogin")?.as_bool()? {
        true if value
            .pointer("/data/mid")
            .and_then(Value::as_u64)
            .is_some_and(|id| id > 0) =>
        {
            Some("ready")
        }
        false if authentication == "credential" => Some("expired"),
        false => Some("signed-out"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn netease_recovery_accepts_only_exact_identity_probes_and_valid_profiles() {
        let account: Account = serde_json::from_value(json!({"id":"a","platformId":"netease","name":"a","enabled":true,"status":"expired","authentication":"credential","userAgent":"","webId":"", "backupProxyIds":[], "state":{"login":"signed-in","verification":"not-required","connection":"available"},"proxyId":null})).unwrap();
        let mut input: HttpRequest = serde_json::from_value(
            json!({"requestId":"r","url":"https://music.163.com/api/w/nuser/account/get"}),
        )
        .unwrap();
        assert!(is_identity_probe(
            &account,
            &input,
            &input.url.parse().unwrap()
        ));
        for url in [
            "https://music.163.com/api/w/nuser/account/get?extra=1",
            "https://music.163.com.evil.example/api/w/nuser/account/get",
            "https://music.163.com/api/cloudsearch/pc",
        ] {
            assert!(!is_identity_probe(&account, &input, &url.parse().unwrap()));
        }
        input.method = Some("POST".into());
        assert!(!is_identity_probe(
            &account,
            &input,
            &input.url.parse().unwrap()
        ));
        assert_eq!(
            identity_status(
                &account,
                200,
                r#"{"code":200,"account":null,"profile":null}"#
            ),
            Some("expired")
        );
        assert_eq!(
            identity_status(
                &account,
                200,
                r#"{"code":200,"account":{"id":1},"profile":{"userId":1}}"#
            ),
            Some("ready")
        );
        for body in [
            r#"{"code":200}"#,
            r#"{"code":200,"account":{"id":1},"profile":{"userId":2}}"#,
            r#"{"code":500}"#,
        ] {
            assert_eq!(identity_status(&account, 200, body), None);
        }
    }
    #[test]
    fn cancelled_verification_preserves_an_existing_login_and_never_implies_expiry_or_success() {
        let directory = std::env::temp_dir().join(format!(
            "any-music-cancel-verification-{}",
            uuid::Uuid::new_v4()
        ));
        let state = crate::state::RuntimeState::new(directory.clone()).unwrap();
        let id = crate::state::add_test_account(&state, "douyin").id;
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].authentication = "credential".into();
                Ok(())
            })
            .unwrap();
        for status in [
            "verification-required",
            "ready",
            "expired",
            "network-blocked",
        ] {
            state
                .mutate(|snapshot| {
                    snapshot.accounts[0].complete_login();
                    Ok(())
                })
                .unwrap();
            state.status(&id, status).unwrap();
            cancel_verification(&state, &id).unwrap();
            assert_eq!(state.account(&id).unwrap().status, status);
        }
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].authentication = "anonymous".into();
                Ok(())
            })
            .unwrap();
        state.status(&id, "verification-required").unwrap();
        cancel_verification(&state, &id).unwrap();
        assert_eq!(state.account(&id).unwrap().status, "verification-required");
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn a_valid_identity_recovers_expiry_but_does_not_clear_content_verification() {
        let directory =
            std::env::temp_dir().join(format!("any-music-identity-check-{}", uuid::Uuid::new_v4()));
        let state = crate::state::RuntimeState::new(directory.clone()).unwrap();
        let id = crate::state::add_test_account(&state, "bilibili").id;
        state.status(&id, "verification-required").unwrap();
        confirm_identity(&state, &id, "12").unwrap();
        assert_eq!(state.account(&id).unwrap().status, "verification-required");
        for status in ["expired", "signed-out", "network-blocked"] {
            state
                .mutate(|snapshot| {
                    snapshot.accounts[0].complete_login();
                    Ok(())
                })
                .unwrap();
            state.status(&id, status).unwrap();
            confirm_identity(&state, &id, "12").unwrap();
            assert_eq!(state.account(&id).unwrap().status, "ready");
        }
        std::fs::remove_file(directory.join("accounts.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn recovery_only_allows_a_read_only_official_identity_probe() {
        let account: Account = serde_json::from_value(json!({"id":"a","platformId":"bilibili","name":"a","enabled":true,"status":"expired","authentication":"credential","userAgent":"","webId":"", "backupProxyIds":[], "state":{"login":"signed-in","verification":"not-required","connection":"available"},"proxyId":null})).unwrap();
        let mut input: HttpRequest = serde_json::from_value(
            json!({"requestId":"r","url":"https://api.bilibili.com/x/web-interface/nav"}),
        )
        .unwrap();
        assert!(is_bilibili_probe(
            &account,
            &input,
            &input.url.parse().unwrap()
        ));
        for url in [
            "https://api.bilibili.com/x/web-interface/search/type",
            "https://api.bilibili.com.example/x/web-interface/nav",
            "http://api.bilibili.com/x/web-interface/nav",
            "https://api.bilibili.com:444/x/web-interface/nav",
            "https://api.bilibili.com/x/web-interface/nav?probe=1",
        ] {
            assert!(!is_bilibili_probe(&account, &input, &url.parse().unwrap()));
        }
        input.method = Some("POST".into());
        assert!(!is_bilibili_probe(
            &account,
            &input,
            &input.url.parse().unwrap()
        ));
    }

    #[test]
    fn probe_distinguishes_expiry_guests_and_unknown_failures() {
        assert_eq!(
            bilibili_status(
                "credential",
                200,
                r#"{"code":0,"data":{"isLogin":true,"mid":12}}"#
            ),
            Some("ready")
        );
        assert_eq!(
            bilibili_status("credential", 200, r#"{"code":0,"data":{"isLogin":false}}"#),
            Some("expired")
        );
        assert_eq!(
            bilibili_status("anonymous", 200, r#"{"code":0,"data":{"isLogin":false}}"#),
            Some("signed-out")
        );
        for body in [
            "invalid",
            r#"{"code":0}"#,
            r#"{"code":0,"data":{"isLogin":true}}"#,
            r#"{"code":-500}"#,
        ] {
            assert_eq!(bilibili_status("credential", 200, body), None);
        }
        assert_eq!(
            bilibili_status("credential", 503, r#"{"code":0,"data":{"isLogin":false}}"#),
            None
        );
    }
}
