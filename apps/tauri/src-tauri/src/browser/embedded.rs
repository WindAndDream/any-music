//! Official account pages embedded in the product window as child WebViews.
//! Each account owns a persistent data store and proxy. Remote pages reach only the bounded
//! report bridge of their own native page; credentials stay native and the renderer only
//! positions a presented page inside its dialog.
mod driver;
pub use driver::AccountPages;

use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::mpsc;

/// Hidden pages keep a desktop-sized viewport outside the visible window area, so official
/// layouts, lazy lists and scroll observers behave as they do for a visible browser tab.
const HIDDEN_ORIGIN: f64 = 8192.0;
const VIEWPORT: (f64, f64) = (1280.0, 800.0);
/// Captured bodies use the same budget as the account response caches, plus metadata.
pub(crate) const MAX_BODY: usize = 12 * 1024 * 1024;
const MAX_TEXT: usize = 256 * 1024;
const LABEL_PREFIX: &str = "account-page-";

/// How a page is shown to the user. Challenge pages stay hidden until the website shows a
/// login or security challenge, and then only that challenge is visible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presentation {
    Challenge,
    Page,
}
impl Presentation {
    fn name(self) -> &'static str {
        match self {
            Self::Challenge => "challenge",
            Self::Page => "page",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Bounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite() && value.abs() <= 100_000.0)
            && self.width >= 1.0
            && self.height >= 1.0
    }
}

/// Exchanges a page may report. Native actors still validate exact endpoints and cursors.
#[derive(Clone, Copy)]
pub struct Capture {
    pub hosts: &'static [&'static str],
    pub prefixes: &'static [&'static str],
    /// Main-document paths whose serialized document may serve as a bounded fallback.
    pub documents: Option<&'static str>,
}
pub const DOUYIN_CAPTURE: Capture = Capture {
    hosts: &["www.douyin.com", "www-hj.douyin.com", "login.douyin.com"],
    prefixes: &["/aweme/v1/web/", "/passport/web/"],
    documents: Some(r"^/(?:video|note)/\d{1,32}$"),
};
pub const NO_CAPTURE: Capture = Capture {
    hosts: &[],
    prefixes: &[],
    documents: None,
};

/// One account's persistent browser context and network route.
#[derive(Clone)]
pub struct Store {
    pub account: String,
    directory: PathBuf,
    identifier: [u8; 16],
    pub proxy: Option<String>,
    capture: Capture,
}
impl Store {
    pub fn new(
        profiles: &Path,
        account: &str,
        proxy: Option<&str>,
        capture: Capture,
    ) -> Result<Self, String> {
        crate::model::validate_id(account)?;
        if let Some(proxy) = proxy {
            let url = reqwest::Url::parse(proxy).map_err(|_| "账号代理地址无效。")?;
            if !matches!(url.scheme(), "http" | "socks5") {
                return Err("内嵌账号页面仅支持 HTTP 或 SOCKS5 代理。".into());
            }
        }
        let directory = profiles.join(account).join("webview");
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建账号页面数据目录。")?;
        Ok(Self {
            account: account.into(),
            directory,
            identifier: identifier(account),
            proxy: proxy.map(str::to_owned),
            capture,
        })
    }
}

/// One native owner per account context, across runs and application instances.
fn lock(store: &Store) -> Result<std::fs::File, String> {
    use fs2::FileExt;
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(store.directory.join(".account-page-lock"))
        .map_err(|_| "无法锁定账号页面数据。")?;
    lock.try_lock_exclusive()
        .map_err(|_| "此账号页面正在使用，请稍后重试。")?;
    Ok(lock)
}

/// A user-operated page for platforms whose credentials are read only after the user
/// confirms completion. It keeps the page identity reported by its first document.
pub struct ManualPage {
    page: Page,
    agent: Arc<Mutex<Option<String>>>,
    task: tauri::async_runtime::JoinHandle<()>,
    _lock: std::fs::File,
}
impl ManualPage {
    pub async fn open(host: &Host, store: Store, url: &str) -> Result<Self, String> {
        let lock = lock(&store)?;
        let (reports, mut received) = mpsc::channel::<Value>(64);
        let page = host.open(&store, reports, url).await?;
        let agent = Arc::new(Mutex::new(None));
        let observed = agent.clone();
        let task = tauri::async_runtime::spawn(async move {
            while let Some(report) = received.recv().await {
                if report["kind"] == "hello"
                    && let Some(value) = report["userAgent"].as_str()
                {
                    observed
                        .lock()
                        .unwrap()
                        .get_or_insert_with(|| value.to_owned());
                }
            }
        });
        host.present(&store.account, &page, Presentation::Page);
        Ok(Self {
            page,
            agent,
            task,
            _lock: lock,
        })
    }
    pub fn page(&self) -> Page {
        self.page.clone()
    }
    pub fn agent(&self) -> Option<String> {
        self.agent.lock().unwrap().clone()
    }
    pub fn close(self, host: &Host) {
        host.close(&self.page);
        self.task.abort();
    }
}

