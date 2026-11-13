use crate::{
    model::{platform_url, validate_id},
    state::RuntimeState,
};
use fs2::FileExt;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    process::{Child, Command},
};
use tauri::{State, WebviewWindow};

pub struct BrowserProcess {
    pub _usage: crate::accounts::usage::AccountUse,
    pub child: Child,
    pub directory: PathBuf,
    pub finishing: bool,
    pub _profile_lock: std::fs::File,
}

pub fn retain_running(
    processes: &mut std::collections::HashMap<String, BrowserProcess>,
    id: &str,
) -> Result<bool, String> {
    if let Some(process) = processes.get_mut(id) {
        if process.finishing
            || process
                .child
                .try_wait()
                .map_err(|_| "无法检查浏览器状态。")?
                .is_none()
        {
            return Ok(true);
        }
        processes.remove(id);
    }
    Ok(false)
}

pub fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("拒绝远程页面调用应用能力。".into());
    }
    let url = window.url().map_err(|_| "无法检查调用来源。")?;
    let local =
        matches!(url.scheme(), "tauri") || matches!(url.host_str(), Some("tauri.localhost"));
    let dev =
        cfg!(debug_assertions) && url.origin().ascii_serialization() == "http://127.0.0.1:21420";
    if !local && !dev {
        return Err("拒绝非产品页面调用。".into());
    }
    Ok(())
}
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

#[tauri::command]
pub async fn begin_browser_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    browser: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    let usage = state.use_account(&account_id, "系统浏览器登录与验证")?;
    validate_id(&login_id)?;
    {
        let mut logins = state.browser_login_ids.lock().unwrap();
        if logins.contains_key(&account_id) {
            return Err("此账号的浏览器验证正在进行，请先完成或关闭。".into());
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
            return Err("operation-cancelled:浏览器验证已结束。".into());
        }
        state.clear_qr(&account_id);
        state
            .douyin_browsers
            .ensure(&state, &account_id, Some(&browser))?;
        state.pause_login(&account_id)?;
        if let Some(old) = state.sessions.lock().unwrap().remove(&account_id) {
            old.cancelled.cancel();
        }
        state
            .media
            .lock()
            .unwrap()
            .retain(|_, grant| grant.account_id.as_deref() != Some(&account_id));
        return Ok(());
    }
    let path = find_browser(&browser)?;
    let mut processes = state.browsers.lock().unwrap();
    let logins = state.browser_login_ids.lock().unwrap();
    if logins.get(&account_id) != Some(&login_id) {
        return Err("operation-cancelled:浏览器验证已结束。".into());
    }
    if retain_running(&mut processes, &account_id)? {
        return Err("此账号的验证浏览器已打开。".into());
    }
    let account = state.account(&account_id)?;
    if !account.enabled {
        return Err("请先启用此账号。".into());
    }
    let directory = state.directory.join("profiles").join(&account_id);
    std::fs::create_dir_all(&directory).map_err(|_| "无法创建账号浏览器目录。")?;
    let profile_lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(".account-profile-lock"))
        .map_err(|_| "无法锁定账号浏览器目录。")?;
    profile_lock
        .try_lock_exclusive()
        .map_err(|_| "此账号的浏览器目录正在被其他应用实例使用。")?;
    // A stale DevToolsActivePort must never attach to a different or previously closed process.
    let _ = std::fs::remove_file(directory.join("DevToolsActivePort"));
    let mut command = Command::new(path);
    command
        .arg(format!("--user-data-dir={}", directory.display()))
        .args([
            "--remote-debugging-port=0",
            "--remote-debugging-address=127.0.0.1",
            "--no-first-run",
            "--no-default-browser-check",
        ]);
    if let Some(id) = state.active_proxy(&account) {
        let snapshot = state.snapshot.lock().unwrap();
        let proxy = snapshot
            .proxies
            .iter()
            .find(|p| p.id == id)
            .ok_or("账号代理不存在。")?;
        command.arg(format!("--proxy-server={}", proxy.url));
    } else {
        command.arg("--no-proxy-server");
    }
    command.arg(platform_url(&account.platform_id)?.as_str());
    let child = command.spawn().map_err(|_| "无法启动系统浏览器。")?;
    processes.insert(
        account_id.clone(),
        BrowserProcess {
            _usage: usage,
            child,
            directory,
            finishing: false,
            _profile_lock: profile_lock,
        },
    );
    state.clear_qr(&account_id);
    state.pause_login(&account_id)?;
    if let Some(session) = state.sessions.lock().unwrap().remove(&account_id) {
        session.cancelled.cancel();
    }
    state
        .media
        .lock()
        .unwrap()
        .retain(|_, grant| grant.account_id.as_deref() != Some(&account_id));
    Ok(())
}

