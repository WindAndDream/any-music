//! Immutable host preview and verified installation orchestration. Native consent and exact
//! S15 target admission gate activation; no renderer-provided Candidate becomes authority.
use super::{PluginAuthority, package_files::PackageFiles};
use am_plugin_package::VerifiedPackage;
use am_plugin_runtime::{Candidate, InstallPreview};
use serde::Serialize;
use tauri::Manager;

pub(super) struct PreviewSession {
    pub token: String,
    pub package: VerifiedPackage,
    pub preview: InstallPreview,
    pub display: PreviewSnapshot,
}

pub(super) fn candidate(package: &VerifiedPackage) -> Candidate {
    candidate_from_manifest(package.manifest(), package.content_hash(), package.signer())
}
fn candidate_from_manifest(
    m: &am_plugin_protocol::PluginManifest,
    content_hash: &str,
    signer: Option<&str>,
) -> Candidate {
    let semver = |s: &str| -> Option<Vec<u32>> {
        // Match policy::negotiate's canonical SDK version syntax in this pre-admission preview.
        if s.split('.').any(|part| {
            part.is_empty()
                || part.len() > 6
                || !part.bytes().all(|b| b.is_ascii_digit())
                || part.len() > 1 && part.starts_with('0')
        }) {
            return None;
        }
        let v: Vec<u32> = s
            .split('.')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        (v.len() == 3).then_some(v)
    };
    let compatible = semver(&m.sdk.minimum)
        .zip(semver(&m.sdk.maximum_exclusive))
        .is_some_and(|(a, b)| a <= vec![0, 1, 0] && vec![0, 1, 0] < b)
        && m.forms
            .iter()
            .any(|f| f.as_str() == if cfg!(mobile) { "mobile" } else { "desktop" })
        && m.wire_versions.contains(&1)
        && m.runtime_profile_version == 1
        && m.contribution_version == 1
        && m.data_schema_version == 1
        && m.memory_class.as_str() == "minimum"
        && m.capabilities
            .iter()
            .filter(|c| c.required)
            .all(|c| c.version == 1)
        && m.contributions.iter().all(|c| {
            !c.required
                || c.contract_version == 1
                    && c.point_id.as_str() == "music.sources"
                    && c.provider_id.as_deref() == Some(m.id.as_str())
                    && m.commands.iter().any(|cmd| cmd.id == "search")
        });
    Candidate {
        plugin_id: m.id.clone(),
        version: m.version.clone(),
        package_hash: content_hash.into(),
        signer: signer.map(str::to_owned),
        execution: m.execution.as_str().into(),
        data_schema: m.data_schema_version as u64,
        capabilities: m
            .capabilities
            .iter()
            .filter(|c| c.version == 1 || c.required)
            .map(|c| c.id.clone())
            .collect(),
        required_capabilities: m
            .capabilities
            .iter()
            .filter(|c| c.required)
            .map(|c| c.id.clone())
            .collect(),
        compatible,
    }
}
fn catalog_supported(package: &VerifiedPackage) -> bool {
    if package.manifest().source_authentication.is_some() {
        return true;
    }
    let Some(raw) = package.payload("assets/source.json") else {
        return false;
    };
    let Ok(value) = am_plugin_protocol::parse_json(raw) else {
        return false;
    };
    value.as_object().is_some_and(|o| o.len() == 2)
        && value["schemaVersion"] == 1
        && value["items"].as_array().is_some_and(|items| {
            items.len() <= 100
                && items.iter().all(|item| {
                    item["source"]["pluginId"] == package.manifest().id
                        && serde_json::to_vec(item).ok().is_some_and(|v| {
                            am_plugin_protocol::decode_value("WireTrack", &v).is_ok()
                        })
                })
        })
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSnapshot {
    pub token: String,
    plugin_id: String,
    version: String,
    content_hash: String,
    publisher: Option<String>,
    publisher_verified: bool,
    execution: String,
    permissions: Vec<String>,
    added_permissions: Vec<String>,
    historical_level: String,
    can_install: bool,
    blocked_reason: String,
    pub dev: bool,
    contributions: Vec<String>,
}
impl PluginAuthority {
    pub(super) fn preview_package(&self, bytes: Vec<u8>) -> Result<PreviewSnapshot, String> {
        let cancel = self
            .acquisition
            .lock()
            .map_err(|_| "包获取不可用。")?
            .child_token();
        self.preview_package_cancellable(bytes, &cancel)
    }
    pub(super) fn preview_package_cancellable(
        &self,
        bytes: Vec<u8>,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<PreviewSnapshot, String> {
        if cancel.is_cancelled() {
            return Err("包获取已取消。".into());
        }
        self.with(|_| Ok(()))?;
        let mut files = PackageFiles::open(self.package_directory.clone())
            .map_err(|_| "安装目录繁忙或不可用。")?;
        let package = files
            .stage(bytes, || cancel.is_cancelled())
            .map_err(|error| {
                if error == am_plugin_runtime::Error::Unsupported {
                    "宿主版本不兼容。"
                } else {
                    "插件包损坏、超出预算或包含不允许的内容。"
                }
            })?;
        let metadata = candidate(&package);
        let preview = self.with(|runtime| {
            let mut policy = self.policy();
            // Only the versioned static catalog has a desktop declarative interpreter.
            if metadata.execution == "declarative" && !catalog_supported(&package) {
                policy.declarative = false;
            }
            runtime.preview_install(metadata.clone(), &policy)
        })?;
        self.with(|runtime| runtime.gc_packages(&mut files))?;
        let token = uuid::Uuid::new_v4().to_string();
        let snapshot = PreviewSnapshot {
            dev: self.dev,
            contributions: package
                .manifest()
                .contributions
                .iter()
                .map(|c| c.point_id.as_str().to_owned())
                .collect(),
            token: token.clone(),
            plugin_id: metadata.plugin_id,
            version: metadata.version,
            content_hash: metadata.package_hash,
            publisher: metadata.signer,
            publisher_verified: preview.publisher_verified(),
            execution: metadata.execution,
            permissions: metadata.capabilities,
            added_permissions: preview.added_permissions(),
            historical_level: format!("{:?}", preview.historical_level()),
            can_install: preview.can_install(),
            blocked_reason: if preview.can_install() {
                "校验通过；请在宿主确认所选能力与数据范围。"
            } else if !metadata.compatible {
                "宿主版本、必需贡献或能力不兼容。"
            } else if package.manifest().execution.as_str() == "sandbox-code" {
                "当前生产 Profile 尚未通过目标准入，代码插件不可安装或启用。"
            } else {
                "此声明式格式或目标尚无已验收的宿主解释器；当前保留预览和归档。"
            }
            .into(),
        };
        *self.preview_result.lock().map_err(|_| "预览不可用。")? = None;
        let mut pending = self.preview.lock().map_err(|_| "预览不可用。")?;
        if cancel.is_cancelled() {
            return Err("包获取已取消。".into());
        }
        *pending = Some(PreviewSession {
            token,
            package,
            preview,
            display: snapshot.clone(),
        });
        Ok(snapshot)
    }
    /// Keep the same opaque snapshot when installation is admitted. No renderer Candidate,
    /// trust-root/grant setter or raw package path is accepted by this native operation.
    pub(super) fn commit_preview(
        &self,
        token: &str,
        consent: am_plugin_runtime::InstallConsent,
    ) -> Result<am_plugin_runtime::Identity, String> {
        let session = {
            let mut pending = self.preview.lock().map_err(|_| "预览不可用。")?;
            if pending.as_ref().is_none_or(|s| s.token != token) {
                return Err("预览已失效。".into());
            }
            pending.take().ok_or("预览已失效。")?
        };
        let result = (|| {
            let mut files = PackageFiles::open(self.package_directory.clone())
                .map_err(|_| "安装目录不可用。")?;
            files.use_snapshot(session.package);
            self.with(|runtime| {
                runtime.install_package(
                    session.preview,
                    consent,
                    &self.policy(),
                    &mut files,
                    am_plugin_runtime::DataMigration::Copy,
                    || self.stopped.load(std::sync::atomic::Ordering::SeqCst),
                )
            })
        })();
        // Consuming the preview begins a transaction; it is not a rejection. DEV waits for
        // this explicit terminal decision rather than racing the durable install commit.
        *self.preview_result.lock().map_err(|_| "预览不可用。")? =
            Some((token.into(), result.is_ok()));
        result
    }

    #[cfg(any(desktop, test))]
    pub(super) fn preview_rollback(
        &self,
        id: &str,
    ) -> Result<am_plugin_runtime::RollbackPreview, String> {
        if self.stopped.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("插件会话已结束。".into());
        }
        self.with(|_| Ok(()))?;
        let mut files =
            PackageFiles::open(self.package_directory.clone()).map_err(|_| "安装目录不可用。")?;
        self.with(|runtime| runtime.preview_rollback(id, &self.policy(), &mut files))
    }

    #[cfg(any(desktop, test))]
    pub(super) fn commit_rollback(
        &self,
        preview: am_plugin_runtime::RollbackPreview,
        confirmed: bool,
    ) -> Result<(), String> {
        if !confirmed || self.stopped.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("回退未确认或会话已结束。".into());
        }
        let mut files =
            PackageFiles::open(self.package_directory.clone()).map_err(|_| "安装目录不可用。")?;
        self.with(|runtime| {
            runtime.rollback_package(preview, &self.policy(), &mut files, || {
                self.stopped.load(std::sync::atomic::Ordering::SeqCst)
            })
        })
    }
}