/// macOS data stores are keyed by 16 bytes; derive them from the stable account UUID.
pub fn identifier(account: &str) -> [u8; 16] {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("any-music-account-page:{account}"));
    digest[..16].try_into().unwrap()
}

/// A live child WebView owned by one native actor.
#[derive(Clone)]
pub struct Page {
    pub label: String,
    property: String,
    webview: tauri::Webview,
}
impl Page {
    pub fn navigate(&self, url: &str) -> Result<(), String> {
        let url = url.parse().map_err(|_| "invalid-input:页面地址无效。")?;
        self.webview
            .navigate(url)
            .map_err(|_| "network-error:账号页面导航失败。".into())
    }
    /// Run a fixed expression; its value returns as an `eval` report with the same id.
    pub fn evaluate(&self, id: u64, expression: &str) -> Result<(), String> {
        let expression = expression_source(expression);
        self.webview
            .eval(format!(
                "void (()=>{{const bridge=window[{}];if(bridge)bridge.run({id},async()=>({expression}))}})()",
                json!(self.property)
            ))
            .map_err(|_| "network-error:账号页面脚本执行失败。".into())
    }
    /// HttpOnly cookies are read natively and never cross product IPC.
    pub async fn cookies(&self) -> Result<Value, String> {
        let webview = self.webview.clone();
        let cookies = tauri::async_runtime::spawn_blocking(move || webview.cookies())
            .await
            .map_err(|_| "network-error:账号页面凭证读取中断。")?
            .map_err(|_| "network-error:无法读取账号页面凭证。")?;
        Ok(json!({"cookies": cookies.iter().map(cookie_value).collect::<Vec<_>>()}))
    }
    /// `viewport` is the page's CSS viewport height reported by its bridge.
    pub async fn click(&self, x: f64, y: f64, viewport: f64) -> bool {
        native_click(self.webview.clone(), x, y, viewport).await
    }
    pub async fn set_cookies(&self, cookies: Vec<tauri::webview::Cookie<'static>>) {
        let webview = self.webview.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            for cookie in cookies {
                let _ = webview.set_cookie(cookie);
            }
        })
        .await;
    }
}

/// Deliver one primary click at a viewport point as browser input, so the page receives
/// trusted pointer/mouse/click events. Returns `false` where no native path exists yet.
#[cfg(target_os = "macos")]
async fn native_click(webview: tauri::Webview, x: f64, y: f64, viewport: f64) -> bool {
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSView};
    use objc2_foundation::{NSPoint, NSProcessInfo};
    let (done, wait) = std::sync::mpsc::channel();
    // AppKit views are main-thread objects; `with_webview` runs there.
    let scheduled = webview.with_webview(move |platform| {
        // SAFETY: wry's macOS platform webview is a live WKWebView, an NSView subclass,
        // owned by this webview for the duration of the main-thread callback.
        let Some(view) = (unsafe { (platform.inner() as *const NSView).as_ref() }) else {
            let _ = done.send(false);
            return;
        };
        let Some(window) = view.window() else {
            let _ = done.send(false);
            return;
        };
        let height = view.bounds().size.height;
        // CSS coordinates start below any obscured top inset (e.g. under the title bar).
        let y = y + (height - viewport).clamp(0.0, height);
        let local = NSPoint::new(x, if view.isFlipped() { y } else { height - y });
        let location = view.convertPoint_toView(local, None);
        let time = NSProcessInfo::processInfo().systemUptime();
        for kind in [NSEventType::LeftMouseDown, NSEventType::LeftMouseUp] {
            let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                kind,
                location,
                NSEventModifierFlags::empty(),
                time,
                window.windowNumber(),
                None,
                0,
                1,
                if kind == NSEventType::LeftMouseDown { 1.0 } else { 0.0 },
            ) else {
                let _ = done.send(false);
                return;
            };
            if kind == NSEventType::LeftMouseDown {
                view.mouseDown(&event);
            } else {
                view.mouseUp(&event);
            }
        }
        let _ = done.send(true);
    });
    scheduled.is_ok()
        && tauri::async_runtime::spawn_blocking(move || {
            wait.recv_timeout(std::time::Duration::from_secs(2))
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false)
}
#[cfg(not(target_os = "macos"))]
async fn native_click(_: tauri::Webview, _: f64, _: f64, _: f64) -> bool {
    false
}