#[tauri::command]
pub async fn cancel_browser_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&window)?;
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
    if let Some(mut browser) = browsers.remove(&account_id) {
        let _ = browser.child.kill();
        let _ = browser.child.wait();
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
        return Err("operation-cancelled:浏览器验证已结束或被替换。".into());
    }
    Ok(())
}

async fn cdp_call<S>(socket: &mut S, id: u64, method: &str) -> Result<Value, String>
where
    S: futures_util::Sink<tokio_tungstenite::tungstenite::Message>
        + futures_util::Stream<
            Item = Result<
                tokio_tungstenite::tungstenite::Message,
                tokio_tungstenite::tungstenite::Error,
            >,
        > + Unpin,
{
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({"id":id,"method":method,"params":{}})
                .to_string()
                .into(),
        ))
        .await
        .map_err(|_| "凭证读取连接失败。")?;
    while let Some(message) = socket.next().await {
        let message = message.map_err(|_| "凭证读取响应失败。")?;
        if let Ok(value) = serde_json::from_str::<Value>(message.to_text().unwrap_or(""))
            && value.get("id").and_then(Value::as_u64) == Some(id)
        {
            if value.get("error").is_some() {
                return Err("浏览器拒绝凭证读取。".into());
            }
            return Ok(value["result"].clone());
        }
    }
    Err("浏览器已关闭，无法读取凭证，请重新打开后点击完成。".into())
}

