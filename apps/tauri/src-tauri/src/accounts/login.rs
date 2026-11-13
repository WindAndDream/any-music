use crate::{
    browser::verification::require_main,
    state::{QrSession, RuntimeState},
};
use serde_json::{Value, json};
use tauri::{State, WebviewWindow};

/// Renderer UUIDs scope cancellation even before generation finishes; platform tokens stay native.
#[tauri::command]
pub async fn begin_qr_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<Value, String> {
    require_main(&window)?;
    crate::model::validate_id(&login_id)?;
    let usage = std::sync::Arc::new(state.use_account(&account_id, "登录与验证")?);
    if state.account(&account_id)?.platform_id == "douyin" {
        return begin_douyin(&state, &account_id, &login_id, usage).await;
    }
    let (session, platform) = {
        let mut browsers = state.browsers.lock().unwrap();
        let account = state.account(&account_id)?;
        if crate::browser::verification::retain_running(&mut browsers, &account_id)? {
            return Err("请先完成或关闭此账号的系统浏览器验证。".into());
        }
        if !account.enabled {
            return Err("请先启用此账号。".into());
        }
        if !matches!(
            account.platform_id.as_str(),
            "bilibili" | "douyin" | "netease"
        ) {
            return Err("此平台使用系统浏览器完成验证。".into());
        }
        let session =
            state.create_session(&account, reqwest_cookie_store::CookieStore::default())?;
        state.clear_qr(&account_id);
        state.pause_login(&account_id)?;
        if let Some(old) = state.sessions.lock().unwrap().remove(&account_id) {
            old.cancelled.cancel();
        }
        state
            .media
            .lock()
            .unwrap()
            .retain(|_, grant| grant.account_id.as_deref() != Some(&account_id));
        state.qr.lock().unwrap().insert(
            account_id.clone(),
            QrSession {
                _usage: Some(usage),
                key: String::new(),
                handoff: None,
                douyin: None,
                generation: login_id.clone(),
                session: session.clone(),
            },
        );
        (session, account.platform_id)
    };
    let work = async {
        if platform == "netease" {
            let (key, public) =
                super::netease_login::generate(&state, &account_id, &session).await?;
            let mut qr = state.qr.lock().unwrap();
            let current = qr
                .get_mut(&account_id)
                .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
                .ok_or("二维码会话已取消或替换。")?;
            current.key = key;
            return Ok(public);
        }
        if platform == "douyin" {
            let (pending, public) = crate::accounts::douyin_login::generate(&session).await?;
            let mut qr = state.qr.lock().unwrap();
            let current = qr
                .get_mut(&account_id)
                .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
                .ok_or("二维码会话已取消或替换。")?;
            current.douyin = Some(pending);
            return Ok(public);
        }
        let account = state.account(&account_id)?;
        let result: Value = state
            .send_routed(
                &account,
                &session,
                |client| {
                    Ok(client
                        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate"))
                },
                true,
                std::time::Duration::from_secs(20),
                &session.cancelled,
            )
            .await?
            .json()
            .await
            .map_err(|_| "二维码响应无效。")?;
        if result["code"] != 0 {
            return Err("平台拒绝生成登录二维码。".to_string());
        }
        let key = result["data"]["qrcode_key"]
            .as_str()
            .ok_or("缺少二维码会话标识。")?;
        let url = result["data"]["url"].as_str().ok_or("缺少二维码内容。")?;
        crate::model::validate_public_url(url)?;
        let handoff_url = bilibili_handoff_url(url, key)?;
        let mut qr = state.qr.lock().unwrap();
        let current = qr
            .get_mut(&account_id)
            .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
            .ok_or("二维码会话已取消或替换。")?;
        current.key = key.into();
        current.handoff = Some(crate::state::QrHandoff {
            url: handoff_url,
            expires: std::time::Instant::now() + std::time::Duration::from_secs(180),
            opened: false,
        });
        Ok(json!({"status":"waiting","qrContent":url}))
    };
    let result = tokio::select! {
        _ = session.cancelled.cancelled() => Err("登录已取消。".into()),
        result = tokio::time::timeout(std::time::Duration::from_secs(20), work) =>
            result.map_err(|_| "二维码生成超时，请改用系统浏览器登录。".to_string()).and_then(|value| value),
    };
    if result.is_err() {
        let _browsers = state.browsers.lock().unwrap();
        cancel_pending(&state, &account_id, &login_id)?;
    }
    result
}

fn pending(state: &RuntimeState, account_id: &str, login_id: &str) -> Result<QrSession, String> {
    state.account(account_id)?;
    state
        .qr
        .lock()
        .unwrap()
        .get(account_id)
        .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
        .filter(|qr| {
            qr.handoff
                .as_ref()
                .is_none_or(|handoff| handoff.expires > std::time::Instant::now())
        })
        .cloned()
        .ok_or_else(|| "二维码会话已取消或替换。".into())
}

/// Bilibili's scan page opens its own app browser with the public scan URL.
/// Accept only the exact native-generated challenge, not arbitrary renderer links.
fn bilibili_handoff_url(value: &str, key: &str) -> Result<String, String> {
    let url = crate::model::validate_public_url(value)?;
    // The QR service now returns account.bilibili.com's scan-web route. Keep the
    // official scan routes paired with their hosts; unrelated account pages cannot
    // become app handoffs even when they carry a matching challenge key.
    let scan_page = matches!(
        (url.host_str(), url.path()),
        (Some("account.bilibili.com"), "/h5/account-h5/auth/scan-web")
            | (Some("passport.bilibili.com"), "/h5-app/passport/login/scan")
    );
    let keys: Vec<_> = url
        .query_pairs()
        .filter(|(name, _)| name == "qrcode_key")
        .map(|(_, value)| value.into_owned())
        .collect();
    if url.scheme() != "https"
        || !scan_page
        || url.port().is_some()
        || url.fragment().is_some()
        || key.len() != 32
        || !key.bytes().all(|v| v.is_ascii_hexdigit())
        || keys != [key]
    {
        return Err("平台返回的二维码授权地址无效。".into());
    }
    let mut link = reqwest::Url::parse("bilibili://browser/").unwrap();
    link.query_pairs_mut().append_pair("url", value);
    Ok(link.into())
}

#[tauri::command]
pub async fn open_qr_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    let current = pending(&state, &account_id, &login_id)?;
    let public_url = current
        .handoff
        .as_ref()
        .ok_or("此会话没有本机扫码授权入口。")?
        .url
        .clone();
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        pending(&state, &account_id, &login_id)?;
        if state.account(&account_id)?.platform_id != "bilibili" {
            return Err("此运行端仅支持哔哩哔哩扫码授权。".into());
        }
        let url = {
            let mut sessions = state.qr.lock().unwrap();
            let handoff = sessions
                .get_mut(&account_id)
                .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
                .and_then(|qr| qr.handoff.as_mut())
                .filter(|handoff| handoff.expires > std::time::Instant::now())
                .ok_or("二维码已过期或取消，请重新生成。")?;
            // Mark before leaving, so suspension cannot cancel the authorization session.
            handoff.opened = true;
            public_url
        };
        crate::system::android::open_bilibili_login(window.app_handle(), &url).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, account_id, login_id, public_url);
        Err("此运行端暂不支持本机应用扫码授权。".into())
    }
}

