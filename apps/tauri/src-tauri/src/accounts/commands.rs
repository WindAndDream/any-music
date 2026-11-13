use crate::{
    browser::verification::require_main,
    model::{Account, platform_url, validate_id},
    state::{RuntimeState, USER_AGENT},
};
use std::collections::HashSet;
use tauri::{State, WebviewWindow};

#[tauri::command]
pub fn account_snapshot(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<serde_json::Value, String> {
    require_main(&window)?;
    let snapshot = state.snapshot.lock().unwrap();
    Ok(
        serde_json::json!({"accounts":snapshot.accounts.iter().filter(|a| !a.pending).collect::<Vec<_>>(),"proxies":snapshot.proxies,
        "accountLabels":crate::accounts::identity::labels(&snapshot)}),
    )
}

#[tauri::command]
pub fn cancel_platform_requests(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    platform_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    platform_url(&platform_id)?;
    cancel_platform_work(&state, &platform_id);
    Ok(())
}

// Switching identity retires in-memory work while preserving credentials and account configuration.
fn cancel_platform_work(state: &RuntimeState, platform_id: &str) {
    let ids: Vec<String> = state
        .snapshot
        .lock()
        .unwrap()
        .accounts
        .iter()
        .filter(|account| account.platform_id == platform_id)
        .map(|account| account.id.clone())
        .collect();
    for id in &ids {
        state.douyin_browsers.cancel(id);
        if let Some(session) = state.sessions.lock().unwrap().remove(id) {
            session.cancelled.cancel();
        }
    }
    // Preserve cancellation order, then index the retired identities once for all grants.
    let retired: HashSet<&str> = ids.iter().map(String::as_str).collect();
    state.media.lock().unwrap().retain(|_, grant| {
        !grant
            .account_id
            .as_deref()
            .is_some_and(|id| retired.contains(id))
    });
}

#[tauri::command]
pub fn create_account(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, RuntimeState>,
    platform_id: String,
    name: String,
) -> Result<Account, String> {
    require_main(&window)?;
    #[cfg(desktop)]
    if super::super::plugins::source_auth::is_external(&platform_id) {
        crate::plugins::source_auth::validate_platform(&app, &platform_id)?;
    } else {
        platform_url(&platform_id)?;
        crate::system::capabilities::require_account_platform(&platform_id)?;
    }
    #[cfg(mobile)]
    {
        let _ = app;
        platform_url(&platform_id)?;
        crate::system::capabilities::require_account_platform(&platform_id)?;
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("账号名称需要 1–80 个字符。".into());
    }
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        platform_id,
        name: name.into(),
        platform_user_id: None,
        status: "signed-out".into(),
        state: crate::accounts::state::AccountState::anonymous(),
        enabled: true,
        authentication: "credential".into(),
        pending: true,
        user_agent: USER_AGENT.into(),
        web_id: rand::random::<u64>().to_string(),
        proxy_id: None,
        backup_proxy_ids: Vec::new(),
    };
    state.mutate(|snapshot| {
        if let Some(existing) = snapshot
            .accounts
            .iter_mut()
            .find(|a| a.platform_id == account.platform_id && a.name == account.name)
        {
            if existing.pending {
                if state.usage.is_deleting(&existing.id) {
                    return Err("上次登录正在结束，请稍后重试。".into());
                }
                existing.enabled = true;
                return Ok(existing.clone());
            }
            return Err("同平台账号名称重复。".into());
        }
        if snapshot.accounts.len() >= 256 {
            return Err("最多添加 256 个账号。".into());
        }
        snapshot.accounts.push(account.clone());
        Ok(account.clone())
    })
}

