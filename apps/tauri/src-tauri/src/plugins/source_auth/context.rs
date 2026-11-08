//! Verified native context lifetimes and synchronous cancellation barriers.
use super::super::{PluginAuthority, package_files::PackageFiles};
use super::configuration_binding;
use am_plugin_net::Exit;
use am_plugin_protocol::SourceAuthentication;
use am_plugin_runtime::{Caller, Field, HostObject, Level, Provenance, Selection, Value};
use std::sync::Arc;

pub(super) struct Context {
    authority: Arc<PluginAuthority>,
    session: String,
    object: String,
    caller: Caller,
    context: String,
    pub(super) config: SourceAuthentication,
    pub(super) binding: String,
    pub(super) plugin_id: String,
}
impl Context {
    pub(super) fn open(
        authority: Arc<PluginAuthority>,
        install: &str,
        input: &str,
        level: Level,
    ) -> Result<Self, String> {
        Self::try_open(authority, install, input, level)?
            .ok_or_else(|| "此插件未声明认证接口。".into())
    }
    /// Register the native session before parsing owned package bytes. Cancellation can
    /// close preparation as well as active transport; ordinary catalogs return no context.
    pub(super) fn try_open(
        authority: Arc<PluginAuthority>,
        install: &str,
        input: &str,
        level: Level,
    ) -> Result<Option<Self>, String> {
        if input.len() > 16384 {
            return Err("来源输入超过预算。".into());
        }
        let caller = Caller {
            channel: format!("native-source-auth:{}", uuid::Uuid::new_v4()),
            document: "native://source-auth".into(),
            account_scope: format!("source:{install}"),
        };
        let mut files = PackageFiles::open(authority.package_directory.clone())
            .map_err(|_| "插件目录不可用。")?;
        let loaded = authority.with(|r| {
            let loaded =
                r.host_package_session(install, caller.clone(), &mut files, &authority.policy())?;
            authority
                .source_contexts
                .lock()
                .map_err(|_| am_plugin_runtime::Error::Storage)?
                .insert(loaded.session_id.clone(), install.into());
            Ok(loaded)
        })?;
        let object = format!("source-input:{}", uuid::Uuid::new_v4());
        let result = (|| {
            let package = am_plugin_package::verify(loaded.package_bytes, || false)
                .map_err(|_| "插件校验失败。")?;
            let Some(config) = package.manifest().source_authentication.clone() else {
                return Ok(None);
            };
            // Config changes or publisher changes require a fresh login, even across rollback.
            let binding = configuration_binding(install, &package)?;
            let context = authority.with(|r| {
                r.host_publish(HostObject {
                    id: object.clone(),
                    account_scope: caller.account_scope.clone(),
                    version: 1,
                    fields: [(
                        // This host-owned object contains only a bounded source query or a
                        // public challenge label. Host music notes retain their L2 floor.
                        Field::Title,
                        Value {
                            text: input.into(),
                            provenance: Provenance {
                                level,
                                source_install: install.into(),
                                source_context: String::new(),
                                generation: 0,
                                data_generation: 0,
                            },
                        },
                    )]
                    .into(),
                })?;
                r.host_context(
                    &loaded.session_id,
                    &uuid::Uuid::new_v4().to_string(),
                    vec![Selection {
                        id: object.clone(),
                        version: 1,
                        fields: vec![Field::Title],
                    }],
                )
            })?;
            Ok(Some(Self {
                authority: authority.clone(),
                session: loaded.session_id.clone(),
                object: object.clone(),
                caller: caller.clone(),
                context,
                config,
                binding,
                plugin_id: package.manifest().id.clone(),
            }))
        })();
        if !matches!(&result, Ok(Some(_))) {
            let _ = authority.with(|r| {
                r.host_end_session(&loaded.session_id)?;
                authority
                    .source_contexts
                    .lock()
                    .map_err(|_| am_plugin_runtime::Error::Storage)?
                    .remove(&loaded.session_id);
                r.host_forget_object(&caller.account_scope, &object)
            });
        }
        result
    }
    pub(super) fn gate(&self) -> Result<super::super::network::NativeGate, String> {
        self.authority
            .network_gate(self.caller.clone(), &self.context, Exit::Sandbox)
    }
    pub(super) fn require_binding(&self, expected: Option<&str>) -> Result<(), String> {
        if expected == Some(self.binding.as_str()) {
            Ok(())
        } else {
            Err("认证配置已更新，请重新打开登录面板后再输入凭证。".into())
        }
    }
}
impl Drop for Context {
    fn drop(&mut self) {
        let _ = self.authority.with(|r| {
            r.host_end_session(&self.session)?;
            self.authority
                .source_contexts
                .lock()
                .map_err(|_| am_plugin_runtime::Error::Storage)?
                .remove(&self.session);
            r.host_forget_object(&self.caller.account_scope, &self.object)
        });
    }
}
pub(crate) fn cancel_contexts(
    authority: &Arc<PluginAuthority>,
    install: &str,
) -> Result<(), String> {
    authority.with(|r| {
        let mut sessions = authority
            .source_contexts
            .lock()
            .map_err(|_| am_plugin_runtime::Error::Storage)?;
        let closing: Vec<_> = sessions
            .iter()
            .filter(|(_, owner)| owner.as_str() == install)
            .map(|(id, _)| id.clone())
            .collect();
        for id in closing {
            r.host_end_session(&id)?;
            sessions.remove(&id);
        }
        Ok(())
    })
}
