//! Main-WebView cache preferences; filesystem selection never becomes renderer write authority.
use super::resource_cache::CacheSnapshot;
use crate::{browser::verification::require_main, state::RuntimeState};
use tauri::{State, WebviewWindow};

#[tauri::command]
pub async fn resource_cache_snapshot(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<CacheSnapshot, String> {
    require_main(&window)?;
    state.resource_cache.snapshot().await
}
#[tauri::command]
pub async fn resource_cache_configure(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    capacity_bytes: Option<u64>,
    memory_capacity_bytes: Option<u64>,
) -> Result<CacheSnapshot, String> {
    require_main(&window)?;
    match (capacity_bytes, memory_capacity_bytes) {
        (Some(capacity), None) => state.resource_cache.configure(capacity).await,
        (None, Some(capacity)) => state.resource_cache.configure_memory(capacity).await,
        _ => Err("invalid-input:请单独设置硬盘或内存缓存上限。".into()),
    }
}
#[tauri::command]
pub async fn resource_cache_clear(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<CacheSnapshot, String> {
    require_main(&window)?;
    state.resource_cache.clear().await
}
#[tauri::command]
pub async fn resource_cache_directory(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    reset: bool,
) -> Result<Option<CacheSnapshot>, String> {
    require_main(&window)?;
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        // Reuse the native picker admission; concurrent settings cannot open multiple dialogs.
        let _picker = state
            .downloads
            .picker
            .try_lock()
            .map_err(|_| "目录选择窗口已打开。")?;
        let parent = if reset {
            None
        } else {
            let selected = tauri::async_runtime::spawn_blocking(move || {
                window
                    .dialog()
                    .file()
                    .set_title("选择缓存目录（将创建 AnyMusicCache 子目录）")
                    .blocking_pick_folder()
            })
            .await
            .map_err(|_| "目录选择窗口异常。")?;
            let Some(selected) = selected else {
                return Ok(None);
            };
            let path = selected.into_path().map_err(|_| "所选缓存目录不可用。")?;
            Some(std::fs::canonicalize(path).map_err(|_| "所选缓存目录不可用。")?)
        };
        state.resource_cache.set_directory(parent).await.map(Some)
    }
    #[cfg(mobile)]
    {
        let _ = (state, reset);
        Err("unsupported-operation:手机缓存由系统管理，使用应用专属目录。".into())
    }
}
