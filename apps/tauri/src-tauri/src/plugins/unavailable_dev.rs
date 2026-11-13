//! Mobile builds expose no directory DEV transport or pairing identity.
use super::PluginAuthority;
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct DevSessions {
    _closed: (),
}
impl DevSessions {
    pub(crate) fn authority(&self) -> Option<Arc<PluginAuthority>> {
        None
    }
    pub(crate) fn stop(&self) {}
}
#[tauri::command]
pub(crate) fn plugin_dev_begin() -> Result<(), String> {
    Err("runtime-unavailable:移动运行端不支持目录 DEV 会话。".into())
}
#[tauri::command]
pub(crate) fn plugin_dev_end() -> Result<(), String> {
    Err("runtime-unavailable:移动运行端不支持目录 DEV 会话。".into())
}
