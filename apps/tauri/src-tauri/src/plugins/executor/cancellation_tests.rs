//! Headless cancellation regressions exercise the real executor and native SQLite authority.
use super::*;
use crate::plugins::{NativeClock, NativeIds};
use crate::storage::plugins::PluginStore;
use am_plugin_runtime::{Candidate, Grant, Identity, Install, PackageRecord, Runtime, Store};
use rusqlite::Connection;
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    task: Arc<Task>,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("am-executor-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let authority = PluginAuthority::new(root.clone());
        let mut store = PluginStore::open(&authority.path).unwrap();
        store
            .transaction(|ledger| {
                let identity = Identity {
                    install_id: "fixture".into(),
                    plugin_id: "cancel-test".into(),
                    content_hash: "a".repeat(64),
                    publisher: "test".into(),
                    generation: 1,
                    data_generation: 1,
                };
                ledger.installs.insert(
                    "fixture".into(),
                    Install {
                        identity: identity.clone(),
                        epoch: 1,
                        enabled: true,
                        historical_level: Level::L2,
                    },
                );
                ledger.grants.insert(
                    "fixture".into(),
                    Grant {
                        identity,
                        read_ceiling: Level::L2,
                        state: true,
                        annotate: false,
                        expires_at_ms: u64::MAX,
                    },
                );
                Ok(())
            })
            .unwrap();
        let mut runtime = Runtime::recover(store, NativeClock, NativeIds).unwrap();
        let caller = Caller {
            channel: "cancel-test".into(),
            document: "executor://cancel-test/index.html".into(),
            account_scope: "product".into(),
        };
        let session = runtime.host_session("fixture", caller.clone()).unwrap();
        runtime
            .host_publish(HostObject {
                id: "input".into(),
                account_scope: "product".into(),
                version: 1,
                fields: [(
                    Field::Note,
                    Value {
                        text: "selected input".into(),
                        provenance: Provenance {
                            level: Level::L2,
                            source_install: "host".into(),
                            source_context: "selected".into(),
                            generation: 1,
                            data_generation: 1,
                        },
                    },
                )]
                .into(),
            })
            .unwrap();
        let context = runtime
            .host_context(
                &session,
                "task",
                vec![Selection {
                    id: "input".into(),
                    version: 1,
                    fields: vec![Field::Note],
                }],
            )
            .unwrap();
        // Test-owned persisted proof models a verified native package session. It is never IPC.
        PluginStore::open(&authority.path)
            .unwrap()
            .transaction(|ledger| {
                let identity = ledger.installs["fixture"].identity.clone();
                ledger.packages.insert(
                    "fixture".into(),
                    PackageRecord {
                        identity: identity.clone(),
                        candidate: Candidate {
                            plugin_id: identity.plugin_id.clone(),
                            version: "1.0.0".into(),
                            package_hash: identity.content_hash.clone(),
                            signer: None,
                            execution: "sandbox-code".into(),
                            data_schema: 1,
                            capabilities: vec!["state.write".into()],
                            required_capabilities: vec![],
                            compatible: true,
                        },
                        data_hash: "b".repeat(64),
                        rollback: None,
                        installed: true,
                        granted_capabilities: ["state.write".into()].into(),
                    },
                );
                Ok(())
            })
            .unwrap();
        *authority.authority.lock().unwrap() = Some(Ok(runtime));
        Self {
            root,
            task: Arc::new(Task {
                authority,
                caller,
                install: "fixture".into(),
                session,
                context,
                object: "input".into(),
                source: String::new(),
                profile: PathBuf::new(),
                declarative: None,
                cancel: CancellationToken::new(),
                transport_ready: std::sync::atomic::AtomicBool::new(true),
                #[cfg(windows)]
                transport_token: std::sync::atomic::AtomicI64::new(0),
                started: Instant::now(),
                frame: Mutex::new(Frame {
                    invocation: json!({}),
                    bootstrap: false,
                    tx: None,
                    responses: BTreeMap::new(),
                    requests: BTreeSet::new(),
                }),
            }),
        }
    }

    fn fail_session_close(&self, fail: bool) {
        let sql = if fail {
            "CREATE TRIGGER fail_session_close BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'injected close failure'); END;"
        } else {
            "DROP TRIGGER fail_session_close;"
        };
        Connection::open(&self.task.authority.path)
            .unwrap()
            .execute_batch(sql)
            .unwrap();
    }

    fn executors(&self) -> Executors {
        Executors {
            tasks: Mutex::new([("task".into(), self.task.clone())].into()),
            ..Executors::default()
        }
    }

    fn write(&self, operation: &str) -> Result<Json, String> {
        broker(
            &self.task,
            &mut self.task.frame.lock().unwrap(),
            &json!({"operation":"state.set","input":{"key":"draft","schemaVersion":1,"expectedVersion":0,"operationId":operation,"value":"result"}}),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.authority.authority.lock().unwrap().take();
        assert_eq!(self.root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            self.root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("am-executor-cancel-")
        );
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn cancellation_propagates_session_close_failure_and_retry_closes_authority() {
    let fixture = Fixture::new();
    let executors = fixture.executors();
    fixture.fail_session_close(true);
    assert!(executors.cancel_install("fixture").is_err());
    assert!(fixture.task.cancel.is_cancelled());
    fixture.fail_session_close(false);
    assert_eq!(executors.cancel_install("fixture"), Ok(()));
    fixture
        .task
        .authority
        .with(|runtime| {
            assert!(
                runtime
                    .check_context(&fixture.task.caller, &fixture.task.context)
                    .is_err()
            );
            Ok(())
        })
        .unwrap();
    assert!(fixture.write("late").is_err());
}

#[test]
fn cancelled_task_cannot_write_after_failed_close_and_storage_recovery() {
    let fixture = Fixture::new();
    fixture.fail_session_close(true);
    let _ = fixture.executors().cancel_install("fixture");
    fixture.fail_session_close(false);
    assert!(fixture.write("queued").is_err());
    PluginStore::open(&fixture.task.authority.path)
        .unwrap()
        .transaction(|ledger| {
            assert!(ledger.namespaces.is_empty());
            assert!(ledger.tasks.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn cancellation_failure_does_not_skip_other_matching_sessions() {
    let first = Fixture::new();
    let second = Fixture::new();
    first.fail_session_close(true);
    let executors = Executors {
        tasks: Mutex::new(
            [
                ("first".into(), first.task.clone()),
                ("second".into(), second.task.clone()),
            ]
            .into(),
        ),
        ..Executors::default()
    };
    assert!(executors.cancel_install("fixture").is_err());
    assert!(first.task.cancel.is_cancelled());
    assert!(second.task.cancel.is_cancelled());
    second
        .task
        .authority
        .with(|runtime| {
            assert!(
                runtime
                    .check_context(&second.task.caller, &second.task.context)
                    .is_err()
            );
            Ok(())
        })
        .unwrap();
    assert!(second.write("late").is_err());
    first.fail_session_close(false);
}

#[test]
fn successful_cancellation_preserves_committed_values_and_durable_grants() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.write("before").unwrap(),
        json!({"value":"result","version":1})
    );
    let executors = fixture.executors();
    assert_eq!(executors.cancel_install("fixture"), Ok(()));
    assert_eq!(executors.cancel_install("fixture"), Ok(()));
    assert!(fixture.write("after").is_err());
    PluginStore::open(&fixture.task.authority.path)
        .unwrap()
        .transaction(|ledger| {
            assert!(ledger.installs["fixture"].enabled);
            assert!(ledger.grants.contains_key("fixture"));
            assert_eq!(ledger.namespaces["fixture"]["draft"].text, "result");
            assert_eq!(
                ledger.namespaces["fixture"]["draft"].provenance.level,
                Level::L2
            );
            assert_eq!(
                ledger
                    .tasks
                    .values()
                    .filter(|task| task.committed_version == Some(1))
                    .count(),
                1
            );
            assert!(ledger.sessions.is_empty());
            assert!(ledger.contexts.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn unknown_install_is_a_noop_and_poisoned_task_registry_is_an_error() {
    let fixture = Fixture::new();
    let executors = Arc::new(fixture.executors());
    assert_eq!(executors.cancel_install("unknown"), Ok(()));
    assert!(!fixture.task.cancel.is_cancelled());
    assert!(fixture.write("normal").is_ok());
    let poisoned = executors.clone();
    let _ = std::thread::spawn(move || {
        let _guard = poisoned.tasks.lock().unwrap();
        panic!("inject poisoned registry");
    })
    .join();
    assert!(executors.cancel_install("fixture").is_err());
}
