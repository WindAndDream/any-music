//! Public account facts are independent of the pool's routing status.
use crate::model::Account;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoginState {
    Unknown,
    SignedIn,
    SignedOut,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VerificationState {
    Unknown,
    Required,
    NotRequired,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionState {
    Unknown,
    Available,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AccountState {
    pub login: LoginState,
    pub verification: VerificationState,
    pub connection: ConnectionState,
}

impl AccountState {
    pub fn anonymous() -> Self {
        Self {
            login: LoginState::SignedOut,
            verification: VerificationState::NotRequired,
            connection: ConnectionState::Unknown,
        }
    }
}

impl Account {
    pub fn set_status(&mut self, status: &str) {
        let state = &mut self.state;
        match status {
            "expired" | "signed-out" => state.login = LoginState::SignedOut,
            "verification-required" => state.verification = VerificationState::Required,
            "network-blocked" => state.connection = ConnectionState::Unavailable,
            "ready" => {
                state.verification = VerificationState::NotRequired;
                state.connection = ConnectionState::Available;
            }
            _ => {}
        }
        self.status = status.into();
    }
    /// Successful identity checks do not clear a separate content challenge.
    pub fn confirm_identity(&mut self) {
        let state = &mut self.state;
        state.login = LoginState::SignedIn;
        state.connection = ConnectionState::Available;
        if state.verification != VerificationState::Required {
            state.verification = VerificationState::NotRequired;
            self.status = "ready".into();
        } else {
            self.status = "verification-required".into();
        }
    }
    pub fn complete_login(&mut self) {
        self.set_status("ready");
        self.state.login = LoginState::SignedIn;
    }
    /// Login activity pauses content, without claiming that the platform requested a CAPTCHA.
    pub fn pause_login(&mut self) {
        self.status = "verification-required".into();
    }
    pub fn resume_after_login(&mut self) {
        let state = &self.state;
        self.status = if state.verification == VerificationState::Required {
            "verification-required"
        } else if state.connection == ConnectionState::Unavailable {
            "network-blocked"
        } else if state.login == LoginState::SignedOut && self.authentication == "credential" {
            "expired"
        } else {
            "ready"
        }
        .into();
    }
    /// Request gates project a pause reason; they never invent an authentication outcome.
    pub fn content_error(&self) -> Option<&'static str> {
        let without_login =
            self.platform_id.starts_with("external:") && self.authentication == "anonymous";
        if self.pending
            || !without_login
                && (self.authentication != "credential" || self.state.login != LoginState::SignedIn)
        {
            return Some("not-authenticated:账号未登录，请先登录。");
        }
        match self.status.as_str() {
            "ready" => None,
            "expired" | "signed-out" => Some("not-authenticated:账号未登录，请先登录。"),
            "network-blocked" => Some("network-error:账号连接暂不可用，请检查连接。"),
            "verification-required" if self.state.verification == VerificationState::Required => {
                Some("verification-required:此账号需要完成安全验证。")
            }
            _ => Some("operation-cancelled:账号正在登录或状态尚未确认，请完成当前操作。"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_login_and_confirmed_challenges_have_distinct_request_errors() {
        let mut account: Account = serde_json::from_value(serde_json::json!({
            "id":"a", "platformId":"douyin", "name":"a", "status":"ready",
            "authentication":"credential", "enabled":true, "userAgent":"", "webId":"", "backupProxyIds":[], "state":{"login":"signed-in","verification":"not-required","connection":"available"}
        }))
        .unwrap();
        account.pause_login();
        assert!(
            account
                .content_error()
                .unwrap()
                .starts_with("operation-cancelled:")
        );
        account.resume_after_login();
        assert_eq!(account.status, "ready");
        account.set_status("verification-required");
        account.resume_after_login();
        assert!(
            account
                .content_error()
                .unwrap()
                .starts_with("verification-required:")
        );
        assert_eq!(account.state.login, LoginState::SignedIn);
        account.set_status("expired");
        assert!(
            account
                .content_error()
                .unwrap()
                .starts_with("not-authenticated:")
        );
    }
    #[test]
    fn security_and_network_failures_preserve_login_evidence() {
        let mut account: Account = serde_json::from_value(serde_json::json!({
            "id":"a", "platformId":"douyin", "name":"a", "status":"ready",
            "authentication":"credential", "enabled":true, "userAgent":"", "webId":"", "backupProxyIds":[], "state":{"login":"signed-in","verification":"not-required","connection":"available"}
        }))
        .unwrap();
        account.set_status("verification-required");
        assert_eq!(account.state.login, LoginState::SignedIn);
        account.set_status("network-blocked");
        assert_eq!(account.state.verification, VerificationState::Required);
        account.confirm_identity();
        assert_eq!(account.state.verification, VerificationState::Required);
        account.set_status("expired");
        assert_eq!(account.state.login, LoginState::SignedOut);
        account.complete_login();
        assert_eq!(account.state.login, LoginState::SignedIn);
        assert_eq!(account.state.verification, VerificationState::NotRequired);
    }
}
