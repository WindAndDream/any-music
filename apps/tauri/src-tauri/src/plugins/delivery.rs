//! Host-initiated package acquisition is distinct from plugin networking. All sources finish
//! in the same immutable verifier/preview, with no credentials, grants or implicit activation.
use super::{PluginAuthority, packages::PreviewSnapshot};
use am_plugin_net::{Error, Exit, Gate, Network, Request, Scope};
use std::{
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;

struct Acquisition {
    requests: AtomicU64,
    bytes: AtomicU64,
    cancel: CancellationToken,
}
impl Gate for Acquisition {
    fn scope(&self) -> Scope {
        Scope::Public
    }
    fn check(&self, exit: Exit) -> Result<(), Error> {
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if exit != Exit::Download {
            return Err(Error::Denied);
        }
        Ok(())
    }
    fn charge(&self, requests: u64, bytes: u64) -> Result<(), Error> {
        if self
            .requests
            .fetch_add(requests, Ordering::SeqCst)
            .saturating_add(requests)
            > 6
            || self
                .bytes
                .fetch_add(bytes, Ordering::SeqCst)
                .saturating_add(bytes)
                > am_plugin_package::MAX_ARCHIVE_BYTES as u64
        {
            return Err(Error::Budget);
        }
        Ok(())
    }
    fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
}
pub(crate) fn read_local(path: &Path) -> Result<Vec<u8>, String> {
    if path
        .extension()
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("amplugin"))
    {
        return Err("请选择 .amplugin 文件。".into());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "无法读取所选文件。")?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > am_plugin_package::MAX_ARCHIVE_BYTES as u64
    {
        return Err("所选文件不是有界的普通插件包。".into());
    }
    let mut bytes = vec![];
    std::fs::File::open(path)
        .map_err(|_| "无法读取所选文件。")?
        .take(am_plugin_package::MAX_ARCHIVE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取所选文件。")?;
    if bytes.len() > am_plugin_package::MAX_ARCHIVE_BYTES {
        return Err("插件包超过预算。".into());
    }
    Ok(bytes)
}
fn check(webview: &tauri::Webview) -> Result<(), String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )
}
/// File associations and native drag/drop carry OS-selected paths. They only stage one
/// snapshot; the main view can recover it after listener registration via current_preview.
#[cfg(desktop)]
pub(crate) fn preview_selected_paths(app: &tauri::AppHandle, paths: &[std::path::PathBuf]) {
    if paths.len() != 1
        || paths[0]
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("amplugin"))
    {
        return;
    }
    let authority = app.state::<Arc<PluginAuthority>>().inner().clone();
    let Ok(permit) = authority.capacity.clone().try_acquire_owned() else {
        return;
    };
    let path = paths[0].clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        if let Ok(bytes) = read_local(&path)
            && let Ok(preview) = authority.preview_package(bytes)
        {
            let _ = app.emit_to("main", "any-music:plugin-package-preview", preview);
        }
    });
}
#[tauri::command]
pub(crate) async fn plugin_package_pick_preview(
    webview: tauri::Webview,
    state: tauri::State<'_, Arc<PluginAuthority>>,
) -> Result<Option<PreviewSnapshot>, String> {
    check(&webview)?;
    let authority = state.inner().clone();
    let permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    let app = webview.app_handle().clone();
    #[cfg(target_os = "android")]
    {
        let _permit = permit;
        let Some(bytes) = crate::system::android::pick_package(&app).await? else {
            return Ok(None);
        };
        tauri::async_runtime::spawn_blocking(move || authority.preview_package(bytes).map(Some))
            .await
            .map_err(|_| "插件包预览不可用。".to_owned())?
    }
    #[cfg(not(target_os = "android"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let Some(path) = app
                .dialog()
                .file()
                .add_filter("Any Music plugin", &["amplugin"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            let path = path.into_path().map_err(|_| "此平台不支持当前文件入口。")?;
            authority.preview_package(read_local(&path)?).map(Some)
        })
        .await
        .map_err(|_| "插件包预览不可用。")?
    }
}
#[tauri::command]
pub(crate) async fn plugin_package_url_preview(
    webview: tauri::Webview,
    state: tauri::State<'_, Arc<PluginAuthority>>,
    url: String,
) -> Result<PreviewSnapshot, String> {
    check(&webview)?;
    let authority = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || acquire_url(&authority, &url))
        .await
        .map_err(|_| "包获取任务失败。")?
}