/// Bundled page scripts are standalone files with leading comments and statement guards.
/// Strip those so the remaining source can be embedded as one expression.
pub(crate) fn expression_source(source: &str) -> &str {
    let mut rest = source.trim_start();
    while let Some(line) = rest.strip_prefix("//") {
        rest = line
            .split_once('\n')
            .map_or("", |(_, next)| next)
            .trim_start();
    }
    rest.trim_start_matches(';')
        .trim_end()
        .trim_end_matches(';')
}

/// Use the CDP cookie shape consumed by account projections. Cookie parsing drops the
/// leading dot, so registrable domains are restored as domain cookies.
fn cookie_value(cookie: &tauri::webview::Cookie<'static>) -> Value {
    let domain = cookie.domain().unwrap_or("");
    let domain = if domain.is_empty() || domain.starts_with('.') || domain.matches('.').count() > 1
    {
        domain.to_owned()
    } else {
        format!(".{domain}")
    };
    json!({
        "name": cookie.name(),
        "value": cookie.value(),
        "domain": domain,
        "path": cookie.path().unwrap_or("/"),
        "expires": cookie.expires_datetime().map_or(-1.0, |time| time.unix_timestamp() as f64),
        "httpOnly": cookie.http_only().unwrap_or(false),
        "secure": cookie.secure().unwrap_or(false),
    })
}

/// Convert stored native credentials into page cookies, so an existing account keeps its
/// sign-in when its persistent page context is created for the first time.
pub fn seed_cookies(
    store: &reqwest_cookie_store::CookieStore,
) -> Vec<tauri::webview::Cookie<'static>> {
    use tauri::webview::cookie::{Cookie, Expiration, time::OffsetDateTime};
    store
        .iter_unexpired()
        .filter_map(|cookie| {
            let domain = match &cookie.domain {
                cookie_store::CookieDomain::HostOnly(host) => host.clone(),
                cookie_store::CookieDomain::Suffix(suffix) => format!(".{suffix}"),
                _ => return None,
            };
            let mut built = Cookie::build((cookie.name().to_owned(), cookie.value().to_owned()))
                .domain(domain)
                .path(String::from(cookie.path.clone()))
                .secure(cookie.secure().unwrap_or(false))
                .http_only(cookie.http_only().unwrap_or(false));
            if let cookie_store::CookieExpiration::AtUtc(at) = &cookie.expires {
                let seconds = at.unix_timestamp();
                built = built.expires(Expiration::DateTime(
                    OffsetDateTime::from_unix_timestamp(seconds).ok()?,
                ));
            }
            Some(built.build())
        })
        .collect()
}

struct Link {
    account: String,
    token: String,
    reports: mpsc::Sender<Value>,
}
struct Shown {
    label: String,
    mode: Presentation,
    revealed: bool,
    focused: bool,
    size: Option<(f64, f64)>,
    webview: tauri::Webview,
}

