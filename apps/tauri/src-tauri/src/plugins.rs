//! Native authority composition. S15 connects verified previews to native installation and
//! isolated execution only on an exactly accepted OS/WebView/Profile/resource target.
use crate::storage::plugins::PluginStore;
use am_plugin_runtime::{Clock, Error, Ids, Runtime};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::Semaphore;
pub(crate) mod control;
pub(crate) mod delivery;
#[cfg(desktop)]
pub(crate) mod dev;
#[cfg(mobile)]
pub(crate) mod unavailable_dev;
#[cfg(mobile)]
pub(crate) use unavailable_dev as dev;
#[cfg(desktop)]
pub(crate) mod executor;
#[cfg(mobile)]
pub(crate) mod unavailable_executor;
#[cfg(mobile)]
pub(crate) use unavailable_executor as executor;
#[cfg(desktop)]
mod executor_budget;
#[cfg(desktop)]
mod executor_transport;
#[cfg(desktop)]
mod network;
mod package_files;
pub(crate) mod packages;
mod revocations;
#[cfg(desktop)]
pub(crate) mod source_auth;
pub(crate) mod target;
#[cfg(mobile)]
pub(crate) mod unavailable_source_auth;
#[cfg(mobile)]
pub(crate) use unavailable_source_auth as source_auth;

struct NativeClock;
impl Clock for NativeClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(u64::MAX, |d| d.as_millis().try_into().unwrap_or(u64::MAX))
    }
}
struct NativeIds;
impl Ids for NativeIds {
    fn next_id(&mut self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
type Authority = Runtime<PluginStore, NativeClock, NativeIds>;
pub(crate) struct PluginAuthority {
    #[cfg(desktop)]
    source_contexts: Mutex<std::collections::BTreeMap<String, String>>,
    admitted: bool,
    dev: bool,
    path: PathBuf,
    package_directory: PathBuf,
    preview: Mutex<Option<packages::PreviewSession>>,
    preview_result: Mutex<Option<(String, bool)>>,
    stopped: std::sync::atomic::AtomicBool,
    authority: Mutex<Option<Result<Authority, Error>>>,
    capacity: Arc<Semaphore>,
    acquisition: Mutex<tokio_util::sync::CancellationToken>,
    network_tasks:
        Mutex<std::collections::BTreeMap<String, Vec<tokio_util::sync::CancellationToken>>>,
}
impl PluginAuthority {
    pub(super) fn cancel_network(&self, install: &str) {
        if let Ok(mut tasks) = self.network_tasks.lock()
            && let Some(tokens) = tasks.remove(install)
        {
            for token in tokens {
                token.cancel()
            }
        }
    }
    pub fn new(directory: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            #[cfg(desktop)]
            source_contexts: Default::default(),
            admitted: target::admitted(),
            dev: false,
            path: directory.join("plugins.sqlite3"),
            package_directory: directory.join("plugin-packages"),
            preview: Mutex::new(None),
            preview_result: Mutex::new(None),
            stopped: std::sync::atomic::AtomicBool::new(false),
            authority: Mutex::new(None),
            capacity: Arc::new(Semaphore::new(1)),
            acquisition: Mutex::new(tokio_util::sync::CancellationToken::new()),
            network_tasks: Mutex::new(std::collections::BTreeMap::new()),
        })
    }
    #[cfg(any(mobile, test))]
    pub(crate) fn suspend_acquisitions(&self) {
        if let Ok(mut token) = self.acquisition.lock() {
            token.cancel();
            *token = tokio_util::sync::CancellationToken::new();
        }
        if let Ok(mut preview) = self.preview.lock() {
            *preview = None;
        }
    }
    #[cfg(feature = "s15-acceptance")]
    pub(crate) fn accepted(directory: PathBuf) -> Arc<Self> {
        let mut value = Self::new(directory);
        Arc::get_mut(&mut value).expect("new authority").admitted = true;
        value
    }
    fn policy(&self) -> am_plugin_runtime::InstallPolicy {
        target::policy(self.admitted)
    }
    fn with<T>(
        &self,
        action: impl FnOnce(&mut Authority) -> Result<T, Error>,
    ) -> Result<T, String> {
        let mut slot = self.authority.lock().map_err(|_| "插件权威不可用。")?;
        let authority = slot.get_or_insert_with(|| {
            std::fs::create_dir_all(self.path.parent().ok_or(Error::Storage)?)
                .map_err(|_| Error::Storage)?;
            PluginStore::open(&self.path).and_then(|store| {
                let mut files = package_files::PackageFiles::open(self.package_directory.clone())?;
                let mut runtime = Runtime::recover(store, NativeClock, NativeIds)?;
                runtime.recover_packages(&mut files)?;
                Ok(runtime)
            })
        });
        if matches!(authority, Err(Error::Conflict)) {
            *slot = None;
            return Err("另一个安装进程正在操作，请稍后重试。".into());
        }
        match authority {
            Ok(authority) => action(authority).map_err(|error| {
                match error {
                    Error::Budget => "插件预算已耗尽。",
                    Error::Denied => "插件权限或上下文已失效。",
                    Error::Unsupported => "插件能力或版本不可用。",
                    _ => "插件操作已拒绝；原生授权或数据版本不可用。",
                }
                .into()
            }),
            Err(_) => Err("插件数据库不可用，外置能力已关闭；原始数据已保留。".into()),
        }
    }
}

