//! Host-only network adapter, bound to verified package sessions and native authority.
use super::PluginAuthority;
use am_plugin_net::{Error, Exit, Gate, Scope};
use am_plugin_runtime::{Caller, ExitKind, ExitPermit, NetworkScope};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

pub(super) struct NativeGate {
    authority: Arc<PluginAuthority>,
    caller: Caller,
    permit: Mutex<Option<ExitPermit>>,
    scope: Scope,
    kind: ExitKind,
    exit: Exit,
    cancel: CancellationToken,
    audit: Mutex<(String, u16, bool)>,
}
impl PluginAuthority {
    // No renderer or sandbox can create this handle. Only trusted native session orchestration
    // may call it after S14 verification; tests seed the same SQLite authority through Store.
    pub(super) fn network_gate(
        self: &Arc<Self>,
        caller: Caller,
        context: &str,
        exit: Exit,
    ) -> Result<NativeGate, String> {
        let kind = match exit {
            Exit::Sandbox => ExitKind::Sandbox,
            Exit::Declarative => ExitKind::Declarative,
            Exit::Image => ExitKind::Image,
            Exit::Media => ExitKind::Media,
            Exit::Download => ExitKind::Download,
            Exit::ExternalLink => ExitKind::ExternalLink,
            Exit::Export => ExitKind::Export,
            Exit::HostWrite => ExitKind::HostWrite,
        };
        // Register cancellation while holding the same authority barrier used by revoke.
        self.with(|runtime| {
            let permit = runtime.begin_exit(&caller, context, kind)?;
            let scope = runtime.check_exit(&caller, &permit, kind, 0, 0)?;
            let scope = match scope {
                NetworkScope::Public => Scope::Public,
                NetworkScope::Hosts(h) => Scope::Hosts(h),
            };
            let cancel = CancellationToken::new();
            let mut tasks = self
                .network_tasks
                .lock()
                .map_err(|_| am_plugin_runtime::Error::Storage)?;
            let tokens = tasks.entry(permit.install_id().into()).or_default();
            tokens.retain(|t| !t.is_cancelled());
            if tokens.len() >= 4 {
                return Err(am_plugin_runtime::Error::Budget);
            }
            tokens.push(cancel.clone());
            Ok(NativeGate {
                authority: self.clone(),
                caller,
                permit: Mutex::new(Some(permit)),
                scope,
                kind,
                exit,
                cancel,
                audit: Mutex::new((format!("{:x}", Sha256::digest(b"unstarted")), 0, true)),
            })
        })
    }
}
impl Gate for NativeGate {
    fn scope(&self) -> Scope {
        self.scope.clone()
    }
    fn check(&self, exit: Exit) -> Result<(), Error> {
        if exit != self.exit || self.cancel.is_cancelled() {
            return Err(Error::Denied);
        }
        self.charge(0, 0)
    }
    fn charge(&self, requests: u64, bytes: u64) -> Result<(), Error> {
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let permit = self.permit.lock().map_err(|_| Error::Denied)?;
        self.authority
            .with(|runtime| {
                runtime.check_exit(
                    &self.caller,
                    permit.as_ref().ok_or(am_plugin_runtime::Error::Denied)?,
                    self.kind,
                    requests,
                    bytes,
                )
            })
            .map(|_| ())
            .map_err(|_| Error::Denied)
    }
    fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
    fn deliver(
        &self,
        exit: Exit,
        bytes: u64,
        action: &mut dyn FnMut() -> Result<(), Error>,
    ) -> Result<(), Error> {
        if exit != self.exit || self.cancel.is_cancelled() {
            return Err(Error::Denied);
        }
        let permit = self.permit.lock().map_err(|_| Error::Denied)?;
        self.authority
            .with(|runtime| {
                runtime.check_exit(
                    &self.caller,
                    permit.as_ref().ok_or(am_plugin_runtime::Error::Denied)?,
                    self.kind,
                    0,
                    bytes,
                )?;
                action().map_err(|_| am_plugin_runtime::Error::Denied)
            })
            .map_err(|_| Error::Denied)
    }
    fn audit(&self, host: &str, status: u16, denied: bool) {
        let host_tag = format!("{:x}", Sha256::digest(host.as_bytes()));
        if let Ok(mut audit) = self.audit.lock() {
            *audit = (host_tag.clone(), status, denied)
        }
        if let Ok(permit) = self.permit.lock()
            && let Some(permit) = permit.as_ref()
        {
            let _ = self
                .authority
                .with(|runtime| runtime.record_exit(permit, &host_tag, status, denied));
        }
    }
}
impl Drop for NativeGate {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Ok(mut permit) = self.permit.lock()
            && let Some(permit) = permit.take()
            && let Ok(audit) = self.audit.lock()
        {
            let _ = self
                .authority
                .with(|runtime| runtime.finish_exit(permit, &audit.0, audit.1, audit.2));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Clock, NativeClock};
    use super::*;
    use crate::storage::plugins::PluginStore;
    use am_plugin_runtime::*;
    #[test]
    fn sqlite_native_gate_rechecks_authority_and_cancels_before_revoke_acknowledgement() {
        let directory = std::env::temp_dir().join(format!("am-s13-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("plugins.sqlite3");
        let now = NativeClock.now_ms();
        {
            let mut store = PluginStore::open(&path).unwrap();
            store
                .transaction(|ledger| {
                    let identity = Identity {
                        install_id: "native".into(),
                        plugin_id: "native-test".into(),
                        content_hash: "a".repeat(64),
                        publisher: "test".into(),
                        generation: 1,
                        data_generation: 1,
                    };
                    ledger.installs.insert(
                        "native".into(),
                        Install {
                            identity: identity.clone(),
                            epoch: 1,
                            enabled: true,
                            historical_level: Level::L0,
                        },
                    );
                    ledger.history.insert(
                        serde_json::to_string(&("test", "native-test")).unwrap(),
                        Level::L0,
                    );
                    ledger.grants.insert(
                        "native".into(),
                        Grant {
                            identity: identity.clone(),
                            read_ceiling: Level::L0,
                            state: true,
                            annotate: false,
                            expires_at_ms: u64::MAX,
                        },
                    );
                    ledger.network_grants.insert(
                        "native".into(),
                        NetworkGrant {
                            identity,
                            scope: NetworkScope::Hosts(vec!["example.com".into()]),
                            ceiling: Level::L0,
                            user_linked_approved: false,
                            private_egress_declared: false,
                            private_egress_approved: false,
                            expires_at_ms: u64::MAX,
                            last_used_at_ms: now,
                        },
                    );
                    Ok(())
                })
                .unwrap();
        }
        let authority = PluginAuthority::new(directory.clone());
        let caller = Caller {
            channel: "native-channel".into(),
            document: "executor://test".into(),
            account_scope: "test".into(),
        };
        let context = authority
            .with(|runtime| {
                runtime.host_publish(HostObject {
                    id: "track".into(),
                    account_scope: "test".into(),
                    version: 1,
                    fields: std::collections::BTreeMap::from([(
                        Field::Title,
                        Value {
                            text: "public".into(),
                            provenance: Provenance {
                                level: Level::L0,
                                source_install: "host".into(),
                                source_context: "selection".into(),
                                generation: 1,
                                data_generation: 1,
                            },
                        },
                    )]),
                })?;
                let session = runtime.host_session("native", caller.clone())?;
                runtime.host_context(
                    &session,
                    "foreground",
                    vec![Selection {
                        id: "track".into(),
                        version: 1,
                        fields: vec![Field::Title],
                    }],
                )
            })
            .unwrap();
        let gate = authority
            .network_gate(caller.clone(), &context, Exit::Media)
            .unwrap();
        gate.check(Exit::Media).unwrap();
        assert!(gate.check(Exit::Download).is_err());
        gate.charge(1, 8).unwrap();
        gate.audit("cdn.example.com", 206, false);
        assert!(
            authority
                .network_gate(
                    Caller {
                        channel: "forged".into(),
                        ..caller
                    },
                    &context,
                    Exit::Sandbox
                )
                .is_err()
        );
        authority.with(|r| r.revoke("native")).unwrap();
        authority.cancel_network("native");
        assert!(gate.cancellation().is_cancelled());
        assert!(gate.check(Exit::Media).is_err());
        assert!(gate.charge(1, 1).is_err());
        drop(gate);
        drop(authority);
        let mut store = PluginStore::open(&path).unwrap();
        store
            .transaction(|ledger| {
                assert!(!ledger.installs["native"].enabled);
                assert!(ledger.network_grants.is_empty());
                assert_eq!(ledger.outbound_audit.len(), 2);
                let bytes = serde_json::to_string(&ledger.outbound_audit).unwrap();
                assert!(!bytes.contains("cdn.example.com"));
                assert!(
                    ledger
                        .outbound_audit
                        .values()
                        .all(|a| a.host_class.len() == 64)
                );
                Ok(())
            })
            .unwrap();
        drop(store);
        std::fs::remove_file(path).unwrap();
        // S14 recovery also creates its private package subdirectory inside this owned fixture.
        assert_eq!(directory.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            directory
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("am-s13-")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