#[tauri::command]
pub fn update_account(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    name: String,
    enabled: bool,
    proxy_id: Option<String>,
    backup_proxy_ids: Option<Vec<String>>,
) -> Result<(), String> {
    require_main(&window)?;
    state.account(&account_id)?;
    if state
        .account(&account_id)?
        .platform_id
        .starts_with("external:")
        && (proxy_id.is_some() || backup_proxy_ids.as_ref().is_some_and(|ids| !ids.is_empty()))
    {
        return Err("外置来源使用受控公网接口，不支持内置账号代理。".into());
    }
    let _usage = state.use_account(&account_id, "更新设置")?;
    let mut browsers = state.browsers.lock().unwrap();
    if crate::browser::verification::retain_running(&mut browsers, &account_id)? {
        return Err("请先完成此账号的浏览器验证，再修改账号配置。".into());
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("账号名称需要 1–80 个字符。".into());
    }
    let environment_changed = state.mutate(|snapshot| {
        if proxy_id
            .as_ref()
            .is_some_and(|id| !snapshot.proxies.iter().any(|p| &p.id == id))
        {
            return Err("代理不存在。".into());
        }
        let platform = snapshot
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or("账号不存在。")?
            .platform_id
            .clone();
        if snapshot
            .accounts
            .iter()
            .any(|a| a.id != account_id && a.platform_id == platform && a.name == name)
        {
            return Err("同平台账号名称重复。".into());
        }
        let mut next = snapshot
            .accounts
            .iter()
            .find(|a| a.id == account_id)
            .ok_or("账号不存在。")?
            .clone();
        next.proxy_id = proxy_id.clone();
        next.backup_proxy_ids = backup_proxy_ids.unwrap_or_default();
        crate::network::proxy_routing::validate_assignment(&next, &snapshot.proxies)?;
        let account = snapshot
            .accounts
            .iter_mut()
            .find(|a| a.id == account_id)
            .ok_or("账号不存在。")?;
        let environment_changed = account.enabled != enabled
            || account.proxy_id != proxy_id
            || account.backup_proxy_ids != next.backup_proxy_ids;
        account.name = name.into();
        account.enabled = enabled;
        account.proxy_id = proxy_id;
        account.backup_proxy_ids = next.backup_proxy_ids;
        Ok(environment_changed)
    })?;
    if environment_changed {
        #[cfg(desktop)]
        state.source_auth.cancel(&account_id);
        state.active_proxies.lock().unwrap().remove(&account_id);
        state.douyin_browsers.cancel(&account_id);
        state.clear_qr(&account_id);
        if let Some(old) = state.sessions.lock().unwrap().remove(&account_id) {
            old.cancelled.cancel();
        }
        state
            .media
            .lock()
            .unwrap()
            .retain(|_, grant| grant.account_id.as_deref() != Some(&account_id));
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_account(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    state.account(&account_id)?;
    remove(&state, &account_id, false).await
}

/// A late close must never remove an account whose login has already committed.
#[tauri::command]
pub async fn discard_account_draft(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    validate_id(&account_id)?;
    remove(&state, &account_id, true).await
}

async fn remove(state: &RuntimeState, account_id: &str, only_pending: bool) -> Result<(), String> {
    let _deletion = state.usage.delete(account_id)?;
    if only_pending
        && !state
            .snapshot
            .lock()
            .unwrap()
            .accounts
            .iter()
            .any(|a| a.id == account_id && a.pending)
    {
        return Ok(());
    }
    revoke_account_work(state, account_id);
    state.mutate(|snapshot| {
        if let Some(account) = snapshot.accounts.iter_mut().find(|a| a.id == account_id) {
            account.enabled = false;
            account.set_status("signed-out");
            account.authentication = "anonymous".into();
        }
        Ok(())
    })?;
    let _handoff = state.douyin_browsers.handoff(account_id).await;
    state.douyin_browsers.stop(account_id).await?;
    state.douyin_browsers.forget(account_id);
    let browser = state.browsers.lock().unwrap().remove(account_id);
    let directory = state.directory.clone();
    let id = account_id.to_owned();
    // Process waits, vault IO and Profile rename run outside Tokio's async worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(mut browser) = browser {
            let _ = browser.child.kill();
            browser.child.wait().map_err(|_| "账号浏览器尚未退出。")?;
        }
        super::deletion::detach(&directory, &id)
    })
    .await
    .map_err(|_| "账号清理任务中断。")??;
    state.mutate(|snapshot| {
        snapshot.accounts.retain(|a| a.id != account_id);
        Ok(())
    })?;
    state.active_proxies.lock().unwrap().remove(account_id);
    state.browser_login_ids.lock().unwrap().remove(account_id);
    super::deletion::schedule(state.directory.clone());
    Ok(())
}

/// Revoke before waiting for browser teardown; buffered playback and queued requests end together.
fn revoke_account_work(state: &RuntimeState, account_id: &str) {
    #[cfg(desktop)]
    state.source_auth.cancel(account_id);
    state.browser_login_ids.lock().unwrap().remove(account_id);
    state.douyin_browsers.cancel(account_id);
    state.clear_qr(account_id);
    if let Some(session) = state.sessions.lock().unwrap().remove(account_id) {
        session.cancelled.cancel();
        session.queue.close();
    }
    state
        .media
        .lock()
        .unwrap()
        .retain(|_, grant| grant.account_id.as_deref() != Some(account_id));
    state
        .renderer_uses
        .lock()
        .unwrap()
        .retain(|_, (id, _)| id != account_id);
    state.active_proxies.lock().unwrap().remove(account_id);
}

