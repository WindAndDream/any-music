//! Download preferences stay native; the renderer receives display text, never write authority.
use crate::{browser::verification::require_main, state::RuntimeState};
use serde::Serialize;
#[cfg(desktop)]
use std::{path::PathBuf, sync::Mutex};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{State, WebviewWindow};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub(crate) struct DownloadPreferences {
    pub picker: tokio::sync::Mutex<()>,
    #[cfg(desktop)]
    directory: Mutex<()>,
}

#[derive(Serialize, serde::Deserialize)]
pub(crate) struct DownloadDirectory {
    pub directory: Option<String>,
}

#[cfg(desktop)]
fn directory_label(path: &std::path::Path) -> String {
    let display = path.to_string_lossy();
    // canonicalize uses Windows extended paths; keep that prefix native-only.
    if cfg!(windows) {
        if let Some(unc) = display.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(disk) = display.strip_prefix(r"\\?\") {
            return disk.into();
        }
    }
    display.into_owned()
}

#[cfg(desktop)]
impl DownloadPreferences {
    pub fn load(&self, state_directory: &std::path::Path) -> Result<Option<PathBuf>, String> {
        let _guard = self.directory.lock().unwrap();
        let path = state_directory.join("download-directory.json");
        crate::storage::vault::recover_atomic(&path)?;
        if !path.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(path).map_err(|_| "无法读取下载目录设置。")?;
        let directory: Option<PathBuf> =
            serde_json::from_slice(&bytes).map_err(|_| "下载目录设置损坏，请重新选择目录。")?;
        if directory.as_ref().is_some_and(|path| !path.is_absolute()) {
            return Err("下载目录设置无效，请重新选择目录。".into());
        }
        Ok(directory)
    }

    fn save(
        &self,
        state_directory: &std::path::Path,
        directory: Option<&std::path::Path>,
    ) -> Result<DownloadDirectory, String> {
        let _guard = self.directory.lock().unwrap();
        crate::storage::vault::write_atomic(
            &state_directory.join("download-directory.json"),
            &serde_json::to_vec(&directory).map_err(|_| "下载目录设置序列化失败。")?,
        )?;
        Ok(DownloadDirectory {
            directory: directory.map(directory_label),
        })
    }
}

#[tauri::command]
pub(crate) async fn get_download_directory(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<DownloadDirectory, String> {
    require_main(&window)?;
    let _ = &state;
    #[cfg(desktop)]
    {
        Ok(DownloadDirectory {
            directory: state
                .downloads
                .load(&state.directory)?
                .map(|path| directory_label(&path)),
        })
    }
    #[cfg(target_os = "android")]
    {
        super::android::download_directory(window.app_handle(), "getDownloadDirectory").await
    }
    #[cfg(target_os = "ios")]
    Err("此运行端暂不支持下载目录选择。".into())
}

#[tauri::command]
pub(crate) async fn choose_download_directory(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<Option<DownloadDirectory>, String> {
    require_main(&window)?;
    let _guard = state
        .downloads
        .picker
        .try_lock()
        .map_err(|_| "目录选择窗口已打开。")?;
    #[cfg(desktop)]
    {
        let path = tauri::async_runtime::spawn_blocking(move || {
            window
                .dialog()
                .file()
                .set_title("选择下载保存目录")
                .blocking_pick_folder()
        })
        .await
        .map_err(|_| "目录选择窗口异常。")?;
        let Some(path) = path else { return Ok(None) };
        let path = path.into_path().map_err(|_| "此平台不支持当前下载目录。")?;
        let path = std::fs::canonicalize(path).map_err(|_| "所选下载目录不可用。")?;
        if !path.is_dir() {
            return Err("请选择文件夹作为下载目录。".into());
        }
        state
            .downloads
            .save(&state.directory, Some(&path))
            .map(Some)
    }
    #[cfg(target_os = "android")]
    {
        window
            .app_handle()
            .state::<super::android::AndroidPlatform>()
            .download_directory_choice()
            .await
    }
    #[cfg(target_os = "ios")]
    Err("此运行端暂不支持下载目录选择。".into())
}

#[tauri::command]
pub(crate) async fn reset_download_directory(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<DownloadDirectory, String> {
    require_main(&window)?;
    let _guard = state
        .downloads
        .picker
        .try_lock()
        .map_err(|_| "请先关闭目录选择窗口。")?;
    #[cfg(desktop)]
    {
        state.downloads.save(&state.directory, None)
    }
    #[cfg(target_os = "android")]
    {
        super::android::download_directory(window.app_handle(), "resetDownloadDirectory").await
    }
    #[cfg(target_os = "ios")]
    Err("此运行端暂不支持下载目录选择。".into())
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn preferences_restart_reset_and_failed_write_preserve_native_ownership() {
        let root = std::env::temp_dir().join(format!("am-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let preferences = DownloadPreferences::default();
        assert_eq!(preferences.load(&root).unwrap(), None);
        preferences.save(&root, Some(&root)).unwrap();
        assert_eq!(
            DownloadPreferences::default().load(&root).unwrap(),
            Some(root.clone())
        );
        assert!(preferences.save(&root.join("missing"), None).is_err());
        assert_eq!(preferences.load(&root).unwrap(), Some(root.clone()));
        preferences.save(&root, None).unwrap();
        assert_eq!(preferences.load(&root).unwrap(), None);
        std::fs::write(root.join("download-directory.json"), b"\"relative\"").unwrap();
        assert!(preferences.load(&root).is_err());
        preferences.save(&root, None).unwrap();
        assert_eq!(preferences.load(&root).unwrap(), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
