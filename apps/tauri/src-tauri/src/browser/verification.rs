//! In-app account login pages and the product-origin guard for application commands.
//! Credentials are read natively only after the user confirms completion.
use crate::{
    browser::embedded::{ManualPage, NO_CAPTURE, Store},
    model::validate_id,
    state::RuntimeState,
};
use std::path::PathBuf;
use tauri::State;

pub struct BrowserProcess {
    pub _usage: crate::accounts::usage::AccountUse,
    pub page: ManualPage,
    pub finishing: bool,
}

/// An open login page stays owned by its account until completion or cancellation.
pub fn retain_running(
    processes: &mut std::collections::HashMap<String, BrowserProcess>,
    id: &str,
) -> Result<bool, String> {
    Ok(processes.contains_key(id))
}

pub fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("拒绝远程页面调用应用能力。".into());
    }
    let url = webview.url().map_err(|_| "无法检查调用来源。")?;
    let local =
        matches!(url.scheme(), "tauri") || matches!(url.host_str(), Some("tauri.localhost"));
    let dev =
        cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:21420";
    if !local && !dev {
        return Err("拒绝非产品页面调用。".into());
    }
    Ok(())
}
/// Installed Chrome/Edge for the Windows development-only login experiment.
pub(crate) fn find_browser(kind: &str) -> Result<PathBuf, String> {
    if kind == "system" {
        return find_browser("chrome").or_else(|_| find_browser("edge"));
    }
    let names = match kind {
        "chrome" => vec!["Google/Chrome/Application/chrome.exe"],
        "edge" => vec!["Microsoft/Edge/Application/msedge.exe"],
        _ => return Err("请选择系统浏览器登录。".into()),
    };
    #[cfg(target_os = "windows")]
    for root in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(value) = std::env::var_os(root) {
            for name in &names {
                let path = PathBuf::from(&value).join(name);
                if path.is_file() {
                    return Ok(path);
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let path = PathBuf::from(if kind == "chrome" {
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        } else {
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        });
        if path.is_file() {
            return Ok(path);
        }
    }
    #[cfg(target_os = "linux")]
    for name in if kind == "chrome" {
        vec!["/usr/bin/google-chrome", "/opt/google/chrome/chrome"]
    } else {
        vec!["/usr/bin/microsoft-edge", "/opt/microsoft/msedge/msedge"]
    } {
        let path = PathBuf::from(name);
        if path.is_file() {
            return Ok(path);
        }
    }
    let _ = names;
    Err("未找到系统安装的 Chrome/Edge，请安装稳定版浏览器。".into())
}

/// Replace the account's native session with a user-operated in-app page.
fn pause_account(state: &RuntimeState, account_id: &str) -> Result<(), String> {
    state.clear_qr(account_id);
    state.pause_login(account_id)?;
    if let Some(old) = state.sessions.lock().unwrap().remove(account_id) {
        old.cancelled.cancel();
    }
    state
        .media
        .lock()
        .unwrap()
        .retain(|_, grant| grant.account_id.as_deref() != Some(account_id));
    Ok(())
}

#[tauri::command]
pub async fn begin_browser_login(
    webview: tauri::Webview,
    state: State<'_, RuntimeState>,
    account_id: String,
    browser: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let usage = state.use_account(&account_id, "应用内登录与验证")?;
    validate_id(&login_id)?;
    {
        let mut logins = state.browser_login_ids.lock().unwrap();
        if logins.contains_key(&account_id) {
            return Err("此账号的登录验证正在进行，请先完成或关闭。".into());
        }
        logins.insert(account_id.clone(), login_id.clone());
    }
    if state.account(&account_id)?.platform_id == "douyin" {
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        require_browser_login(&state, &account_id, &login_id)?;
        state.douyin_browsers.stop(&account_id).await?;
        let _lock = state.browsers.lock().unwrap();
        let logins = state.browser_login_ids.lock().unwrap();
        if logins.get(&account_id) != Some(&login_id) {
            return Err("operation-cancelled:登录验证已结束。".into());
        }
        state.clear_qr(&account_id);
        state
            .douyin_browsers
            .ensure(&state, &account_id, Some(&browser))?;
        return pause_account(&state, &account_id);
    }
    let (store, url) = {
        let processes = state.browsers.lock().unwrap();
        require_browser_login(&state, &account_id, &login_id)?;
        if processes.contains_key(&account_id) {
            return Err("此账号的登录页面已打开。".into());
        }
        let account = state.account(&account_id)?;
        if !account.enabled {
            return Err("请先启用此账号。".into());
        }
        let proxy = state
            .active_proxy(&account)
            .map(|id| {
                state
                    .snapshot
                    .lock()
                    .unwrap()
                    .proxies
                    .iter()
                    .find(|proxy| proxy.id == id)
                    .map(|proxy| proxy.url.clone())
                    .ok_or("账号代理不存在。")
            })
            .transpose()?;
        let store = Store::new(
            &state.directory.join("profiles"),
            &account_id,
            proxy.as_deref(),
            NO_CAPTURE,
        )?;
        (
            store,
            crate::model::platform_url(&account.platform_id)?.to_string(),
        )
    };
    // Creating the page waits for the UI thread; no lifecycle lock is held across it.
    let page = ManualPage::open(&state.embedded, store, &url).await?;
    let mut processes = state.browsers.lock().unwrap();
    if require_browser_login(&state, &account_id, &login_id).is_err()
        || processes.contains_key(&account_id)
    {
        page.close(&state.embedded);
        return Err("operation-cancelled:登录验证已结束。".into());
    }
    processes.insert(
        account_id.clone(),
        BrowserProcess {
            _usage: usage,
            page,
            finishing: false,
        },
    );
    pause_account(&state, &account_id)
}

#[tauri::command]
pub async fn cancel_browser_login(
    webview: tauri::Webview,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_id(&login_id)?;
    {
        let mut logins = state.browser_login_ids.lock().unwrap();
        if logins.get(&account_id) != Some(&login_id) {
            return Ok(());
        }
        logins.remove(&account_id);
        state.douyin_browsers.cancel(&account_id);
    }
    let _handoff = state.douyin_browsers.handoff(&account_id).await;
    if state
        .browser_login_ids
        .lock()
        .unwrap()
        .contains_key(&account_id)
    {
        return Ok(());
    }
    state.account(&account_id)?;
    state.douyin_browsers.stop(&account_id).await?;
    let mut browsers = state.browsers.lock().unwrap();
    let logins = state.browser_login_ids.lock().unwrap();
    if logins.contains_key(&account_id) {
        return Ok(());
    }
    if let Some(browser) = browsers.remove(&account_id) {
        browser.page.close(&state.embedded);
    }
    crate::accounts::session::cancel_verification(&state, &account_id)?;
    Ok(())
}

fn require_browser_login(
    state: &RuntimeState,
    account_id: &str,
    login_id: &str,
) -> Result<(), String> {
    if state
        .browser_login_ids
        .lock()
        .unwrap()
        .get(account_id)
        .map(String::as_str)
        != Some(login_id)
    {
        return Err("operation-cancelled:登录验证已结束或被替换。".into());
    }
    Ok(())
}

/// Import one platform's page cookies into a fresh native CookieStore.
fn import_cookies(
    store: &mut reqwest_cookie_store::CookieStore,
    values: &serde_json::Value,
    root: &str,
) -> Result<usize, String> {
    let mut count = 0;
    for cookie in values["cookies"]
        .as_array()
        .ok_or("账号页面 Cookie 响应无效。")?
    {
        let domain = cookie["domain"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches('.');
        if domain != root && !domain.ends_with(&format!(".{root}")) {
            continue;
        }
        let name = cookie["name"].as_str().unwrap_or("");
        let value = cookie["value"].as_str().unwrap_or("");
        if name.is_empty() || [name, value].iter().any(|v| v.contains(['\r', '\n', ';'])) {
            continue;
        }
        let path = cookie["path"].as_str().unwrap_or("/");
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
        let expiry = cookie["expires"]
            .as_f64()
            .filter(|v| *v > 0.0)
            .map(|v| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as f64;
                format!("; Max-Age={}", (v - now).max(0.0) as u64)
            })
            .unwrap_or_default();
        // Domain cookies carry a leading dot; omitting Domain preserves host-only cookies.
        let domain_attribute = if cookie["domain"]
            .as_str()
            .is_some_and(|v| v.starts_with('.'))
        {
            format!("; Domain={domain}")
        } else {
            String::new()
        };
        let text =
            format!("{name}={value}{domain_attribute}; Path={path}{secure}{http_only}{expiry}");
        store
            .parse(&text, &format!("https://{domain}/").parse().unwrap())
            .map_err(|_| "无法导入账号 Cookie。")?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub async fn complete_browser_login(
    webview: tauri::Webview,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    validate_id(&account_id)?;
    let _usage = state.use_account(&account_id, "确认应用内登录")?;
    require_browser_login(&state, &account_id, &login_id)?;
    if state.account(&account_id)?.platform_id == "douyin" {
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        state
            .douyin_browsers
            .refresh_credentials(&account_id)
            .await?;
        {
            let _lock = state.browsers.lock().unwrap();
            require_browser_login(&state, &account_id, &login_id)?;
            let session = state.create_session(
                &state.account(&account_id)?,
                reqwest_cookie_store::CookieStore::default(),
            )?;
            crate::accounts::login::commit_douyin(&state, &account_id, &session)?;
        }
        state.douyin_browsers.stop(&account_id).await?;
        let _lock = state.browsers.lock().unwrap();
        let mut logins = state.browser_login_ids.lock().unwrap();
        if logins.get(&account_id) != Some(&login_id) {
            return Err("operation-cancelled:登录验证已结束。".into());
        }
        state.douyin_browsers.ensure(&state, &account_id, None)?;
        logins.remove(&account_id);
        return Ok(());
    }
    let (page, agent) = {
        let mut browsers = state.browsers.lock().unwrap();
        let browser = browsers
            .get_mut(&account_id)
            .ok_or("请先打开此账号的登录页面。")?;
        if browser.finishing {
            return Err("此账号正在保存登录状态。".into());
        }
        browser.finishing = true;
        (browser.page.page(), browser.page.agent())
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let values = page.cookies().await?;
        let session = {
            require_browser_login(&state, &account_id, &login_id)?;
            let account = state.account(&account_id)?;
            let (root, credential) = match account.platform_id.as_str() {
                "bilibili" => ("bilibili.com", "SESSDATA"),
                "netease" => ("music.163.com", "MUSIC_U"),
                _ => return Err("不支持的账号平台。".into()),
            };
            let has_login = values["cookies"].as_array().is_some_and(|cookies| {
                cookies.iter().any(|c| {
                    let domain = c["domain"].as_str().unwrap_or("").trim_start_matches('.');
                    (domain == root || domain.ends_with(&format!(".{root}")))
                        && c["name"] == credential
                        && c["value"].as_str().is_some_and(|value| !value.is_empty())
                })
            });
            if !has_login {
                return Err("此页面尚未登录该平台，请完成登录后再保存。".into());
            }
            let session = state.session(&account_id)?;
            let count = {
                let mut store = session.cookies.lock().unwrap();
                *store = reqwest_cookie_store::CookieStore::default();
                import_cookies(&mut store, &values, root)?
            };
            if count == 0 {
                return Err("未读取到此平台凭证，请先完成登录。".into());
            }
            session
        };
        let user_id = if state.account(&account_id)?.platform_id == "netease" {
            crate::accounts::netease_login::user_id(&state, &account_id, &session).await?
        } else {
            crate::accounts::identity::bilibili_user(&session.cookies.lock().unwrap())?
        };
        require_browser_login(&state, &account_id, &login_id)?;
        if session.cancelled.is_cancelled() {
            return Err("operation-cancelled:登录验证已结束。".into());
        }
        let result = crate::accounts::identity::commit_login(
            &state,
            &account_id,
            &session,
            &user_id,
            agent.clone(),
            true,
        );
        state.sessions.lock().unwrap().remove(&account_id);
        result
    })
    .await
    .map_err(|_| "登录状态保存超时，请重试。".to_string())
    .and_then(|v| v);
    let mut browsers = state.browsers.lock().unwrap();
    let mut logins = state.browser_login_ids.lock().unwrap();
    if logins.get(&account_id) == Some(&login_id) && result.is_ok() {
        logins.remove(&account_id);
        if let Some(browser) = browsers.remove(&account_id) {
            browser.page.close(&state.embedded);
        }
    } else if logins.get(&account_id) == Some(&login_id)
        && let Some(browser) = browsers.get_mut(&account_id)
    {
        browser.finishing = false;
    }
    result
}

pub fn stop_browser(state: &RuntimeState, id: &str) {
    if let Some(browser) = state.browsers.lock().unwrap().remove(id) {
        browser.page.close(&state.embedded);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_cookies_import_only_the_platform_scope_and_keep_host_only_cookies() {
        let mut store = reqwest_cookie_store::CookieStore::default();
        let values = serde_json::json!({"cookies":[
            {"name":"SESSDATA","value":"fixture","domain":".bilibili.com","path":"/","httpOnly":true,"secure":true,"expires":-1},
            {"name":"host","value":"1","domain":"www.bilibili.com","path":"/","expires":-1},
            {"name":"other","value":"1","domain":".example.com","path":"/","expires":-1},
            {"name":"bad","value":"a;b","domain":".bilibili.com","path":"/","expires":-1},
        ]});
        assert_eq!(
            import_cookies(&mut store, &values, "bilibili.com").unwrap(),
            2
        );
        let names = |url: &str| {
            store
                .get_request_values(&url.parse().unwrap())
                .map(|(name, _)| name.to_owned())
                .collect::<Vec<_>>()
        };
        assert!(names("https://api.bilibili.com/").contains(&"SESSDATA".to_owned()));
        assert!(!names("https://api.bilibili.com/").contains(&"host".to_owned()));
        assert!(names("https://www.bilibili.com/").contains(&"host".to_owned()));
    }
}