#[tauri::command]
pub async fn complete_browser_login(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    account_id: String,
    login_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    validate_id(&account_id)?;
    let _usage = state.use_account(&account_id, "确认浏览器登录")?;
    require_browser_login(&state, &account_id, &login_id)?;
    if state.account(&account_id)?.platform_id == "douyin" {
        let _handoff = state.douyin_browsers.handoff(&account_id).await;
        state
            .douyin_browsers
            .refresh_credentials(&account_id)
            .await?;
        {
            let _lock = state.browsers.lock().unwrap();
            let logins = state.browser_login_ids.lock().unwrap();
            if logins.get(&account_id) != Some(&login_id) {
                return Err("operation-cancelled:浏览器验证已结束。".into());
            }
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
            return Err("operation-cancelled:浏览器验证已结束。".into());
        }
        state.douyin_browsers.ensure(&state, &account_id, None)?;
        logins.remove(&account_id);
        return Ok(());
    }
    let directory = {
        let mut browsers = state.browsers.lock().unwrap();
        let browser = browsers
            .get_mut(&account_id)
            .ok_or("请先打开此账号的验证浏览器。")?;
        if browser.finishing {
            return Err("此账号正在回收凭证。".into());
        }
        browser.finishing = true;
        browser.directory.clone()
    };
    // No CDP connection exists before this explicit user action. Only cookie/version methods run.
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let port_file = tokio::fs::read_to_string(directory.join("DevToolsActivePort"))
            .await
            .map_err(|_| "浏览器尚未准备好，或已关闭。")?;
        let mut lines = port_file.lines();
        let port = lines
            .next()
            .and_then(|v| v.parse::<u16>().ok())
            .filter(|p| *p > 0)
            .ok_or("浏览器调试端口无效。")?;
        let path = lines
            .next()
            .filter(|v| v.starts_with("/devtools/browser/"))
            .ok_or("浏览器调试路径无效。")?;
        let (mut socket, _) =
            tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}{path}"))
                .await
                .map_err(|_| "无法连接验证完成后的浏览器。")?;
        let version = cdp_call(&mut socket, 1, "Browser.getVersion").await?;
        let values = cdp_call(&mut socket, 2, "Storage.getCookies").await?;
        let session = {
            let logins = state.browser_login_ids.lock().unwrap();
            if logins.get(&account_id) != Some(&login_id) {
                return Err("operation-cancelled:浏览器验证已结束。".into());
            }
            let account = state.account(&account_id)?;
            let root = match account.platform_id.as_str() {
                "bilibili" => "bilibili.com",
                "netease" => "music.163.com",
                "douyin" => "douyin.com",
                _ => return Err("不支持的账号平台。".into()),
            };
            let session = state.session(&account_id)?;
            let cookies = values["cookies"]
                .as_array()
                .ok_or("浏览器 Cookie 响应无效。")?;
            let has_login = cookies.iter().any(|c| {
                let domain = c["domain"].as_str().unwrap_or("").trim_start_matches('.');
                let name = c["name"].as_str().unwrap_or("");
                (domain == root || domain.ends_with(&format!(".{root}")))
                    && (match root {
                        "bilibili.com" => name == "SESSDATA",
                        "music.163.com" => name == "MUSIC_U",
                        _ => name == "sessionid" || name == "sessionid_ss",
                    })
                    && c["value"].as_str().is_some_and(|value| !value.is_empty())
            });
            if !has_login {
                return Err("此浏览器尚未登录该平台，请完成登录后再回收凭证。".into());
            }
            let mut count = 0;
            {
                let mut store = session.cookies.lock().unwrap();
                *store = reqwest_cookie_store::CookieStore::default();
                for cookie in values["cookies"]
                    .as_array()
                    .ok_or("浏览器 Cookie 响应无效。")?
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
                    if name.is_empty()
                        || [name, value].iter().any(|v| v.contains(['\r', '\n', ';']))
                    {
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
                    // CDP prefixes domain cookies with a dot; omitting Domain preserves host-only cookies.
                    let domain_attribute = if cookie["domain"]
                        .as_str()
                        .is_some_and(|v| v.starts_with('.'))
                    {
                        format!("; Domain={domain}")
                    } else {
                        String::new()
                    };
                    let text = format!(
                        "{name}={value}{domain_attribute}; Path={path}{secure}{http_only}{expiry}"
                    );
                    store
                        .parse(&text, &format!("https://{domain}/").parse().unwrap())
                        .map_err(|_| "无法导入账号 Cookie。")?;
                    count += 1;
                }
            }
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
        {
            let logins = state.browser_login_ids.lock().unwrap();
            if logins.get(&account_id) != Some(&login_id) || session.cancelled.is_cancelled() {
                return Err("operation-cancelled:浏览器验证已结束。".into());
            }
            let result = crate::accounts::identity::commit_login(
                &state,
                &account_id,
                &session,
                &user_id,
                version["userAgent"].as_str().map(str::to_owned),
                true,
            );
            state.sessions.lock().unwrap().remove(&account_id);
            result?;
        }
        let _ = cdp_call(&mut socket, 3, "Browser.close").await;
        Ok(())
    })
    .await
    .map_err(|_| "凭证读取超时，请重试。".to_string())
    .and_then(|v| v);
    let mut browsers = state.browsers.lock().unwrap();
    let mut logins = state.browser_login_ids.lock().unwrap();
    if logins.get(&account_id) == Some(&login_id) && result.is_ok() {
        logins.remove(&account_id);
        if let Some(mut process) = browsers.remove(&account_id) {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    } else if logins.get(&account_id) == Some(&login_id)
        && let Some(process) = browsers.get_mut(&account_id)
    {
        process.finishing = false;
    }
    result
}

pub fn stop_browser(state: &RuntimeState, id: &str) {
    if let Some(mut browser) = state.browsers.lock().unwrap().remove(id) {
        let _ = browser.child.kill();
        let _ = browser.child.wait();
    }
}