#[tauri::command]
pub async fn poll_qr_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<Value, String> {
    require_main(&window)?;
    let current = pending(&state, &account_id, &login_id)?;
    if state.account(&account_id)?.platform_id == "douyin" {
        return poll_douyin(&state, &account_id, &login_id);
    }
    let work = async {
        let _queue = current
            .session
            .queue
            .acquire()
            .await
            .map_err(|_| "登录会话已关闭。")?;
        // A preceding SMS operation may have updated the challenge while this request was queued.
        let current = pending(&state, &account_id, &login_id)?;
        let mut douyin = current.douyin.clone();
        let platform = state.account(&account_id)?.platform_id;
        let public = if platform == "netease" {
            super::netease_login::poll(&state, &account_id, &current.session, &current.key).await?
        } else if let Some(qr) = &mut douyin {
            crate::accounts::douyin_login::poll(&current.session, qr).await?
        } else {
            if current.key.is_empty() {
                return Err("二维码尚未生成。".into());
            }
            let account = state.account(&account_id)?;
            let result: Value = state
                .send_routed(
                    &account,
                    &current.session,
                    |client| {
                        Ok(client
                            .get("https://passport.bilibili.com/x/passport-login/web/qrcode/poll")
                            .query(&[("qrcode_key", &current.key)]))
                    },
                    true,
                    std::time::Duration::from_secs(15),
                    &current.session.cancelled,
                )
                .await?
                .json()
                .await
                .map_err(|_| "二维码状态响应无效。")?;
            if result["code"] != 0 {
                return Err("平台拒绝查询二维码状态。".to_string());
            }
            let status = match result["data"]["code"].as_i64() {
                Some(0) => "signed-in",
                Some(86090) => "scanned",
                Some(86038) => "expired",
                Some(86101) => "waiting",
                _ => return Err("未知二维码状态，请用系统浏览器验证。".into()),
            };
            json!({"status":status})
        };
        // Profile verification is native and cancellable; never await while holding lifecycle locks.
        let netease_user = if platform == "netease" && public["status"] == "signed-in" {
            Some(super::netease_login::user_id(&state, &account_id, &current.session).await?)
        } else {
            None
        };
        // Serialize credential commit with browser launch and account environment changes.
        let _browsers = state.browsers.lock().unwrap();
        let mut qr = state.qr.lock().unwrap();
        let latest = qr
            .get_mut(&account_id)
            .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
            .ok_or("二维码会话已取消或替换。")?;
        latest.douyin = douyin;
        if public["status"] == "signed-in" {
            let platform = state.account(&account_id)?.platform_id;
            if !has_credential(&current, &platform) {
                return Err("登录确认未返回有效凭证，请用系统浏览器验证。".into());
            }
            state
                .sessions
                .lock()
                .unwrap()
                .insert(account_id.clone(), current.session.clone());
            let user = netease_user.map(Ok).unwrap_or_else(|| {
                super::identity::bilibili_user(&current.session.cookies.lock().unwrap())
            });
            let commit = user.and_then(|user| {
                super::identity::commit_login(
                    &state,
                    &account_id,
                    &current.session,
                    &user,
                    None,
                    true,
                )
            });
            if let Err(error) = commit {
                state.sessions.lock().unwrap().remove(&account_id);
                return Err(error);
            }
            qr.remove(&account_id);
        }
        Ok(public)
    };
    let result = tokio::select! {
        _ = current.session.cancelled.cancelled() => Err("登录已取消。".into()),
        result = tokio::time::timeout(std::time::Duration::from_secs(15), work) =>
            result.map_err(|_| "二维码状态查询超时，请重试。".to_string()).and_then(|value| value),
    };
    if result
        .as_ref()
        .is_ok_and(|value| value["status"] == "expired")
    {
        let _browsers = state.browsers.lock().unwrap();
        cancel_pending(&state, &account_id, &login_id)?;
    }
    result
}