#[tauri::command]
pub(crate) async fn plugin_package_discard_preview(
    webview: tauri::Webview,
    state: tauri::State<'_, std::sync::Arc<PluginAuthority>>,
    app: tauri::AppHandle,
    token: String,
) -> Result<(), String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    if token.len() > 200 {
        return Err("预览标识无效。".into());
    }
    let authority = app
        .state::<super::dev::DevSessions>()
        .authority()
        .filter(|d| {
            d.preview
                .lock()
                .ok()
                .is_some_and(|s| s.as_ref().is_some_and(|s| s.token == token))
        })
        .unwrap_or_else(|| state.inner().clone());
    let permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        {
            let mut slot = authority.preview.lock().map_err(|_| "预览不可用。")?;
            if slot.as_ref().is_some_and(|s| s.token == token) {
                slot.take();
                *authority
                    .preview_result
                    .lock()
                    .map_err(|_| "预览不可用。")? = Some((token.clone(), false));
            } else {
                return Ok(());
            }
        }
        let mut files = PackageFiles::open(authority.package_directory.clone())
            .map_err(|_| "安装目录不可用。")?;
        authority.with(|runtime| runtime.gc_packages(&mut files))
    })
    .await
    .map_err(|_| "预览不可用。")?
}

#[tauri::command]
pub(crate) async fn plugin_package_preview(
    webview: tauri::Webview,
    state: tauri::State<'_, std::sync::Arc<PluginAuthority>>,
    bytes: Vec<u8>,
) -> Result<PreviewSnapshot, String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    if bytes.len() > am_plugin_package::MAX_ARCHIVE_BYTES {
        return Err("插件包超过 16 MiB。".into());
    }
    let authority = state.inner().clone();
    let permit = authority
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件操作繁忙。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        authority.preview_package(bytes)
    })
    .await
    .map_err(|_| "预览不可用。")?
}