#[tauri::command]
pub fn save_proxy(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    name: String,
    url: String,
) -> Result<(), String> {
    require_main(&window)?;
    state.mutate(|snapshot| crate::network::proxies::save_proxy(snapshot, &name, &url))
}

#[tauri::command]
pub fn remove_proxy(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    proxy_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    state.mutate(|snapshot| {
        if snapshot.accounts.iter().any(|a| {
            a.proxy_id.as_deref() == Some(&proxy_id) || a.backup_proxy_ids.contains(&proxy_id)
        }) {
            return Err("请先解除账号代理分配。".into());
        }
        snapshot.proxies.retain(|p| p.id != proxy_id);
        Ok(())
    })
}

#[tauri::command]
pub fn request_state(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    require_main(&window)?;
    let _usage = state.use_account(&account_id, "准备请求")?;
    let account = state.account(&account_id)?;
    let session = state.session(&account_id)?;
    let store = session.cookies.lock().unwrap();
    let url = platform_url(&account.platform_id)?;
    Ok(request_projection(&account, store.get_request_values(&url)))
}

fn request_projection<'a>(
    account: &Account,
    cookies: impl Iterator<Item = (&'a str, &'a str)>,
) -> serde_json::Value {
    let (mut uifid, mut temporary_uifid, mut verify_fp, mut ms_token) = (None, None, None, None);
    // CookieStore may yield the same name for multiple matching paths/domains. Preserve the
    // previous map's last-value precedence, including an empty UIFID overriding UIFID_TEMP.
    for (name, value) in cookies {
        match name {
            "UIFID" => uifid = Some(value),
            "UIFID_TEMP" => temporary_uifid = Some(value),
            "s_v_web_id" => verify_fp = Some(value),
            "msToken" => ms_token = Some(value),
            _ => {}
        }
    }
    // Only ephemeral signing inputs cross IPC. Full cookies, profile paths and vault keys never do.
    serde_json::json!({"userAgent":account.user_agent,"webId":account.web_id,"uifid":uifid.or(temporary_uifid),"verifyFp":verify_fp,"msToken":ms_token})
}

#[tauri::command]
pub fn acquire_account_usage(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    usage_id: String,
    reason: String,
) -> Result<(), String> {
    require_main(&window)?;
    validate_id(&usage_id)?;
    if !matches!(
        reason.as_str(),
        "搜索" | "导入" | "播放" | "下载" | "播放或下载" | "检查登录"
    ) {
        return Err("无效账号操作。".into());
    }
    let mut uses = state.renderer_uses.lock().unwrap();
    if uses.len() >= 256 || uses.contains_key(&usage_id) {
        return Err("账号操作数量超过预算或标识重复。".into());
    }
    let usage = state.use_account(&account_id, &reason)?;
    uses.insert(usage_id, (account_id, usage));
    Ok(())
}
#[tauri::command]
pub fn release_account_usage(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    usage_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    validate_id(&usage_id)?;
    state.renderer_uses.lock().unwrap().remove(&usage_id);
    Ok(())
}

