use super::*;
use am_plugin_runtime::{
    Caller, Clock, Field, Grant, HostObject, Identity, Ids, Install, Level, Provenance, Runtime,
    Selection, Value, Write, WriteRequest,
};
use std::path::PathBuf;

#[test]
fn previous_database_schemas_are_rejected_without_modifying_data() {
    for version in [1, 2] {
        let db = TempDb::new();
        drop(seeded(&db));
        let connection = Connection::open(&db.0).unwrap();
        connection
            .pragma_update(None, "user_version", version)
            .unwrap();
        let before: String = connection
            .query_row(
                "SELECT payload FROM installs WHERE id='fixture'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(PluginStore::open(&db.0).is_err());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            version
        );
        let after: String = connection
            .query_row(
                "SELECT payload FROM installs WHERE id='fixture'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before, after);
    }
}

struct TempDb(PathBuf);
impl TempDb {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("am-s12-{}.sqlite3", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> PluginStore {
        PluginStore::open(&self.0).unwrap()
    }
}
impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
struct Time;
impl Clock for Time {
    fn now_ms(&self) -> u64 {
        1
    }
}
struct Random;
impl Ids for Random {
    fn next_id(&mut self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
type Native = Runtime<PluginStore, Time, Random>;
fn seeded(db: &TempDb) -> Native {
    let mut store = db.open();
    // Fixtures are the only source of install/grant records in S12. No product command can do this.
    store
        .transaction(|ledger| {
            ledger.installs.insert(
                "fixture".into(),
                Install {
                    identity: Identity {
                        install_id: "fixture".into(),
                        plugin_id: "offline-fixture".into(),
                        publisher: "test-publisher".into(),
                        content_hash: "a".repeat(64),
                        generation: 1,
                        data_generation: 1,
                    },
                    enabled: true,
                    epoch: 1,
                    historical_level: Level::L2,
                },
            );
            ledger.grants.insert(
                "fixture".into(),
                Grant {
                    identity: ledger.installs["fixture"].identity.clone(),
                    read_ceiling: Level::L2,
                    state: true,
                    annotate: true,
                    expires_at_ms: 100_000,
                },
            );
            Ok(())
        })
        .unwrap();
    Runtime::recover(store, Time, Random).unwrap()
}
fn prepare<S: Store>(host: &mut Runtime<S, Time, Random>) -> (Caller, String, String) {
    host.host_publish(HostObject {
        id: "track".into(),
        version: 1,
        account_scope: "account".into(),
        fields: BTreeMap::from([(
            Field::Title,
            Value {
                text: "title".into(),
                provenance: Provenance {
                    level: Level::L0,
                    source_install: "host".into(),
                    source_context: "selection".into(),
                    generation: 1,
                    data_generation: 1,
                },
            },
        )]),
    })
    .unwrap();
    let caller = Caller {
        channel: "native-fixture-channel".into(),
        document: "executor://fixture/index.html".into(),
        account_scope: "account".into(),
    };
    let session = host.host_session("fixture", caller.clone()).unwrap();
    let context = host
        .host_context(
            &session,
            "task",
            vec![Selection {
                id: "track".into(),
                version: 1,
                fields: vec![Field::Title],
            }],
        )
        .unwrap();
    let ticket = host
        .prepare(
            &caller,
            WriteRequest {
                context_id: context.clone(),
                operation_id: "once".into(),
                expected_version: 0,
                write: Write::State {
                    key: "draft".into(),
                    schema_version: 1,
                    text: "retained-private-data".into(),
                },
            },
        )
        .unwrap();
    (caller, context, ticket)
}

#[test]
fn native_commit_failure_keeps_value_provenance_and_receipt_in_the_old_generation() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    struct FailSwitch {
        store: PluginStore,
        fail: Arc<AtomicBool>,
    }
    impl Store for FailSwitch {
        fn transaction<T>(
            &mut self,
            change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
        ) -> Result<T, Error> {
            self.store.fail_before_commit = self.fail.load(Ordering::SeqCst);
            self.store.transaction(change)
        }
    }
    let db = TempDb::new();
    drop(seeded(&db));
    let fail = Arc::new(AtomicBool::new(false));
    let mut host = Runtime::recover(
        FailSwitch {
            store: db.open(),
            fail: fail.clone(),
        },
        Time,
        Random,
    )
    .unwrap();
    let (caller, context, first) = prepare(&mut host);
    host.commit(&caller, &first).unwrap();
    let second = host
        .prepare(
            &caller,
            WriteRequest {
                context_id: context,
                operation_id: "replace".into(),
                expected_version: 1,
                write: Write::State {
                    key: "draft".into(),
                    schema_version: 2,
                    text: "replacement".into(),
                },
            },
        )
        .unwrap();
    fail.store(true, Ordering::SeqCst);
    assert_eq!(host.commit(&caller, &second), Err(Error::Storage));
    fail.store(false, Ordering::SeqCst);
    db.open()
        .transaction(|ledger| {
            assert_eq!(
                ledger.namespaces["fixture"]["draft"].text,
                "retained-private-data"
            );
            assert_eq!(ledger.namespaces["fixture"]["draft"].version, 1);
            assert_eq!(
                ledger.namespaces["fixture"]["draft"].provenance.level,
                Level::L2
            );
            assert_eq!(ledger.tasks[&second].committed_version, None);
            Ok(())
        })
        .unwrap();
    assert_eq!(host.commit(&caller, &second), Ok(2));
}

#[test]
fn sqlite_restart_preserves_value_label_and_receipt_but_rejects_old_channel() {
    let db = TempDb::new();
    let mut host = seeded(&db);
    let (caller, _, ticket) = prepare(&mut host);
    host.commit(&caller, &ticket).unwrap();
    drop(host);
    let mut restored = Runtime::recover(db.open(), Time, Random).unwrap();
    assert_eq!(restored.commit(&caller, &ticket), Err(Error::Denied));
    drop(restored);
    db.open()
        .transaction(|ledger| {
            assert_eq!(
                ledger.namespaces["fixture"]["draft"].provenance.level,
                Level::L2
            );
            assert_eq!(ledger.tasks[&ticket].committed_version, Some(1));
            assert!(ledger.sessions.is_empty());
            Ok(())
        })
        .unwrap();
}

#[test]
fn failed_transaction_rolls_back_values_labels_and_operation_receipts_together() {
    let db = TempDb::new();
    let mut host = seeded(&db);
    let (caller, _, ticket) = prepare(&mut host);
    // Inject a write failure after all table replacements but before COMMIT.
    // The same native store used by runtime must leave the whole ledger unchanged.
    drop(host);
    let mut store = db.open();
    store.fail_before_commit = true;
    assert_eq!(
        store.transaction(|ledger| {
            ledger.tasks.get_mut(&ticket).unwrap().committed_version = Some(99);
            ledger.installs.get_mut("fixture").unwrap().enabled = false;
            ledger.namespaces.clear();
            Ok(())
        }),
        Err(Error::Storage)
    );
    drop(store);
    let mut check = db.open();
    check
        .transaction(|ledger| {
            assert_eq!(ledger.tasks[&ticket].committed_version, None);
            assert!(ledger.installs["fixture"].enabled);
            assert!(
                ledger
                    .sessions
                    .values()
                    .any(|s| s.channel == caller.channel)
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn second_native_connection_revokes_before_late_commit() {
    let db = TempDb::new();
    let mut first = seeded(&db);
    let mut second = Runtime::recover(db.open(), Time, Random).unwrap();
    let (caller, _, ticket) = prepare(&mut first);
    second.revoke("fixture").unwrap();
    assert_eq!(first.commit(&caller, &ticket), Err(Error::Denied));
    drop(first);
    drop(second);
    let mut restored = Runtime::recover(db.open(), Time, Random).unwrap();
    assert!(!restored.snapshot().unwrap()[0].enabled);
}

#[test]
fn future_database_schema_and_malformed_grants_are_preserved_and_rejected() {
    let db = TempDb::new();
    drop(seeded(&db));
    {
        let connection = Connection::open(&db.0).unwrap();
        connection
            .execute("UPDATE grants SET payload = '{}'", [])
            .unwrap();
    }
    assert!(matches!(
        Runtime::recover(db.open(), Time, Random),
        Err(Error::Corrupt)
    ));
    {
        let connection = Connection::open(&db.0).unwrap();
        connection.pragma_update(None, "user_version", 99).unwrap();
    }
    assert!(matches!(PluginStore::open(&db.0), Err(Error::Corrupt)));
    assert!(db.0.exists());
    let connection = Connection::open(&db.0).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        99
    );
}

#[test]
fn empty_database_cannot_create_an_authorized_session() {
    let db = TempDb::new();
    let mut host = Runtime::recover(db.open(), Time, Random).unwrap();
    assert!(host.snapshot().unwrap().is_empty());
    assert_eq!(
        host.host_session(
            "fixture",
            Caller {
                channel: "fake".into(),
                document: "fake".into(),
                account_scope: "fake".into()
            }
        ),
        Err(Error::Denied)
    );
}

#[test]
fn persisted_revocation_is_acknowledged_only_after_commit() {
    let db = TempDb::new();
    let mut host = seeded(&db);
    let (caller, _, ticket) = prepare(&mut host);
    host.revoke("fixture").unwrap();
    drop(host);
    db.open()
        .transaction(|ledger| {
            assert!(!ledger.installs["fixture"].enabled);
            assert!(ledger.grants.is_empty());
            assert!(ledger.journal.values().any(|j| j.action == "revoke"));
            assert!(!ledger.tasks.contains_key(&ticket));
            assert!(
                ledger
                    .sessions
                    .values()
                    .all(|s| s.channel != caller.channel)
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn missing_revocation_authority_row_does_not_reset_known_security_state() {
    let db = TempDb::new();
    let store = db.open();
    drop(store);
    let connection = Connection::open(&db.0).unwrap();
    connection.execute("DELETE FROM revocations", []).unwrap();
    drop(connection);
    assert!(matches!(
        Runtime::recover(db.open(), Time, Random),
        Err(Error::Corrupt)
    ));
}