#[cfg(test)]
mod tests;

#[tauri::command]
pub(crate) async fn plugin_package_current_preview(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<PluginAuthority>>,
) -> Result<Option<PreviewSnapshot>, String> {
    let url = webview.url().map_err(|_| "调用来源不可用。")?;
    super::check_product(
        webview.window().label(),
        webview.label(),
        &url.origin().ascii_serialization(),
    )?;
    #[cfg(target_os = "android")]
    if state.preview.lock().map_err(|_| "预览不可用。")?.is_none()
        && let Some(input) = crate::system::android::incoming(&app).await?
    {
        let authority = state.inner().clone();
        let preview = tauri::async_runtime::spawn_blocking(move || match input {
            crate::system::android::MobileInput::Bytes(bytes) => {
                let _permit = authority
                    .capacity
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| "插件操作繁忙。")?;
                authority.preview_package(bytes)
            }
            crate::system::android::MobileInput::Url(url) => {
                super::delivery::acquire_url(&authority, &url)
            }
        })
        .await
        .map_err(|_| "系统包预览失败。")??;
        return Ok(Some(preview));
    }
    if let Some(dev) = app.state::<super::dev::DevSessions>().authority()
        && let Some(preview) = dev.preview.lock().map_err(|_| "预览不可用。")?.as_ref()
    {
        return Ok(Some(preview.display.clone()));
    }
    Ok(state
        .preview
        .lock()
        .map_err(|_| "预览不可用。")?
        .as_ref()
        .map(|session| session.display.clone()))
}