fn has_credential(current: &QrSession, platform: &str) -> bool {
    let root = crate::model::platform_url(platform).unwrap();
    current
        .session
        .cookies
        .lock()
        .unwrap()
        .get_request_values(&root)
        .any(|(name, value)| {
            !value.is_empty()
                && match platform {
                    "bilibili" => name == "SESSDATA",
                    "netease" => name == "MUSIC_U",
                    // Confirmed against the live site on 2026-10-03, after the first fully
                    // completed scan-plus-verification sign-in: the browser's own subsequent
                    // request carried BOTH sessionid and sessionid_ss (equal values), together
                    // with sid_tt, sid_guard, uid_tt, uid_tt_ss, session_tlb_tag, sid_ucp_v1,
                    // ssid_ucp_v1, x_tt_token, passport_assist_user, n_mh, login_time and
                    // bd_ticket_guard_server_data. This pair is therefore observed rather than
                    // assumed, and no cookie value is recorded here on purpose. Note that
                    // sessionid does not appear in document.cookie, so only a request header or
                    // an equivalent credential read can see it.
                    "douyin" => matches!(name, "sessionid" | "sessionid_ss"),
                    _ => false,
                }
        })
}

async fn sms_action(
    state: &RuntimeState,
    account_id: &str,
    login_id: &str,
    code: Option<&str>,
) -> Result<Value, String> {
    let current = pending(state, account_id, login_id)?;
    if state.account(account_id)?.platform_id == "douyin" {
        let result = state
            .douyin_browsers
            .sms(
                account_id,
                code.map(str::to_owned),
                &current.session.cancelled,
            )
            .await?;
        pending(state, account_id, login_id)?;
        return Ok(result);
    }
    let work = async {
        let _queue = current
            .session
            .queue
            .acquire()
            .await
            .map_err(|_| "登录会话已关闭。")?;
        let mut current = pending(state, account_id, login_id)?;
        let douyin = current.douyin.as_mut().ok_or("此账号没有抖音验证会话。")?;
        let result = crate::accounts::douyin_login::sms(&current.session, douyin, code).await;
        let _browsers = state.browsers.lock().unwrap();
        let mut qr = state.qr.lock().unwrap();
        let latest = qr
            .get_mut(account_id)
            .filter(|qr| qr.generation == login_id && !qr.session.cancelled.is_cancelled())
            .ok_or("二维码会话已取消或替换。")?;
        // Keep resend cooldowns on rejected sends; pending challenge state never goes to disk.
        latest.douyin = current.douyin;
        result
    };
    tokio::select! { _ = current.session.cancelled.cancelled() => Err("登录已取消。".into()), result = work => result }
}

