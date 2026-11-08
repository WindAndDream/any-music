//! Thin IPC boundary: validate catalog/detail identity before any account/browser work.
use super::{Packet, detail, projection, search};
use crate::state::RuntimeState;
use std::{sync::Arc, time::Duration};

enum CatalogInput {
    Profile,
    Search(search::Request),
    Detail(detail::Request),
}
impl CatalogInput {
    fn permits(&self, account: &crate::model::Account) -> bool {
        account.enabled
            && account.platform_id == "douyin"
            && (account.content_error().is_none() || matches!(self, Self::Profile))
    }
    fn new(
        listing: Option<String>,
        query: Option<String>,
        offset: Option<u64>,
        aweme_id: Option<String>,
        page_kind: Option<String>,
    ) -> Result<Self, String> {
        match (listing, query, offset, aweme_id, page_kind) {
            (None, None, None, None, None) => Ok(Self::Profile),
            (None, None, None, Some(id), kind) => detail::Request::new(id, kind).map(Self::Detail),
            (Some(listing), Some(query), offset, None, None) => {
                search::Request::new(listing, query, offset.unwrap_or(0)).map(Self::Search)
            }
            _ => Err("invalid-input:抖音请求参数不完整或混用了不同操作。".into()),
        }
    }
}

#[tauri::command]
// Preserve the established flat IPC arguments while validating them as one native input.
#[allow(clippy::too_many_arguments)] // Existing flat catalog IPC plus explicit detail identity.
pub async fn douyin_catalog_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    account_id: String,
    request_id: String,
    listing_id: Option<String>,
    query: Option<String>,
    offset: Option<u64>,
    aweme_id: Option<String>,
    page_kind: Option<String>,
    import_kind: Option<String>,
    mix_id: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    crate::browser::verification::require_main(&window)?;
    crate::model::validate_id(&request_id)?;
    let input = if let Some(kind) = import_kind {
        if query.is_some() || aweme_id.is_some() || page_kind.is_some() {
            return Err("invalid-input:导入请求混用了其他操作。".into());
        }
        CatalogInput::Search(search::Request::for_import(
            listing_id.ok_or("invalid-input:导入请求缺少列表标识。")?,
            &kind,
            mix_id,
            offset.unwrap_or(0),
        )?)
    } else {
        if mix_id.is_some() {
            return Err("invalid-input:合集请求缺少导入类型。".into());
        }
        CatalogInput::new(listing_id, query, offset, aweme_id, page_kind)?
    };
    let _usage = state.use_account(&account_id, "搜索、作品详情或检查登录")?;
    let account = state.account(&account_id)?;
    if !input.permits(&account) {
        let reason = if account.enabled && account.platform_id == "douyin" {
            account
                .content_error()
                .unwrap_or("account-unavailable:账号不可用。")
        } else {
            "account-unavailable:账号已停用或不可用。"
        };
        return Err(reason.into());
    }
    let cancel = state.requests.lock().unwrap().begin(&request_id)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
    let mut epoch = None;
    let result = async {
        if cancel.is_cancelled() {
            return Err("operation-cancelled:请求已取消。".into());
        }
        let account_session = state.session(&account_id)?;
        epoch = Some(account_session.clone());
        // Serialize native HTTP and browser cookie commits in the same account epoch.
        // A browser snapshot must not overwrite a concurrent native Set-Cookie update.
        let _turn = tokio::select! {
            _ = cancel.cancelled() => return Err("operation-cancelled:请求已取消。".into()),
            _ = account_session.cancelled.cancelled() => return Err("operation-cancelled:账号环境已改变。".into()),
            result = account_session.queue.acquire() => result.map_err(|_| "operation-cancelled:账号队列已结束。")?,
        };
        let current = state.account(&account_id)?;
        if !input.permits(&current) || account_session.cancelled.is_cancelled() {
            return Err("operation-cancelled:账号未准备好获取内容。".into());
        }
        let started = {
            let _handoff = state.douyin_browsers.handoff(&account_id).await;
            state.douyin_browsers.reap(&account_id).await?;
            let _lock = state.browsers.lock().unwrap();
            // An explicit identity retry must not reload an unfinished QR/SMS/manual login.
            if has_pending_login(&state, &account_id) {
                return Err(
                    "verification-required:此账号正在登录或验证，请先完成当前操作。".into(),
                );
            }
            state
                .douyin_browsers
                .launch(&state, &account_id, None, None)?
        };
        let before = if !matches!(&input, CatalogInput::Profile) {
            if !started && state.douyin_browsers.needs_profile_refresh(&account_id) {
                state
                    .douyin_browsers
                    .profile(&account_id, &cancel, false)
                    .await?;
            }
            state.douyin_browsers.ready(&account_id, &cancel).await?;
            let user_id = state.douyin_browsers.user_id(&account_id)?;
            crate::accounts::session::confirm_identity(&state, &account_id, &user_id)?;
            Some(state.douyin_browsers.credentials(&account_id)?.0)
        } else {
            None
        };
        let is_profile = matches!(&input, CatalogInput::Profile);
        let value = match input {
            CatalogInput::Detail(request) => {
                state
                    .douyin_browsers
                    .detail(&account_id, request, &cancel)
                    .await?
            }
            CatalogInput::Search(request) => {
                state
                    .douyin_browsers
                    .search(&account_id, request, &cancel)
                    .await?
            }
            CatalogInput::Profile => {
                let response = state
                    .douyin_browsers
                    .profile(&account_id, &cancel, started)
                    .await;
                Packet::from_value(response?)?
            }
        };
        if cancel.is_cancelled() {
            return Err("operation-cancelled:请求已取消。".into());
        }
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        let _lifecycle = state.browsers.lock().unwrap();
        if account_session.cancelled.is_cancelled()
            || !state
                .sessions
                .lock()
                .unwrap()
                .get(&account_id)
                .is_some_and(|current| Arc::ptr_eq(current, &account_session))
        {
            return Err("operation-cancelled:账号环境已改变。".into());
        }
        if state.account(&account_id)?.authentication == "credential" {
            let (cookies, _) = state.douyin_browsers.credentials(&account_id)?;
            if let Some(before) = before {
                projection::merge_cookie_changes(
                    &mut account_session.cookies.lock().unwrap(),
                    &before,
                    &cookies,
                )?;
            } else {
                *account_session.cookies.lock().unwrap() = projection::cookie_store(&cookies)?;
            }
            state.save_credentials(&account_id)?;
        }
        if is_profile {
            if state.account(&account_id)?.authentication == "anonymous" {
                // A browser Profile can already be logged in while the older native snapshot is a guest.
                // Adopt only freshly validated identity/cookies, without clearing a content challenge.
                crate::accounts::login::commit_douyin(&state, &account_id, &account_session)?;
            } else {
                let user_id = state.douyin_browsers.user_id(&account_id)?;
                crate::accounts::session::confirm_identity(&state, &account_id, &user_id)?;
            }
        }
        Ok(value.into_ipc())
    };
    let result: Result<tauri::ipc::Response, String> =
        match tokio::time::timeout_at(deadline, result).await {
            Ok(value) => value,
            Err(_) => {
                cancel.cancel();
                Err("request-timeout:账号请求总预算已用尽。".into())
            }
        };
    // Startup, profile, search and detail rejections update the same native projection.
    // A replaced/cancelled account epoch cannot publish a late authentication failure.
    state.requests.lock().unwrap().finish(&request_id);
    if let Err(error) = &result {
        let _lock = state.browsers.lock().unwrap();
        if !cancel.is_cancelled()
            && epoch.as_ref().is_some_and(|session| {
                !session.cancelled.is_cancelled()
                    && state
                        .sessions
                        .lock()
                        .unwrap()
                        .get(&account_id)
                        .is_some_and(|current| Arc::ptr_eq(current, session))
            })
        {
            persist_failure(&state, &account_id, error)?;
        }
    }
    result
}