#[derive(Default)]
pub struct Host {
    app: OnceLock<tauri::AppHandle>,
    links: Mutex<HashMap<String, Link>>,
    shown: Mutex<HashMap<String, Shown>>,
    layouts: Mutex<HashMap<String, Bounds>>,
    next: AtomicU64,
}
impl Host {
    pub fn attach(&self, app: tauri::AppHandle) {
        let _ = self.app.set(app);
    }
    /// Create a hidden page for `store`. `reports` receives bridge observations and loads.
    pub async fn open(
        &self,
        store: &Store,
        reports: mpsc::Sender<Value>,
        url: &str,
    ) -> Result<Page, String> {
        if !cfg!(desktop) {
            return Err("此设备不支持内嵌账号页面。".into());
        }
        let app = self
            .app
            .get()
            .cloned()
            .ok_or("network-error:应用窗口尚未就绪。")?;
        let url: tauri::Url = url.parse().map_err(|_| "invalid-input:页面地址无效。")?;
        let label = format!(
            "{LABEL_PREFIX}{}",
            self.next.fetch_add(1, Ordering::Relaxed) + 1
        );
        let token = uuid::Uuid::new_v4().simple().to_string();
        let property = format!("__am{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let config = json!({
            "property": property,
            "token": token,
            "hosts": store.capture.hosts,
            "prefixes": store.capture.prefixes,
            "documents": store.capture.documents,
            "limit": MAX_BODY,
        });
        let script =
            include_str!("embedded/bridge.js").replacen("__AM_CONFIG__", &config.to_string(), 1);
        self.links.lock().unwrap().insert(
            label.clone(),
            Link {
                account: store.account.clone(),
                token,
                reports: reports.clone(),
            },
        );
        let built = {
            let label = label.clone();
            let store = store.clone();
            tauri::async_runtime::spawn_blocking(move || {
                build(&app, &label, url, script, &store, reports)
            })
            .await
            .map_err(|_| "network-error:账号页面创建中断。".to_string())
            .and_then(|result| result)
        };
        match built {
            Ok(webview) => Ok(Page {
                label,
                property,
                webview,
            }),
            Err(error) => {
                self.links.lock().unwrap().remove(&label);
                Err(error)
            }
        }
    }
    pub fn close(&self, page: &Page) {
        self.links.lock().unwrap().remove(&page.label);
        let account = {
            let mut shown = self.shown.lock().unwrap();
            let account = shown
                .iter()
                .find(|(_, shown)| shown.label == page.label)
                .map(|(account, _)| account.clone());
            if let Some(account) = &account {
                shown.remove(account);
            }
            account
        };
        if let Some(account) = account {
            self.emit(&account, "closed", None, None);
        }
        let _ = page.webview.close();
    }
    /// Register the account's user-facing page. Only one page per account is presented.
    pub fn present(&self, account: &str, page: &Page, mode: Presentation) {
        let previous = self.shown.lock().unwrap().insert(
            account.into(),
            Shown {
                label: page.label.clone(),
                mode,
                revealed: false,
                focused: false,
                size: None,
                webview: page.webview.clone(),
            },
        );
        if let Some(previous) = previous {
            hide(&previous.webview);
        }
        self.emit(account, "pending", Some(mode), None);
        if mode == Presentation::Page {
            self.reveal(&page.label, None);
        }
    }
    /// Show the presented page. `size` is the challenge's own size, when isolated.
    pub fn reveal(&self, label: &str, size: Option<(f64, f64)>) {
        let event = {
            let mut shown = self.shown.lock().unwrap();
            let Some((account, current)) = shown.iter_mut().find(|(_, s)| s.label == label) else {
                return;
            };
            let changed = !current.revealed
                || match (current.size, size) {
                    (Some(old), Some(new)) => {
                        (old.0 - new.0).abs() > 2.0 || (old.1 - new.1).abs() > 2.0
                    }
                    (old, new) => old.is_some() != new.is_some(),
                };
            current.revealed = true;
            current.size = size;
            if let Some(bounds) = self.layouts.lock().unwrap().get(account) {
                place(current, bounds);
            }
            changed.then(|| (account.clone(), current.mode))
        };
        if let Some((account, mode)) = event {
            self.emit(&account, "visible", Some(mode), size);
        }
    }
    /// Return the presented page to its hidden position, e.g. after a challenge closes.
    pub fn conceal(&self, label: &str) {
        let event = {
            let mut shown = self.shown.lock().unwrap();
            let Some((account, current)) = shown.iter_mut().find(|(_, s)| s.label == label) else {
                return;
            };
            if !current.revealed {
                return;
            }
            current.revealed = false;
            current.size = None;
            hide(&current.webview);
            (account.clone(), current.mode)
        };
        self.emit(&event.0, "pending", Some(event.1), None);
    }
    pub fn revealed(&self, label: &str) -> bool {
        self.shown
            .lock()
            .unwrap()
            .values()
            .any(|shown| shown.label == label && shown.revealed)
    }
    /// Renderer dialog geometry in main-window logical pixels; `None` hides the page.
    pub fn layout(&self, account: &str, bounds: Option<Bounds>) -> Result<(), String> {
        match bounds {
            Some(bounds) if !bounds.valid() => return Err("invalid-input:页面区域无效。".into()),
            Some(bounds) => {
                self.layouts.lock().unwrap().insert(account.into(), bounds);
            }
            None => {
                self.layouts.lock().unwrap().remove(account);
            }
        }
        if let Some(shown) = self.shown.lock().unwrap().get_mut(account) {
            match bounds {
                Some(bounds) if shown.revealed => place(shown, &bounds),
                _ => hide(&shown.webview),
            }
        }
        Ok(())
    }
    /// Validate a bridge report and route it to the owning native actor.
    pub fn report(&self, label: &str, token: &str, mut report: Value) -> Result<(), String> {
        let links = self.links.lock().unwrap();
        let link = links
            .get(label)
            .filter(|link| link.token == token)
            .ok_or("拒绝未知页面报告。")?;
        let kind = report["kind"].as_str().unwrap_or("");
        if !matches!(
            kind,
            "hello" | "viewport" | "request" | "exchange" | "failed" | "document" | "eval"
        ) {
            return Err("拒绝未知页面报告。".into());
        }
        let oversized = ["url", "responseUrl", "postData", "error", "userAgent"]
            .iter()
            .any(|key| {
                report[*key]
                    .as_str()
                    .is_some_and(|text| text.len() > MAX_TEXT)
            })
            || report["body"]
                .as_str()
                .is_some_and(|body| body.len() > MAX_BODY);
        if oversized {
            return Err("页面报告超过预算。".into());
        }
        report["label"] = label.into();
        // Overload must be observable: the actor treats a closed channel as a lost page.
        link.reports
            .try_send(report)
            .map_err(|_| "页面报告队列已满。".to_string())
    }
    /// Delete a removed account's page context. Other platforms keep it inside the Profile
    /// directory, which account deletion detaches.
    pub async fn remove_store(&self, account: &str) {
        #[cfg(target_os = "macos")]
        if let Some(app) = self.app.get() {
            let _ = app.remove_data_store(identifier(account)).await;
        }
        #[cfg(not(target_os = "macos"))]
        let _ = account;
    }
    pub fn owns(&self, label: &str, account: &str) -> bool {
        self.links
            .lock()
            .unwrap()
            .get(label)
            .is_some_and(|link| link.account == account)
    }
    fn emit(
        &self,
        account: &str,
        state: &str,
        mode: Option<Presentation>,
        size: Option<(f64, f64)>,
    ) {
        use tauri::Emitter;
        if let Some(app) = self.app.get() {
            let _ = app.emit_to(
                "main",
                "account-page",
                json!({
                    "accountId": account,
                    "state": state,
                    "mode": mode.map(Presentation::name),
                    "width": size.map(|size| size.0),
                    "height": size.map(|size| size.1),
                }),
            );
        }
    }
}