#[tauri::command]
pub fn account_usage(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
) -> Result<Vec<String>, String> {
    require_main(&window)?;
    state.account(&account_id)?;
    crate::browser::verification::retain_running(&mut state.browsers.lock().unwrap(), &account_id)?;
    Ok(state.usage.reasons(&account_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{media::MediaGrant, state::AccountSession};
    use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    use tokio::sync::Semaphore;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn signing_projection_preserves_missing_empty_fallback_and_duplicate_cookie_values() {
        let account: Account = serde_json::from_value(serde_json::json!({
            "id":"a", "platformId":"douyin", "name":"a", "status":"ready",
            "enabled":true, "userAgent":"agent", "webId":"web", "proxyId":null,
            "authentication":"anonymous", "backupProxyIds":[],
            "state":{"login":"signed-out","verification":"not-required","connection":"unknown"},
        }))
        .unwrap();
        for (cookies, expected) in [
            (vec![], serde_json::json!([null, null, null])),
            (
                vec![("UIFID_TEMP", "temporary")],
                serde_json::json!(["temporary", null, null]),
            ),
            (
                vec![("UIFID", ""), ("UIFID_TEMP", "temporary")],
                serde_json::json!(["", null, null]),
            ),
            (
                vec![
                    ("UIFID", "old"),
                    ("UIFID", "current"),
                    ("s_v_web_id", "fp"),
                    ("msToken", "token"),
                    ("sessionid", "private"),
                ],
                serde_json::json!(["current", "fp", "token"]),
            ),
        ] {
            let result = request_projection(&account, cookies.into_iter());
            assert_eq!(
                result,
                serde_json::json!({
                    "userAgent":"agent", "webId":"web", "uifid":expected[0],
                    "verifyFp":expected[1], "msToken":expected[2],
                })
            );
        }
    }

    #[test]
    fn deleting_an_active_account_revokes_only_its_sessions_grants_and_renderer_uses() {
        let directory =
            std::env::temp_dir().join(format!("any-music-delete-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let accounts = [
            crate::state::add_test_account(&state, "bilibili"),
            crate::state::add_test_account(&state, "douyin"),
        ];
        let first = &accounts[0].id;
        let second = &accounts[1].id;
        let session = state.session(first).unwrap();
        let other = state.session(second).unwrap();
        for id in [first, second] {
            let usage = state.use_account(id, "播放").unwrap();
            state
                .renderer_uses
                .lock()
                .unwrap()
                .insert(id.clone(), (id.clone(), usage));
            state.media.lock().unwrap().insert(
                id.clone(),
                MediaGrant {
                    cache_key: "test".into(),
                    account_id: Some(id.clone()),
                    url: "https://example.com/audio".into(),
                    headers: HashMap::new(),
                    expires: Instant::now() + Duration::from_secs(60),
                },
            );
        }
        let deletion = state.usage.delete(first).unwrap();
        revoke_account_work(&state, first);
        assert!(session.cancelled.is_cancelled());
        assert!(session.queue.is_closed());
        assert!(!other.cancelled.is_cancelled());
        assert!(
            state
                .account(first)
                .err()
                .unwrap()
                .starts_with("operation-cancelled:")
        );
        assert!(state.use_account(first, "搜索").is_err());
        assert_eq!(state.renderer_uses.lock().unwrap().len(), 1);
        assert!(state.media.lock().unwrap().contains_key(second));
        assert!(!state.media.lock().unwrap().contains_key(first));
        drop(deletion);
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn identity_switch_cancels_only_its_platform_and_preserves_configuration() {
        let directory =
            std::env::temp_dir().join(format!("any-music-account-switch-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let accounts = [
            crate::state::add_test_account(&state, "bilibili"),
            crate::state::add_test_account(&state, "douyin"),
            crate::state::add_test_account(&state, "bilibili"),
        ];
        let mut tokens = HashMap::new();
        for account in &accounts {
            let token = CancellationToken::new();
            tokens.insert(account.id.clone(), token.clone());
            state.sessions.lock().unwrap().insert(
                account.id.clone(),
                Arc::new(AccountSession {
                    cookies: Arc::new(CookieStoreMutex::new(CookieStore::default())),
                    client: reqwest::Client::new(),
                    route_clients: Mutex::default(),
                    queue: Semaphore::new(1),
                    cancelled: token,
                    failures: Mutex::new(0),
                }),
            );
            state.media.lock().unwrap().insert(
                account.id.clone(),
                MediaGrant {
                    cache_key: "test".into(),
                    account_id: Some(account.id.clone()),
                    url: "https://example.com/audio".into(),
                    headers: HashMap::new(),
                    expires: Instant::now() + Duration::from_secs(60),
                },
            );
        }
        state.media.lock().unwrap().insert(
            "anonymous".into(),
            MediaGrant {
                cache_key: "test".into(),
                account_id: None,
                url: "https://example.com/anonymous".into(),
                headers: HashMap::new(),
                expires: Instant::now() + Duration::from_secs(60),
            },
        );
        let before = serde_json::to_value(state.snapshot.lock().unwrap().clone()).unwrap();
        cancel_platform_work(&state, "bilibili");
        for account in &accounts {
            let retired = account.platform_id == "bilibili";
            assert_eq!(tokens[&account.id].is_cancelled(), retired);
            assert_eq!(
                state.media.lock().unwrap().contains_key(&account.id),
                !retired
            );
        }
        assert!(state.media.lock().unwrap().contains_key("anonymous"));
        assert_eq!(state.sessions.lock().unwrap().len(), 1);
        assert_eq!(
            serde_json::to_value(state.snapshot.lock().unwrap().clone()).unwrap(),
            before
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