fn check_product(window: &str, webview: &str, origin: &str) -> Result<(), String> {
    let local = matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    );
    let dev = cfg!(debug_assertions) && origin == "http://127.0.0.1:21420";
    if window != "main" || webview != "main" || !(local || dev) {
        return Err("拒绝非产品调用方。".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn plugin_authority_snapshot(
    webview: tauri::Webview,
    state: tauri::State<'_, Arc<PluginAuthority>>,
    app: tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    let authority = state.inner().clone();
    let permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let mut result = control::snapshots(&authority, false)?;
        if let Some(dev) = app.state::<dev::DevSessions>().authority() {
            result.extend(control::snapshots(&dev, true)?);
        }
        Ok(result)
    })
    .await
    .map_err(|_| "插件操作不可用。")?
}

#[tauri::command]
pub(crate) async fn plugin_authority_revoke(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    install_id: String,
) -> Result<(), String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    if install_id.len() > 200 {
        return Err("安装标识无效。".into());
    }
    let (authority, install_id) = control::selected(&app, &install_id)?;
    app.state::<executor::Executors>().stop_install(&install_id);
    let permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        authority.with(|runtime| runtime.revoke(&install_id))?;
        // Durable epoch first; cancellation completes before acknowledging revocation.
        authority.cancel_network(&install_id);
        Ok(())
    })
    .await
    .map_err(|_| "插件操作不可用。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_and_recovers_an_independent_empty_authority_directory() {
        let root =
            std::env::temp_dir().join(format!("any-music-s15-unit-{}", uuid::Uuid::new_v4()));
        let authority = PluginAuthority::new(root.join("nested"));
        assert!(authority.with(|r| r.snapshot()).unwrap().is_empty());
        drop(authority);
        assert!(
            PluginAuthority::new(root.join("nested"))
                .with(|r| r.snapshot())
                .unwrap()
                .is_empty()
        );
        if root.parent() == Some(std::env::temp_dir().as_path())
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("any-music-s15-unit-")
        {
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn rejects_executor_remote_and_child_callers() {
        assert!(check_product("main", "main", "http://tauri.localhost").is_ok());
        for (window, view, origin) in [
            ("main", "executor", "http://tauri.localhost"),
            ("executor", "main", "http://tauri.localhost"),
            ("main", "main", "https://evil.invalid"),
            ("main", "main", "http://tauri.localhost.evil.invalid"),
        ] {
            assert!(check_product(window, view, origin).is_err());
        }
    }
}