#[tauri::command]
pub async fn send_login_sms(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<Value, String> {
    require_main(&window)?;
    sms_action(&state, &account_id, &login_id, None).await
}
#[tauri::command]
pub async fn submit_login_sms(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
    code: String,
) -> Result<Value, String> {
    require_main(&window)?;
    sms_action(&state, &account_id, &login_id, Some(&code)).await
}

fn cancel_pending(state: &RuntimeState, account_id: &str, login_id: &str) -> Result<(), String> {
    let old = {
        let mut qr = state.qr.lock().unwrap();
        if qr
            .get(account_id)
            .is_some_and(|qr| qr.generation == login_id)
        {
            qr.remove(account_id)
        } else {
            None
        }
    };
    if let Some(old) = old {
        old.session.cancelled.cancel();
        state.douyin_browsers.cancel(account_id);
        crate::accounts::session::cancel_verification(state, account_id)?;
    }
    Ok(())
}

async fn begin_douyin(
    state: &RuntimeState,
    account_id: &str,
    login_id: &str,
    usage: std::sync::Arc<crate::accounts::usage::AccountUse>,
) -> Result<Value, String> {
    let _handoff = state.douyin_browsers.handoff(account_id).await;
    state.douyin_browsers.stop(account_id).await?;
    let session = {
        let mut browsers = state.browsers.lock().unwrap();
        if crate::browser::verification::retain_running(&mut browsers, account_id)? {
            return Err("请先完成此账号的浏览器验证。".into());
        }
        let account = state.account(account_id)?;
        if !account.enabled {
            return Err("请先启用此账号。".into());
        }
        state.clear_qr(account_id);
        let session =
            state.create_session(&account, reqwest_cookie_store::CookieStore::default())?;
        state.pause_login(account_id)?;
        if let Some(old) = state.sessions.lock().unwrap().remove(account_id) {
            old.cancelled.cancel();
        }
        state
            .media
            .lock()
            .unwrap()
            .retain(|_, grant| grant.account_id.as_deref() != Some(account_id));
        state.qr.lock().unwrap().insert(
            account_id.into(),
            QrSession {
                _usage: Some(usage),
                key: String::new(),
                handoff: None,
                douyin: None,
                generation: login_id.into(),
                session: session.clone(),
            },
        );
        if let Err(error) = state.douyin_browsers.ensure(state, account_id, None) {
            cancel_pending(state, account_id, login_id)?;
            return Err(error);
        }
        session
    };
    let work = async {
        loop {
            pending(state, account_id, login_id)?;
            let public = state.douyin_browsers.status(account_id)?;
            if public.get("qrImage").is_some() || public["status"] != "waiting" {
                return poll_douyin(state, account_id, login_id);
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    };
    let result = tokio::select! {_=session.cancelled.cancelled()=>Err("登录已取消。".into()),result=tokio::time::timeout(std::time::Duration::from_secs(35),work)=>result.map_err(|_|"官方页面未生成二维码，请在账号浏览器中查看登录入口。".to_string()).and_then(|v|v)};
    if result.is_err() {
        let _lock = state.browsers.lock().unwrap();
        cancel_pending(state, account_id, login_id)?;
    }
    result
}
fn poll_douyin(state: &RuntimeState, account_id: &str, login_id: &str) -> Result<Value, String> {
    let _lock = state.browsers.lock().unwrap();
    let current = pending(state, account_id, login_id)?;
    let public = state.douyin_browsers.status(account_id)?;
    if public["status"] == "signed-in" {
        commit_douyin(state, account_id, &current.session)?;
        state.qr.lock().unwrap().remove(account_id);
    }
    Ok(public)
}
/// Caller holds the browser lifecycle lock, so deleting/changing/cancelling an account cannot
/// race credential persistence. Cookie values are never returned to the renderer.
pub fn commit_douyin(
    state: &RuntimeState,
    account_id: &str,
    session: &std::sync::Arc<crate::state::AccountSession>,
) -> Result<(), String> {
    let (cookies, agent) = state.douyin_browsers.credentials(account_id)?;
    let user_id = state.douyin_browsers.user_id(account_id)?;
    let store = crate::browser::douyin_browser::projection::cookie_store(&cookies)?;
    if !crate::browser::douyin_browser::projection::has_login(&store) {
        return Err("官方页面未返回有效登录凭证。".into());
    }
    *session.cookies.lock().unwrap() = store;
    state
        .sessions
        .lock()
        .unwrap()
        .insert(account_id.into(), session.clone());
    let result =
        super::identity::commit_login(state, account_id, session, &user_id, Some(agent), false);
    // Rebuild the Rust client with the actual browser UA on its next use.
    if let Some(old) = state.sessions.lock().unwrap().remove(account_id) {
        old.cancelled.cancel();
    }
    result
}
#[tauri::command]
pub fn cancel_qr_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    state.account(&account_id)?;
    let _browsers = state.browsers.lock().unwrap();
    cancel_pending(&state, &account_id, &login_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoff_accepts_only_the_exact_official_scan_challenge() {
        let key = "0123456789abcdef0123456789abcdef";
        let url = format!(
            "https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key={key}&from="
        );
        let link: reqwest::Url = bilibili_handoff_url(&url, key).unwrap().parse().unwrap();
        assert_eq!(link.scheme(), "bilibili");
        assert_eq!(link.host_str(), Some("browser"));
        assert_eq!(
            link.query_pairs().next().unwrap(),
            ("url".into(), url.as_str().into())
        );
        for rejected in [
            url.replace("account.bilibili.com", "evil.example"),
            url.replace("account.bilibili.com", "passport.bilibili.com"),
            url.replace("account.bilibili.com", "account.bilibili.com.evil.example"),
            url.replace("account.bilibili.com", "user@account.bilibili.com"),
            url.replace("https:", "http:"),
            url.replace("/auth/scan-web", "/auth/other"),
            format!("{url}&qrcode_key={key}"),
            format!("{url}#fragment"),
            url.replace(key, "different-key"),
        ] {
            assert!(bilibili_handoff_url(&rejected, key).is_err());
        }
        let passport_url = format!(
            "https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key={key}&from="
        );
        assert!(bilibili_handoff_url(&passport_url, key).is_ok());
    }
    #[test]
    fn stale_cancel_cannot_remove_new_login_and_confirmation_requires_real_cookies() {
        let directory =
            std::env::temp_dir().join(format!("any-music-login-{}", uuid::Uuid::new_v4()));
        let state = RuntimeState::new(directory.clone()).unwrap();
        let account = crate::state::add_test_account(&state, "douyin");
        let session = state
            .create_session(&account, reqwest_cookie_store::CookieStore::default())
            .unwrap();
        let qr = QrSession {
            _usage: None,
            key: String::new(),
            handoff: None,
            douyin: None,
            generation: "new".into(),
            session: session.clone(),
        };
        state
            .qr
            .lock()
            .unwrap()
            .insert(account.id.clone(), qr.clone());
        state.pause_login(&account.id).unwrap();
        cancel_pending(&state, &account.id, "old").unwrap();
        assert!(pending(&state, &account.id, "new").is_ok());
        assert!(!has_credential(&qr, "douyin"));
        let url = "https://www.douyin.com/".parse().unwrap();
        session
            .cookies
            .lock()
            .unwrap()
            .parse("sessionid=test; Domain=douyin.com; Path=/; Secure", &url)
            .unwrap();
        assert!(has_credential(&qr, "douyin"));
        cancel_pending(&state, &account.id, "new").unwrap();
        assert!(session.cancelled.is_cancelled());
        assert_eq!(state.account(&account.id).unwrap().status, "ready");
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
