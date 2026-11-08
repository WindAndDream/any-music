//! Mobile external authentication remains unavailable with external execution policy `none`.
#[tauri::command]
pub(crate) fn source_account_platforms() -> Vec<serde_json::Value> {
    vec![]
}
#[tauri::command]
pub(crate) fn source_account_auth() -> Result<(), String> {
    Err("此运行端不支持外置音乐源登录。".into())
}
