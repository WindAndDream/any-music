//! Private Kotlin/Android adapters. No generic plugin JS command handler, URI, key or
//! native path is exported to the renderer; OS input is copied before package validation.
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{
    Manager,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

pub(crate) struct AndroidPlatform(PluginHandle<tauri::Wry>);
pub(crate) async fn download_directory(
    app: &tauri::AppHandle,
    command: &str,
) -> Result<super::download_directory::DownloadDirectory, String> {
    app.state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async(command, ())
        .await
        .map_err(|_| "下载目录设置不可用，请重新选择目录。".into())
}
impl AndroidPlatform {
    pub(crate) async fn download_directory_choice(
        &self,
    ) -> Result<Option<super::download_directory::DownloadDirectory>, String> {
        #[derive(Deserialize)]
        struct Choice {
            selected: bool,
            directory: Option<String>,
        }
        let choice: Choice = self
            .0
            .run_mobile_plugin_async("chooseDownloadDirectory", ())
            .await
            .map_err(|_| "无法保存下载目录，请重新选择可写入的文件夹。")?;
        Ok(choice
            .selected
            .then_some(super::download_directory::DownloadDirectory {
                directory: choice.directory,
            }))
    }
}
pub(crate) async fn open_bilibili_login(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    app.state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async::<serde_json::Value>(
            "openBilibiliLogin",
            serde_json::json!({"url": url}),
        )
        .await
        .map(|_| ())
        .map_err(|error| {
            let code = match &error {
                tauri::plugin::mobile::PluginInvokeError::InvokeRejected(response) => {
                    response.code.as_deref()
                }
                _ => None,
            };
            match code {
                Some("invalid_handoff") => "哔哩哔哩授权地址无效，请重新生成二维码。",
                Some("app_unavailable") => "无法打开哔哩哔哩应用，请确认已安装后重试。",
                _ => "哔哩哔哩应用唤起失败，请重试并检查系统是否允许应用间跳转。",
            }
            .into()
        })
}
pub(crate) fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("mobile-platform")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.anymusic.app", "MobilePlatformPlugin")?;
            app.manage(AndroidPlatform(handle));
            Ok(())
        })
        .build()
}
#[derive(Deserialize)]
struct CredentialKey {
    key: String,
}
pub(crate) fn key_loader(app: &tauri::AppHandle) -> crate::state::CredentialKeyLoader {
    let handle = app.state::<AndroidPlatform>().0.clone();
    Arc::new(move || {
        let value: CredentialKey = handle
            .run_mobile_plugin("credentialKey", ())
            .map_err(|_| "系统凭证密钥不可用。")?;
        STANDARD
            .decode(value.key)
            .map_err(|_| "系统凭证密钥无效。")?
            .try_into()
            .map_err(|_| "系统凭证密钥长度无效。".into())
    })
}
#[derive(Deserialize)]
struct Picked {
    id: Option<String>,
}
pub(crate) async fn pick_package(app: &tauri::AppHandle) -> Result<Option<Vec<u8>>, String> {
    let picked: Picked = app
        .state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async("pickPackage", ())
        .await
        .map_err(|_| "系统文件选择已取消或不可用。")?;
    picked.id.map(|id| read_package(app, &id)).transpose()
}
fn read_package(app: &tauri::AppHandle, id: &str) -> Result<Vec<u8>, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| "暂存标识无效。")?;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "暂存目录不可用。")?
        .join("mobile-inbox")
        .join(format!("{id}.amplugin"));
    let result = crate::plugins::delivery::read_local(&path);
    let _ = std::fs::remove_file(path);
    result
}
#[derive(Deserialize)]
struct Incoming {
    kind: Option<String>,
    value: Option<String>,
}
pub(crate) async fn incoming(app: &tauri::AppHandle) -> Result<Option<MobileInput>, String> {
    let item: Incoming = app
        .state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async("drainPackage", ())
        .await
        .map_err(|_| "系统包入口不可用。")?;
    match (item.kind.as_deref(), item.value) {
        (None, _) => Ok(None),
        (Some("file"), Some(id)) => {
            read_package(app, &id).map(|bytes| Some(MobileInput::Bytes(bytes)))
        }
        (Some("url"), Some(url)) => Ok(Some(MobileInput::Url(url))),
        _ => Err("系统插件包不可用、已取消或超出预算。".into()),
    }
}
pub(crate) enum MobileInput {
    Bytes(Vec<u8>),
    Url(String),
}
#[derive(Deserialize)]
pub(crate) struct SaveDestination {
    pub token: Option<String>,
}
pub(crate) async fn prepare_save(
    app: &tauri::AppHandle,
    file_name: &str,
) -> Result<SaveDestination, String> {
    app.state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async("prepareSave", serde_json::json!({"fileName":file_name}))
        .await
        .map_err(|_| "系统保存对话框不可用。".into())
}
pub(crate) async fn prepare_download(
    app: &tauri::AppHandle,
    file_name: &str,
) -> Result<SaveDestination, String> {
    app.state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async("prepareDownload", serde_json::json!({"fileName":file_name}))
        .await
        .map_err(|_| "下载目录不可用，请在设置中重新选择目录，或恢复每次询问。".into())
}
pub(crate) async fn verify_download(
    app: &tauri::AppHandle,
    file_name: &str,
    size_bytes: u64,
    sha256: &str,
) -> Result<bool, String> {
    #[derive(Deserialize)]
    struct Verification {
        matches: bool,
    }
    let result: Verification = app
        .state::<AndroidPlatform>()
        .0
        .run_mobile_plugin_async(
            "verifyDownload",
            serde_json::json!({
                "fileName": file_name, "sizeBytes": size_bytes, "sha256": sha256,
            }),
        )
        .await
        .map_err(|_| "下载文件校验失败，请检查下载目录权限。".to_owned())?;
    Ok(result.matches)
}
pub(crate) fn commit_save(app: &tauri::AppHandle, token: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("移动保存超过 32 MiB 预算。".into());
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "保存暂存不可用。")?
        .join("mobile-outbox");
    std::fs::create_dir_all(&directory).map_err(|_| "保存暂存不可用。")?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = directory.join(&id);
    crate::storage::vault::write_atomic(&path, bytes)?;
    let result = app
        .state::<AndroidPlatform>()
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "commitSave",
            serde_json::json!({"token":token,"id":id}),
        )
        .map(|_| ())
        .map_err(|_| "系统保存已取消或失败。".into());
    let _ = std::fs::remove_file(path);
    result
}
