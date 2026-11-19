//! Discover's user-operated search tab. The official page owns its rows, scrolling and challenges.
use super::{Action, commands, search};
use crate::{
    browser::{
        cdp::Cdp,
        embedded::{Bounds, Host, expression_source},
        verification::require_main,
    },
    state::RuntimeState,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tauri::{State, Webview};
use tokio_util::sync::CancellationToken;

pub(super) struct Request {
    pub(super) id: String,
    query: String,
}

#[tauri::command]
pub async fn open_douyin_official_search(
    webview: Webview,
    state: State<'_, RuntimeState>,
    account_id: String,
    search_id: String,
    query: String,
) -> Result<(), String> {
    require_main(&webview)?;
    crate::system::capabilities::require_account_platform("douyin")?;
    crate::model::validate_id(&account_id)?;
    let request = search::Request::new(search_id.clone(), query, 0)?;
    let cancel = CancellationToken::new();
    let mut ready = {
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        state.douyin_browsers.reap(&account_id).await?;
        let _lifecycle = state.browsers.lock().unwrap();
        let account = state.account(&account_id)?;
        if account.platform_id != "douyin" || !account.enabled {
            return Err("account-unavailable:抖音账号已停用或不可用。".into());
        }
        if commands::has_pending_login(&state, &account_id) {
            return Err("verification-required:请先完成当前账号的登录或验证。".into());
        }
        if let Some(error) = account.content_error()
            && !error.starts_with("verification-required:")
        {
            return Err(error.into());
        }
        state.douyin_browsers.ensure(&state, &account_id, None)?;
        state.embedded.catalog.reserve(&search_id, &account_id)
    };
    let result = async {
        state
            .douyin_browsers
            .action(
                &account_id,
                |reply| {
                    Action::OpenOfficialSearch(
                        Request {
                            id: search_id.clone(),
                            query: request.query,
                        },
                        reply,
                    )
                },
                &cancel,
            )
            .await?;
        ready
            .wait_for(|ready| *ready)
            .await
            .map_err(|_| "operation-cancelled:抖音搜索页面已关闭。".to_string())?;
        Ok(())
    };
    let result = tokio::time::timeout(Duration::from_secs(85), result)
        .await
        .unwrap_or_else(|_| Err("request-timeout:抖音搜索页面加载超时，请重试。".into()));
    if result.is_err() {
        state.embedded.catalog.close(&search_id);
    }
    result
}

#[tauri::command]
pub fn layout_douyin_official_search(
    webview: Webview,
    state: State<'_, RuntimeState>,
    search_id: String,
    bounds: Option<Bounds>,
) -> Result<bool, String> {
    require_main(&webview)?;
    crate::model::validate_id(&search_id)?;
    state.embedded.catalog.layout(&search_id, bounds)
}

#[tauri::command]
pub fn close_douyin_official_search(
    webview: Webview,
    state: State<'_, RuntimeState>,
    search_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    crate::model::validate_id(&search_id)?;
    state.embedded.catalog.close(&search_id);
    Ok(())
}

pub(super) struct Tab {
    host: Arc<Host>,
    request: Request,
    target: String,
    session: String,
    submitted: bool,
    received: bool,
    revealed: bool,
}

impl Tab {
    pub(super) async fn open(
        host: Arc<Host>,
        cdp: &mut Cdp,
        request: Request,
    ) -> Result<Self, String> {
        if !host.catalog.owns(&request.id) {
            return Err("operation-cancelled:抖音搜索页面已关闭。".into());
        }
        let target = cdp
            .call(None, "Target.createTarget", json!({"officialSearch": true}))
            .await?["targetId"]
            .as_str()
            .ok_or("network-error:无法创建抖音搜索页面。")?
            .to_owned();
        let (target, session) = super::attach_target(cdp, target).await?;
        let tab = Self {
            host,
            request,
            target,
            session,
            submitted: false,
            received: false,
            revealed: false,
        };
        if let Err(error) = cdp
            .call(
                Some(&tab.session),
                "Page.navigate",
                json!({"url":search::HOME_URL}),
            )
            .await
        {
            tab.close(cdp).await;
            return Err(error);
        }
        Ok(tab)
    }

    pub(super) fn observe(&mut self, event: &Value) {
        if event["sessionId"] == self.session
            && event["method"] == "Network.responseReceived"
            && search::response_cursor(&event["params"], &self.request.query) == Some(0)
        {
            self.received = true;
        }
    }

    /// After reveal, leave the page alone. The user scrolls and handles verification in place.
    pub(super) async fn advance(&mut self, cdp: &mut Cdp) -> Result<bool, String> {
        if !self.host.catalog.owns(&self.request.id) {
            return Ok(false);
        }
        if self.revealed && self.submitted {
            return Ok(true);
        }
        let expression = format!(
            "({})({},{},({}))",
            expression_source(include_str!("official-search-page.js")),
            json!(self.request.query),
            self.received,
            expression_source(include_str!("inspect-search-page.js")),
        );
        let result = cdp
            .call(
                Some(&self.session),
                "Runtime.evaluate",
                json!({"expression":expression,"returnByValue":true}),
            )
            .await?;
        match result["result"]["value"].as_str() {
            Some("show" | "challenge") if !self.revealed => {
                self.host
                    .catalog
                    .reveal(&self.host, &self.request.id, &self.target)?;
                self.revealed = true;
            }
            Some("submit") if !self.submitted => {
                self.submitted = search::submit(cdp, &self.session, &self.request.query).await?;
            }
            _ => {}
        }
        Ok(true)
    }

    pub(super) async fn close(self, cdp: &mut Cdp) {
        self.host.catalog.close(&self.request.id);
        let _ = cdp
            .call(None, "Target.closeTarget", json!({"targetId": self.target}))
            .await;
    }
}

impl Drop for Tab {
    fn drop(&mut self) {
        self.host.catalog.close(&self.request.id);
    }
}