fn place(shown: &mut Shown, bounds: &Bounds) {
    let _ = shown.webview.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(bounds.x, bounds.y).into(),
        size: tauri::LogicalSize::new(bounds.width, bounds.height).into(),
    });
    if !shown.focused {
        shown.focused = true;
        let _ = shown.webview.set_focus();
    }
}
fn hide(webview: &tauri::Webview) {
    let _ = webview.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(HIDDEN_ORIGIN, 0.0).into(),
        size: tauri::LogicalSize::new(VIEWPORT.0, VIEWPORT.1).into(),
    });
}

#[cfg(target_os = "macos")]
fn safari_agent() -> String {
    // WKWebView omits Safari's product token; official pages treat that as an unknown browser.
    let version = std::fs::read_to_string("/Applications/Safari.app/Contents/Info.plist")
        .ok()
        .and_then(|plist| {
            let (_, rest) = plist.split_once("<key>CFBundleShortVersionString</key>")?;
            let (_, rest) = rest.split_once("<string>")?;
            let (version, _) = rest.split_once("</string>")?;
            version
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
                .then(|| version.to_owned())
        })
        .unwrap_or_else(|| "18.0".into());
    format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{version} Safari/605.1.15"
    )
}

#[cfg(desktop)]
fn build(
    app: &tauri::AppHandle,
    label: &str,
    url: tauri::Url,
    script: String,
    store: &Store,
    reports: mpsc::Sender<Value>,
) -> Result<tauri::Webview, String> {
    use tauri::Manager;
    let window = app.get_window("main").ok_or("无法找到应用窗口。")?;
    let page = label.to_owned();
    let mut builder = tauri::webview::WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
        .initialization_script(script)
        .focused(false)
        .disable_drag_drop_handler()
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        // Remote pages may follow official HTTPS redirects but never open app schemes/windows.
        .on_navigation(|url| url.scheme() == "https" || url.as_str() == "about:blank")
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                let _ = reports.try_send(json!({"label": page, "kind": "navigation"}));
            }
        });
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .data_store_identifier(store.identifier)
            .user_agent(&safari_agent());
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.data_directory(store.directory.clone());
    }
    if let Some(proxy) = &store.proxy {
        builder = builder.proxy_url(proxy.parse().map_err(|_| "账号代理地址无效。")?);
    }
    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(HIDDEN_ORIGIN, 0.0),
            tauri::LogicalSize::new(VIEWPORT.0, VIEWPORT.1),
        )
        .map_err(|_| "network-error:无法创建内嵌账号页面。".into())
}
#[cfg(not(desktop))]
fn build(
    _: &tauri::AppHandle,
    _: &str,
    _: tauri::Url,
    _: String,
    _: &Store,
    _: mpsc::Sender<Value>,
) -> Result<tauri::Webview, String> {
    Err("此设备不支持内嵌账号页面。".into())
}