fn has_pending_login(state: &RuntimeState, id: &str) -> bool {
    state.qr.lock().unwrap().contains_key(id)
        || state.browser_login_ids.lock().unwrap().contains_key(id)
}

fn persist_failure(state: &RuntimeState, id: &str, error: &str) -> Result<(), String> {
    if error.starts_with("not-authenticated:") {
        let status = if state.account(id)?.authentication == "credential" {
            "expired"
        } else {
            "signed-out"
        };
        state.status(id, status)?;
    } else if error.starts_with("verification-required:") {
        state.status(id, "verification-required")?;
    }
    Ok(())
}

/// Portable parsing reports authentication or an empty page for a still-owned search target.
/// Native cookie reconciliation and account persistence stay in the account's current epoch.
#[tauri::command]
pub async fn report_douyin_search_failure(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    account_id: String,
    listing_id: String,
    request_id: String,
    code: String,
) -> Result<String, String> {
    crate::browser::verification::require_main(&window)?;
    crate::model::validate_id(&listing_id)?;
    crate::model::validate_id(&request_id)?;
    if !matches!(
        code.as_str(),
        "not-authenticated" | "verification-required" | "pagination-unavailable"
    ) {
        return Err("invalid-input:无效搜索状态。".into());
    }
    let cancel = state.requests.lock().unwrap().begin(&request_id)?;
    let work = async {
        let session = state.session(&account_id)?;
        let _turn = tokio::select! {
            _ = cancel.cancelled() => return Err("operation-cancelled:搜索已取消。".into()),
            _ = session.cancelled.cancelled() => return Err("operation-cancelled:账号环境已改变。".into()),
            result = session.queue.acquire() => result.map_err(|_| "operation-cancelled:账号队列已结束。")?,
        };
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        let result = state
            .douyin_browsers
            .action(
                &account_id,
                |reply| super::Action::SearchFailure(listing_id, code, reply),
                &cancel,
            )
            .await?;
        let code = result
            .as_str()
            .ok_or("invalid-response:搜索状态响应无效。")?;
        let _lock = state.browsers.lock().unwrap();
        if cancel.is_cancelled()
            || session.cancelled.is_cancelled()
            || !state
                .sessions
                .lock()
                .unwrap()
                .get(&account_id)
                .is_some_and(|current| Arc::ptr_eq(current, &session))
        {
            return Err("operation-cancelled:账号环境已改变。".into());
        }
        persist_failure(&state, &account_id, &format!("{code}:"))?;
        Ok(code.into())
    };
    let result = tokio::time::timeout(Duration::from_secs(25), work)
        .await
        .map_err(|_| "request-timeout:搜索状态更新超时。".to_string())
        .and_then(|result| result);
    state.requests.lock().unwrap().finish(&request_id);
    result
}
#[tauri::command]
pub fn close_douyin_listing(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RuntimeState>,
    account_id: String,
    listing_id: String,
) -> Result<(), String> {
    crate::browser::verification::require_main(&window)?;
    state.account(&account_id)?;
    crate::model::validate_id(&listing_id)?;
    state.douyin_browsers.close(&account_id, &listing_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_failures_preserve_credentials_and_distinguish_verification_from_logout() {
        let directory =
            std::env::temp_dir().join(format!("any-music-catalog-status-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account = crate::state::add_test_account(&state, "douyin");
        assert!(!has_pending_login(&state, &account.id));
        state
            .browser_login_ids
            .lock()
            .unwrap()
            .insert(account.id.clone(), "pending".into());
        assert!(has_pending_login(&state, &account.id));
        state.browser_login_ids.lock().unwrap().remove(&account.id);
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].authentication = "credential".into();
                Ok(())
            })
            .unwrap();
        persist_failure(&state, &account.id, "verification-required:fixture").unwrap();
        assert_eq!(
            state.account(&account.id).unwrap().status,
            "verification-required"
        );
        for error in [
            "network-error:fixture",
            "request-timeout:fixture",
            "operation-cancelled:fixture",
            "invalid-response:fixture",
            "upstream-error:fixture",
        ] {
            persist_failure(&state, &account.id, error).unwrap();
            assert_eq!(
                state.account(&account.id).unwrap().status,
                "verification-required"
            );
        }
        assert_eq!(
            state.account(&account.id).unwrap().authentication,
            "credential"
        );
        persist_failure(&state, &account.id, "not-authenticated:fixture").unwrap();
        assert_eq!(state.account(&account.id).unwrap().status, "expired");
        state
            .mutate(|snapshot| {
                snapshot.accounts[0].authentication = "anonymous".into();
                Ok(())
            })
            .unwrap();
        persist_failure(&state, &account.id, "not-authenticated:fixture").unwrap();
        assert_eq!(state.account(&account.id).unwrap().status, "signed-out");
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn paused_accounts_can_check_identity_but_cannot_search() {
        let mut account: crate::model::Account = serde_json::from_value(serde_json::json!({"id":"a","platformId":"douyin","name":"a","enabled":true,"status":"expired","authentication":"credential","userAgent":"","webId":"", "backupProxyIds":[], "state":{"login":"signed-in","verification":"not-required","connection":"available"},"proxyId":null})).unwrap();
        let profile = CatalogInput::Profile;
        let search = CatalogInput::new(
            Some(uuid::Uuid::new_v4().to_string()),
            Some("音乐".into()),
            None,
            None,
            None,
        )
        .unwrap();
        for status in [
            "expired",
            "verification-required",
            "network-blocked",
            "signed-out",
        ] {
            account.status = status.into();
            assert!(profile.permits(&account));
            assert!(!search.permits(&account));
        }
        account.status = "ready".into();
        assert!(search.permits(&account));
        account.enabled = false;
        assert!(!profile.permits(&account));
        account.enabled = true;
        account.platform_id = "bilibili".into();
        assert!(!profile.permits(&account));
    }

    #[test]
    fn search_identity_is_validated_without_native_state_or_browser_work() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(matches!(
            CatalogInput::new(None, None, None, None, None),
            Ok(CatalogInput::Profile)
        ));
        let CatalogInput::Search(request) =
            CatalogInput::new(Some(id.clone()), Some("  音乐  ".into()), None, None, None).unwrap()
        else {
            panic!("expected validated search");
        };
        assert_eq!(request.query, "音乐");
        assert_eq!(request.offset, 0);
        for (listing, query, offset) in [
            (None, Some("音乐".into()), Some(0)),
            (Some(id.clone()), None, None),
            (None, None, Some(0)),
            (Some("invalid-id".into()), Some("音乐".into()), Some(0)),
            (Some(id.clone()), Some(" ".into()), Some(0)),
            (Some(id.clone()), Some("中".repeat(201)), Some(0)),
            (Some(id), Some("音乐".into()), Some(100001)),
        ] {
            assert!(CatalogInput::new(listing, query, offset, None, None).is_err());
        }
    }

    #[test]
    fn detail_identity_cannot_mix_search_or_profile_arguments() {
        assert!(matches!(
            CatalogInput::new(None, None, None, Some("123".into()), Some("note".into())),
            Ok(CatalogInput::Detail(_))
        ));
        for (listing, query, offset, aweme, kind) in [
            (None, None, None, None, Some("note".into())),
            (None, None, Some(0), Some("123".into()), None),
            (None, Some("音乐".into()), None, Some("123".into()), None),
            (
                Some(uuid::Uuid::new_v4().to_string()),
                Some("音乐".into()),
                None,
                Some("123".into()),
                None,
            ),
            (None, None, None, Some("../user/self".into()), None),
            (None, None, None, Some("123".into()), Some("search".into())),
        ] {
            assert!(CatalogInput::new(listing, query, offset, aweme, kind).is_err());
        }
    }
}
