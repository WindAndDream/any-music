//! Closed mobile executor adapter. No guest bytes, resources, Worker or extra WebView
//! are assembled before a mobile system/channel passes its independent acceptance.
use super::PluginAuthority;
use std::sync::Arc;

#[derive(Default)]
pub(crate) struct Executors {
    _closed: (),
}
impl Executors {
    pub(super) fn cancel_install(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    pub(crate) fn stop_install(&self, _: &str) {}
    pub(crate) fn stop_all(&self) {}
}
pub(crate) async fn execute(
    _: tauri::AppHandle,
    _: Arc<PluginAuthority>,
    _: String,
    _: String,
    _: String,
) -> Result<String, String> {
    Err("runtime-unavailable:此移动系统及渠道尚未通过插件执行验收。".into())
}
#[tauri::command]
pub(crate) fn plugin_executor_relay() -> Result<(), String> {
    Err("runtime-unavailable:此移动运行端没有插件执行通道。".into())
}