fn package_url(input: &str) -> Result<String, String> {
    if input.len() > 8192 {
        return Err("链接超过预算。".into());
    }
    let parsed = reqwest::Url::parse(input).map_err(|_| "插件链接无效。")?;
    let url = if parsed.scheme() == "anymusic" {
        let pairs: Vec<_> = parsed.query_pairs().collect();
        if parsed.host_str() != Some("plugins")
            || parsed.path() != "/install"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
            || parsed.fragment().is_some()
            || pairs.len() != 1
            || pairs[0].0 != "url"
        {
            return Err("插件深链无效。".into());
        }
        pairs[0].1.to_string()
    } else {
        input.into()
    };
    am_plugin_net::Target::parse(&url, &Scope::Public)
        .map_err(|_| "仅支持无凭证的公共 HTTPS 包地址。")?;
    Ok(url)
}
pub(super) fn acquire_url(
    authority: &Arc<PluginAuthority>,
    input: &str,
) -> Result<PreviewSnapshot, String> {
    let url = package_url(input)?;
    let _permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    let gate = Acquisition {
        requests: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        cancel: authority
            .acquisition
            .lock()
            .map_err(|_| "包获取不可用。")?
            .child_token(),
    };
    let mut bytes = vec![];
    let mut request = Request::get(url, Exit::Download);
    request.max_bytes = am_plugin_package::MAX_ARCHIVE_BYTES;
    let response =
        tauri::async_runtime::block_on(Network::default().execute(&gate, request, &mut bytes))
            .map_err(|_| "匿名包下载失败、被目标策略拒绝或超过预算。")?;
    if response.status != 200 {
        return Err("包下载未返回完整内容。".into());
    }
    authority.preview_package_cancellable(bytes, &gate.cancel)
}
/// OS links and the product URL form use the same public-only acquisition and inert preview.
#[cfg(desktop)]
pub(crate) fn preview_links(app: &tauri::AppHandle, links: &[String]) {
    if links.len() != 1 || package_url(&links[0]).is_err() {
        return;
    }
    let app = app.clone();
    let input = links[0].clone();
    let authority = app.state::<Arc<PluginAuthority>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = acquire_url(&authority, &input);
        app.state::<super::control::DeliveryState>()
            .record("", "", "link-preview", result.is_ok());
        if let Ok(preview) = result {
            let _ = app.emit_to("main", "any-music:plugin-package-preview", preview);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn acquisition_has_no_plugin_credentials_or_other_exits() {
        let gate = Acquisition {
            requests: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            cancel: CancellationToken::new(),
        };
        assert!(gate.check(Exit::Download).is_ok());
        assert!(gate.check(Exit::Sandbox).is_err());
        assert!(
            gate.charge(6, am_plugin_package::MAX_ARCHIVE_BYTES as u64)
                .is_ok()
        );
        assert!(gate.charge(1, 0).is_err());
        gate.cancel.cancel();
        assert!(gate.check(Exit::Download).is_err());
        for url in [
            "file:///secret",
            "http://example.com/a",
            "https://127.0.0.1/a",
            "https://name:secret@example.com/a",
        ] {
            assert!(am_plugin_net::Target::parse(url, &Scope::Public).is_err());
        }
    }
    #[test]
    fn local_acquisition_rejects_non_packages_without_reading() {
        assert!(read_local(Path::new("secret.pem")).is_err());
    }
}
