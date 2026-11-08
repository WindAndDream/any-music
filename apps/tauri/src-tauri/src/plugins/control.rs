//! Product-only installation decisions and bounded, redacted diagnostics. Executors have
//! no permission for these commands; output export always uses a fresh native save dialog.
use super::{PluginAuthority, dev::DevSessions, executor::Executors, package_files::PackageFiles};
use am_plugin_runtime::{InstallConsent, InstallFiles, Level};
use serde_json::{Value as Json, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub(crate) struct DeliveryState {
    diagnostics: Mutex<VecDeque<Json>>,
    outputs: Mutex<VecDeque<Output>>,
}
struct Output {
    token: String,
    authority: Arc<PluginAuthority>,
    install: String,
    epoch: u64,
    text: String,
}
pub(super) fn product(view: &tauri::Webview) -> Result<(), String> {
    super::check_product(
        view.window().label(),
        view.label(),
        &view
            .url()
            .map_err(|_| "调用来源不可用。")?
            .origin()
            .ascii_serialization(),
    )
}
pub(super) fn selected(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<(Arc<PluginAuthority>, String), String> {
    if let Some(id) = id.strip_prefix("dev:") {
        Ok((
            app.state::<DevSessions>()
                .authority()
                .ok_or("DEV 会话已结束。")?,
            id.into(),
        ))
    } else {
        Ok((
            app.state::<Arc<PluginAuthority>>().inner().clone(),
            id.into(),
        ))
    }
}
impl DeliveryState {
    pub(super) fn record(&self, plugin: &str, hash: &str, event: &str, success: bool) {
        if let Ok(mut log) = self.diagnostics.lock() {
            if log.len() >= 64 {
                log.pop_front();
            }
            log.push_back(json!({"callId":uuid::Uuid::new_v4().to_string(),"pluginId":plugin,"contentHash":hash,"event":event,"outcome":if success{"accepted"}else{"denied-or-budget"}}));
        }
    }
}
pub(super) fn snapshots(authority: &Arc<PluginAuthority>, dev: bool) -> Result<Vec<Json>, String> {
    let states = authority.with(|r| r.snapshot())?;
    let records = authority.with(|r| r.package_records())?;
    let mut files =
        PackageFiles::open(authority.package_directory.clone()).map_err(|_| "插件目录不可用。")?;
    states
        .into_iter()
        .map(|state| {
            let mut value = serde_json::to_value(&state).map_err(|_| "显示状态无效。")?;
            value["dev"] = json!(dev);
            if dev {
                value["installId"] = json!(format!("dev:{}", state.install_id));
            }
            if let Some(record) = records
                .iter()
                .find(|r| r.identity.install_id == state.install_id && r.installed)
            {
                let bytes = files
                    .verify_pair(record)
                    .map_err(|_| "插件文件校验失败。")?;
                let package =
                    am_plugin_package::verify(bytes, || false).map_err(|_| "插件文件校验失败。")?;
                value["commands"] = serde_json::to_value(&package.manifest().commands)
                    .map_err(|_| "命令元数据无效。")?;
                value["contributions"] = json!(
                    package
                        .manifest()
                        .contributions
                        .iter()
                        .map(|c| c.point_id.as_str())
                        .collect::<Vec<_>>()
                );
                value["canRollback"] = json!(record.rollback.is_some());
                if let Some(auth) = &package.manifest().source_authentication {
                    value["sourceAuthentication"] = json!(auth);
                    value["sourceName"] = json!(package.manifest().name.zh_cn);
                    #[cfg(desktop)]
                    {
                        value["sourceAuthenticationBinding"] = json!(
                            super::source_auth::configuration_binding(&state.install_id, &package)?
                        );
                    }
                }
            }
            Ok(value)
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn plugin_package_install(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    token: String,
    capabilities: Vec<String>,
    transfer_data: bool,
    user_linked_network: bool,
) -> Result<(), String> {
    product(&webview)?;
    if capabilities.len() > 32 || token.len() > 100 {
        return Err("确认数据无效。".into());
    }
    let dev = app.state::<DevSessions>().authority();
    let main = app.state::<Arc<PluginAuthority>>().inner().clone();
    let authority = if let Some(dev) = dev.filter(|d| {
        d.preview
            .lock()
            .ok()
            .is_some_and(|p| p.as_ref().is_some_and(|p| p.token == token))
    }) {
        dev
    } else {
        main
    };
    let consent = InstallConsent {
        capabilities: capabilities.into_iter().collect(),
        pin_publisher: false,
        transfer_data,
        read_ceiling: if user_linked_network {
            Level::L1
        } else {
            Level::L2
        },
        user_linked_network,
        private_network: false,
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || authority.commit_preview(&token, consent))
            .await
            .map_err(|_| "安装任务失败。")?;
    if let Ok(identity) = &result {
        app.state::<Executors>().stop_install(&identity.install_id);
    }
    result.map(|_| ())
}

#[tauri::command]
pub(crate) async fn plugin_package_rollback(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    install_id: String,
) -> Result<(), String> {
    product(&webview)?;
    #[cfg(mobile)]
    {
        let _ = (app, install_id);
        Err("当前目标不支持插件回退。".into())
    }
    #[cfg(desktop)]
    {
        let (authority, id) = selected(&app, &install_id)?;
        let stopped = id.clone();
        let confirmation_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let preview = authority.preview_rollback(&id)?;
            let candidate = preview.candidate();
            // The renderer selects an installation only. Native approval owns this exact,
            // non-serializable preview; no caller boolean or identifier authorizes commit.
            let message = format!(
                "将 {} 回退到版本 {}？\n\n插件将被停用，当前授权会被撤销，数据将恢复到该版本的快照。",
                candidate.plugin_id, candidate.version
            );
            let confirmed = confirmation_app
                .dialog()
                .message(message)
                .title("确认回退插件")
                .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
                .blocking_show();
            if !confirmed {
                return Ok(false);
            }
            authority.commit_rollback(preview, confirmed)?;
            authority.cancel_network(&id);
            Ok(true)
        })
        .await
        .map_err(|_| "回退任务失败。")?;
        if matches!(result, Ok(true)) {
            app.state::<Executors>().stop_install(&stopped);
        }
        result.map(|_| ())
    }
}

#[tauri::command]
pub(crate) async fn plugin_command_cancel(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    install_id: String,
) -> Result<(), String> {
    product(&webview)?;
    let (authority, id) = selected(&app, &install_id)?;
    #[cfg(desktop)]
    super::source_auth::cancel_contexts(&authority, &id)?;
    authority.cancel_network(&id);
    app.state::<Executors>().cancel_install(&id)
}

#[tauri::command]
pub(crate) async fn plugin_command_run(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    install_id: String,
    command: String,
    input_json: String,
    account_id: Option<String>,
    without_login: Option<bool>,
) -> Result<Json, String> {
    product(&webview)?;
    let (authority, id) = selected(&app, &install_id)?;
    let state = authority
        .with(|r| r.snapshot())?
        .into_iter()
        .find(|i| i.install_id == id)
        .ok_or("安装不存在。")?;
    #[cfg(desktop)]
    let gateway = if command == "search" {
        super::source_auth::search(
            &app,
            authority.clone(),
            &id,
            account_id.as_deref(),
            &input_json,
            without_login.unwrap_or(false),
        )
        .await?
    } else {
        None
    };
    #[cfg(mobile)]
    let gateway: Option<String> = {
        let _ = (account_id, without_login);
        None
    };
    let result = if let Some(output) = gateway {
        Ok(output)
    } else {
        super::executor::execute(
            app.clone(),
            authority.clone(),
            id.clone(),
            command,
            input_json,
        )
        .await
    };
    app.state::<DeliveryState>().record(
        &state.plugin_id,
        &state.content_hash,
        "command",
        result.is_ok(),
    );
    if let Err(error) = &result {
        let category = if error.contains("预算") || error.contains("截止") || error.contains("超时")
        {
            "budget"
        } else if error.contains("权限") || error.contains("上下文") || error.contains("撤权")
        {
            "permission-denied"
        } else {
            "runtime-unavailable"
        };
        app.state::<DeliveryState>()
            .record(&state.plugin_id, &state.content_hash, category, false);
    }
    let output = result?;
    let parsed = am_plugin_protocol::parse_json(output.as_bytes()).map_err(|_| "结果无效。")?;
    let token = uuid::Uuid::new_v4().to_string();
    let delivery = app.state::<DeliveryState>();
    let mut outputs = delivery.outputs.lock().map_err(|_| "结果不可用。")?;
    if outputs.len() >= 16 {
        outputs.pop_front();
    }
    let text = parsed
        .get("text")
        .and_then(Json::as_str)
        .unwrap_or(&output)
        .to_owned();
    outputs.push_back(Output {
        token: token.clone(),
        authority,
        install: id,
        epoch: state.permission_epoch,
        text,
    });
    Ok(json!({"token":token,"value":parsed}))
}

#[tauri::command]
pub(crate) async fn plugin_diagnostics(
    webview: tauri::Webview,
    state: tauri::State<'_, DeliveryState>,
) -> Result<Vec<Json>, String> {
    product(&webview)?;
    Ok(state
        .diagnostics
        .lock()
        .map_err(|_| "诊断不可用。")?
        .iter()
        .cloned()
        .collect())
}

#[tauri::command]
pub(crate) async fn plugin_diagnostics_export(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    product(&webview)?;
    let entries = app
        .state::<DeliveryState>()
        .diagnostics
        .lock()
        .map_err(|_| "诊断不可用。")?
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    let bytes = serde_json::to_vec_pretty(&entries).map_err(|_| "诊断不可用。")?;
    #[cfg(target_os = "android")]
    {
        let Some(token) =
            crate::system::android::prepare_save(&app, "any-music-plugin-diagnostics.json")
                .await?
                .token
        else {
            return Ok(false);
        };
        tauri::async_runtime::spawn_blocking(move || {
            crate::system::android::commit_save(&app, &token, &bytes).map(|_| true)
        })
        .await
        .map_err(|_| "诊断导出不可用。".to_owned())?
    }
    #[cfg(not(target_os = "android"))]
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name("any-music-plugin-diagnostics.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|_| "保存位置不可用。")?;
        std::fs::write(path, bytes).map_err(|_| "诊断保存失败。")?;
        Ok(true)
    })
    .await
    .map_err(|_| "诊断导出不可用。")?
}

#[tauri::command]
pub(crate) async fn plugin_result_save(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    token: String,
) -> Result<bool, String> {
    product(&webview)?;
    let state = app.state::<DeliveryState>();
    let output = {
        let mut outputs = state.outputs.lock().map_err(|_| "结果不可用。")?;
        let at = outputs
            .iter()
            .position(|o| o.token == token)
            .ok_or("结果已失效。")?;
        outputs.remove(at).ok_or("结果已失效。")?
    };
    #[cfg(target_os = "android")]
    let destination = crate::system::android::prepare_save(&app, "plugin-output.txt")
        .await?
        .token;
    #[cfg(not(target_os = "android"))]
    let destination = {
        let selector = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            selector
                .dialog()
                .file()
                .set_file_name("plugin-output.txt")
                .blocking_save_file()
        })
        .await
        .map_err(|_| "保存对话框不可用。")?
    };
    let Some(destination) = destination else {
        return Ok(false);
    };
    #[cfg(not(target_os = "android"))]
    let path = destination.into_path().map_err(|_| "保存位置不可用。")?;
    // Recheck epoch after the user dialog. The authority lock serializes the final save with
    // revocation; no path/text supplied by an executor or renderer becomes a save request.
    tauri::async_runtime::spawn_blocking(move || {
        output.authority.with(|runtime| {
            let current = runtime
                .snapshot()?
                .into_iter()
                .find(|s| s.install_id == output.install)
                .ok_or(am_plugin_runtime::Error::Denied)?;
            if !current.enabled || current.permission_epoch != output.epoch {
                return Err(am_plugin_runtime::Error::Denied);
            }
            #[cfg(not(target_os = "android"))]
            std::fs::write(path, output.text.as_bytes())
                .map_err(|_| am_plugin_runtime::Error::Storage)?;
            #[cfg(target_os = "android")]
            crate::system::android::commit_save(&app, &destination, output.text.as_bytes())
                .map_err(|_| am_plugin_runtime::Error::Storage)?;
            Ok(true)
        })
    })
    .await
    .map_err(|_| "保存任务失败。")?
}