/// Embedded bridge observations only; no product capability is reachable from this command.
#[tauri::command]
pub async fn account_page_report(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::state::RuntimeState>,
    token: String,
    report: Value,
) -> Result<(), String> {
    if !webview.label().starts_with(LABEL_PREFIX) {
        return Err("拒绝非账号页面报告。".into());
    }
    state.embedded.report(webview.label(), &token, report)
}

/// Product dialogs position the account's presented page; `None` hides it again.
#[tauri::command]
pub fn account_page_layout(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::state::RuntimeState>,
    account_id: String,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    crate::browser::verification::require_main(&webview)?;
    crate::model::validate_id(&account_id)?;
    state.embedded.layout(&account_id, bounds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_require_the_page_token_and_known_bounded_kinds() {
        let host = Host::default();
        let (reports, mut received) = mpsc::channel(4);
        host.links.lock().unwrap().insert(
            "account-page-1".into(),
            Link {
                account: "account".into(),
                token: "secret".into(),
                reports,
            },
        );
        assert!(
            host.report("account-page-1", "wrong", json!({"kind":"hello"}))
                .is_err()
        );
        assert!(
            host.report("account-page-2", "secret", json!({"kind":"hello"}))
                .is_err()
        );
        assert!(
            host.report("account-page-1", "secret", json!({"kind":"invoke"}))
                .is_err()
        );
        assert!(
            host.report(
                "account-page-1",
                "secret",
                json!({"kind":"exchange","url":"x".repeat(MAX_TEXT + 1)})
            )
            .is_err()
        );
        host.report(
            "account-page-1",
            "secret",
            json!({"kind":"hello","label":"forged"}),
        )
        .unwrap();
        assert_eq!(received.try_recv().unwrap()["label"], "account-page-1");
        assert!(host.owns("account-page-1", "account"));
        assert!(!host.owns("account-page-1", "other"));
    }

    #[test]
    fn data_store_identity_is_stable_per_account_and_bounds_are_checked() {
        assert_eq!(identifier("a"), identifier("a"));
        assert_ne!(identifier("a"), identifier("b"));
        assert!(
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 320.0,
                height: 240.0
            }
            .valid()
        );
        for bounds in [
            Bounds {
                x: f64::NAN,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 1.0,
            },
        ] {
            assert!(!bounds.valid());
        }
    }

    #[test]
    fn page_cookies_restore_domain_scope_for_account_projections() {
        let host_only = tauri::webview::cookie::Cookie::build(("a", "1"))
            .domain("www.douyin.com")
            .path("/")
            .build();
        let domain = tauri::webview::cookie::Cookie::build(("sessionid", "2"))
            .domain("douyin.com")
            .http_only(true)
            .secure(true)
            .build();
        assert_eq!(cookie_value(&host_only)["domain"], "www.douyin.com");
        let value = cookie_value(&domain);
        assert_eq!(value["domain"], ".douyin.com");
        assert_eq!(value["httpOnly"], true);
        assert_eq!(value["expires"], -1.0);
        let store =
            crate::browser::douyin_browser::projection::cookie_store(&json!({"cookies":[value]}))
                .unwrap();
        assert!(crate::browser::douyin_browser::projection::has_login(
            &store
        ));
        let seeded = seed_cookies(&store);
        assert_eq!(seeded.len(), 1);
        assert_eq!(seeded[0].domain(), Some("douyin.com"));
        assert_eq!(seeded[0].http_only(), Some(true));
    }
}
