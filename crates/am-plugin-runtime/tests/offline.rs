use am_plugin_runtime::*;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Clone, Default)]
struct Memory(Arc<Mutex<(Ledger, bool)>>);
impl Store for Memory {
    fn transaction<T>(
        &mut self,
        change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let mut data = self.0.lock().unwrap();
        let mut next = data.0.clone();
        let value = change(&mut next)?;
        if data.1 {
            return Err(Error::Storage);
        }
        data.0 = next;
        Ok(value)
    }
}
#[derive(Clone)]
struct Time(Arc<AtomicU64>);
impl Clock for Time {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Default)]
struct Sequence(u64);
impl Ids for Sequence {
    fn next_id(&mut self) -> String {
        self.0 += 1;
        format!("id-{}", self.0)
    }
}
type Host = Runtime<Memory, Time, Sequence>;
fn caller(channel: &str) -> Caller {
    Caller {
        channel: channel.into(),
        document: "executor://offline/index.html".into(),
        account_scope: "account-1".into(),
    }
}
fn fixture() -> (Host, Memory, Time) {
    let store = Memory::default();
    {
        let mut data = store.0.lock().unwrap();
        for id in ["a", "b"] {
            let identity = Identity {
                install_id: id.into(),
                plugin_id: format!("plugin-{id}"),
                content_hash: "a".repeat(64),
                publisher: "publisher".into(),
                generation: 1,
                data_generation: 1,
            };
            let lineage = serde_json::to_string(&("publisher", &identity.plugin_id)).unwrap();
            data.0.history.insert(lineage, Level::L0);
            data.0.installs.insert(
                id.into(),
                Install {
                    identity,
                    epoch: 1,
                    enabled: true,
                    historical_level: Level::L0,
                },
            );
            let grant_identity = data.0.installs[id].identity.clone();
            data.0.grants.insert(
                id.into(),
                Grant {
                    identity: grant_identity,
                    read_ceiling: if id == "a" { Level::L2 } else { Level::L0 },
                    state: true,
                    annotate: true,
                    expires_at_ms: 100_000,
                },
            );
        }
    }
    let time = Time(Arc::new(AtomicU64::new(1)));
    let mut runtime = Runtime::recover(store.clone(), time.clone(), Sequence::default()).unwrap();
    runtime
        .host_publish(object("track-1", "account-1", Level::L0))
        .unwrap();
    runtime
        .host_publish(object("track-2", "account-1", Level::L0))
        .unwrap();
    runtime
        .host_publish(object("track-1", "account-2", Level::L0))
        .unwrap();
    (runtime, store, time)
}
fn object(id: &str, account: &str, level: Level) -> HostObject {
    HostObject {
        id: id.into(),
        account_scope: account.into(),
        version: 1,
        fields: BTreeMap::from([
            (
                Field::Title,
                Value {
                    text: "public title".into(),
                    provenance: Provenance {
                        level,
                        source_install: "host".into(),
                        source_context: "selected".into(),
                        generation: 1,
                        data_generation: 1,
                    },
                },
            ),
            (
                Field::Note,
                Value {
                    text: "private note".into(),
                    provenance: Provenance {
                        level: Level::L2,
                        source_install: "host".into(),
                        source_context: "selected".into(),
                        generation: 1,
                        data_generation: 1,
                    },
                },
            ),
        ]),
    }
}
fn context(host: &mut Host, id: &str, fields: Vec<Field>) -> (Caller, String) {
    let caller = caller(id);
    let session = host.host_session(id, caller.clone()).unwrap();
    let ctx = host
        .host_context(
            &session,
            "foreground",
            vec![Selection {
                id: "track-1".into(),
                version: 1,
                fields,
            }],
        )
        .unwrap();
    (caller, ctx)
}
fn state(ctx: &str, operation: &str, expected: u64) -> WriteRequest {
    WriteRequest {
        context_id: ctx.into(),
        operation_id: operation.into(),
        expected_version: expected,
        write: Write::State {
            key: "draft".into(),
            schema_version: 1,
            text: "value".into(),
        },
    }
}

fn network_grant(
    store: &Memory,
    id: &str,
    level: Level,
    linked: bool,
    declared: bool,
    approved: bool,
) {
    let mut data = store.0.lock().unwrap();
    data.0.grants.get_mut(id).unwrap().read_ceiling = level;
    let identity = data.0.installs[id].identity.clone();
    data.0.network_grants.insert(
        id.into(),
        NetworkGrant {
            identity,
            scope: NetworkScope::Hosts(vec!["example.com".into()]),
            ceiling: level,
            user_linked_approved: linked,
            private_egress_declared: declared,
            private_egress_approved: approved,
            expires_at_ms: 100_000,
            last_used_at_ms: 1,
        },
    );
}
#[test]
fn public_then_linked_then_private_combinations_require_distinct_approval() {
    for (level, linked, declared, approved, allowed) in [
        (Level::L0, false, false, false, true),
        (Level::L1, false, false, false, false),
        (Level::L1, true, false, false, true),
        (Level::L2, true, false, true, false),
        (Level::L2, true, true, false, false),
        (Level::L2, true, true, true, true),
    ] {
        let (mut host, store, _) = fixture();
        network_grant(&store, "a", level, linked, declared, approved);
        let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
        assert_eq!(
            host.begin_exit(&caller, &ctx, ExitKind::Sandbox).is_ok(),
            allowed,
            "{level:?}"
        );
        assert_eq!(host.read(&caller, &ctx, "track-1").is_ok(), allowed);
    }
}
#[test]
fn retained_private_data_cannot_be_unread_before_networking_or_reinstall() {
    let (mut host, store, _) = fixture();
    let (caller, ctx) = context(&mut host, "a", vec![Field::Note]);
    host.read(&caller, &ctx, "track-1").unwrap();
    network_grant(&store, "a", Level::L0, false, false, false);
    assert!(host.begin_exit(&caller, &ctx, ExitKind::Image).is_err());
    store
        .0
        .lock()
        .unwrap()
        .0
        .installs
        .get_mut("a")
        .unwrap()
        .historical_level = Level::L0;
    assert!(host.begin_exit(&caller, &ctx, ExitKind::Media).is_err());
    // History survives a publisher/plugin-lineage reinstall even if the new namespace is empty.
    assert_eq!(
        host.snapshot()
            .unwrap()
            .iter()
            .find(|i| i.install_id == "a")
            .unwrap()
            .historical_level,
        Level::L2
    );
}
#[test]
fn a_private_host_annotation_cannot_be_forwarded_by_a_public_network_plugin() {
    let (mut host, store, _) = fixture();
    let (a, ctx) = context(&mut host, "a", vec![Field::Title, Field::Note]);
    let ticket = host
        .prepare(
            &a,
            WriteRequest {
                operation_id: "annotate-private".into(),
                context_id: ctx,
                expected_version: 1,
                write: Write::Annotate {
                    object_id: "track-1".into(),
                    text: "encoded private note".into(),
                },
            },
        )
        .unwrap();
    host.commit(&a, &ticket).unwrap();
    network_grant(&store, "b", Level::L0, false, false, false);
    let b = caller("b");
    let session = host.host_session("b", b.clone()).unwrap();
    let ctx = host
        .host_context(
            &session,
            "forward",
            vec![Selection {
                id: "track-1".into(),
                version: 2,
                fields: vec![Field::Title],
            }],
        )
        .unwrap();
    assert!(host.read(&b, &ctx, "track-1").is_err());
    assert!(host.begin_exit(&b, &ctx, ExitKind::Sandbox).is_err());
}
#[test]
fn every_exit_uses_real_channel_epoch_and_context() {
    for kind in [
        ExitKind::Sandbox,
        ExitKind::Declarative,
        ExitKind::Image,
        ExitKind::Media,
        ExitKind::Download,
    ] {
        let (mut host, store, _) = fixture();
        network_grant(&store, "a", Level::L0, false, false, false);
        let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
        let permit = host.begin_exit(&caller, &ctx, kind).unwrap();
        assert!(
            host.check_exit(
                &Caller {
                    channel: "forged".into(),
                    ..caller.clone()
                },
                &permit,
                kind,
                1,
                1
            )
            .is_err()
        );
        host.check_exit(&caller, &permit, kind, 1, 1).unwrap();
        host.revoke("a").unwrap();
        assert!(host.check_exit(&caller, &permit, kind, 1, 1).is_err());
        assert!(host.begin_exit(&caller, &ctx, kind).is_err());
    }
}
#[test]
fn no_url_scheme_can_substitute_for_host_preview_or_business_commit() {
    let (mut host, store, _) = fixture();
    network_grant(&store, "a", Level::L2, true, true, true);
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    for kind in [
        ExitKind::ExternalLink,
        ExitKind::Export,
        ExitKind::HostWrite,
    ] {
        assert!(host.begin_exit(&caller, &ctx, kind).is_err());
    }
}
#[test]
fn chunks_retries_and_finished_requests_share_session_budgets_and_audit_is_redacted() {
    let (mut host, store, _) = fixture();
    network_grant(&store, "a", Level::L0, false, false, false);
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    let one = host.begin_exit(&caller, &ctx, ExitKind::Media).unwrap();
    host.check_exit(&caller, &one, ExitKind::Media, 32, 64 * 1024 * 1024)
        .unwrap();
    host.finish_exit(one, &"a".repeat(64), 206, false).unwrap();
    let two = host.begin_exit(&caller, &ctx, ExitKind::Download).unwrap();
    assert!(
        host.check_exit(&caller, &two, ExitKind::Media, 1, 1)
            .is_err()
    );
    host.check_exit(&caller, &two, ExitKind::Download, 32, 64 * 1024 * 1024)
        .unwrap();
    assert!(
        host.check_exit(&caller, &two, ExitKind::Download, 1, 0)
            .is_err()
    );
    assert!(
        host.check_exit(&caller, &two, ExitKind::Download, 0, 1)
            .is_err()
    );
    let data = store.0.lock().unwrap();
    let audit = data.0.outbound_audit.values().next().unwrap();
    assert_eq!(audit.host_class, "a".repeat(64));
    assert_eq!(audit.status_class, 2);
}
#[test]
fn idle_network_grants_and_changed_install_identity_fail_closed() {
    let (mut host, store, time) = fixture();
    network_grant(&store, "a", Level::L0, false, false, false);
    {
        let mut data = store.0.lock().unwrap();
        data.0.grants.get_mut("a").unwrap().expires_at_ms = u64::MAX;
        data.0.network_grants.get_mut("a").unwrap().expires_at_ms = u64::MAX;
    }
    time.0.store(NETWORK_IDLE_MS + 1, Ordering::SeqCst);
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    assert!(host.begin_exit(&caller, &ctx, ExitKind::Sandbox).is_err());
    store
        .0
        .lock()
        .unwrap()
        .0
        .network_grants
        .get_mut("a")
        .unwrap()
        .last_used_at_ms = NETWORK_IDLE_MS + 1;
    let permit = host.begin_exit(&caller, &ctx, ExitKind::Sandbox).unwrap();
    store
        .0
        .lock()
        .unwrap()
        .0
        .installs
        .get_mut("a")
        .unwrap()
        .identity
        .generation += 1;
    assert!(
        host.check_exit(&caller, &permit, ExitKind::Sandbox, 0, 0)
            .is_err()
    );
}

#[test]
fn selected_projection_never_enumerates_hidden_fields_or_objects() {
    let (mut host, _, _) = fixture();
    let (caller, ctx) = context(&mut host, "b", vec![Field::Title]);
    assert_eq!(
        host.read(&caller, &ctx, "track-1").unwrap(),
        BTreeMap::from([(Field::Title, "public title".into())])
    );
    assert_eq!(host.read(&caller, &ctx, "track-2"), Err(Error::Denied));
    assert_eq!(
        host.read(&caller, "guessed-context", "track-1"),
        Err(Error::Denied)
    );
}

#[test]
fn actual_channel_document_and_account_are_all_bound() {
    let (mut host, _, _) = fixture();
    let (real, ctx) = context(&mut host, "a", vec![Field::Title]);
    for forged in [
        Caller {
            channel: "b".into(),
            ..real.clone()
        },
        Caller {
            document: "executor://other".into(),
            ..real.clone()
        },
        Caller {
            account_scope: "account-2".into(),
            ..real.clone()
        },
    ] {
        assert_eq!(host.read(&forged, &ctx, "track-1"), Err(Error::Denied));
        assert_eq!(
            host.prepare(&forged, state(&ctx, "op", 0)),
            Err(Error::Denied)
        );
    }
    assert!(host.read(&real, &ctx, "track-1").is_ok());
}

#[test]
fn expiry_and_selection_close_reject_late_work() {
    let (mut host, _, time) = fixture();
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    let ticket = host.prepare(&caller, state(&ctx, "op", 0)).unwrap();
    time.0.store(100_000, Ordering::SeqCst);
    assert_eq!(host.commit(&caller, &ticket), Err(Error::Expired));
    time.0.store(1, Ordering::SeqCst);
    host.host_close_context(&ctx).unwrap();
    assert_eq!(host.commit(&caller, &ticket), Err(Error::Denied));
    assert_eq!(host.read(&caller, &ctx, "track-1"), Err(Error::Denied));
}

#[test]
fn new_selection_invalidates_old_context_and_reservations() {
    let (mut host, store, _) = fixture();
    let (caller, old) = context(&mut host, "a", vec![Field::Title]);
    let ticket = host.prepare(&caller, state(&old, "op", 0)).unwrap();
    let session = store.0.lock().unwrap().0.contexts[&old].session_id.clone();
    host.host_context(
        &session,
        "new-selection",
        vec![Selection {
            id: "track-2".into(),
            version: 1,
            fields: vec![Field::Title],
        }],
    )
    .unwrap();
    assert_eq!(host.commit(&caller, &ticket), Err(Error::Denied));
}

#[test]
fn commit_rechecks_epoch_after_durable_revocation() {
    let (mut host, store, _) = fixture();
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    let ticket = host.prepare(&caller, state(&ctx, "op", 0)).unwrap();
    host.revoke("a").unwrap();
    assert_eq!(host.commit(&caller, &ticket), Err(Error::Denied));
    let ledger = &store.0.lock().unwrap().0;
    assert!(!ledger.installs["a"].enabled);
    assert!(!ledger.grants.contains_key("a"));
    assert!(ledger.namespaces.is_empty());
    assert_eq!(ledger.journal.values().next().unwrap().epoch, 3);
}

#[test]
fn failed_revoke_never_acknowledges_or_mutates_in_memory() {
    let (mut host, store, _) = fixture();
    store.0.lock().unwrap().1 = true;
    assert_eq!(host.revoke("a"), Err(Error::Storage));
    assert!(store.0.lock().unwrap().0.installs["a"].enabled);
    store.0.lock().unwrap().1 = false;
    host.revoke("a").unwrap();
    assert!(!store.0.lock().unwrap().0.installs["a"].enabled);
}

#[test]
fn expected_version_and_operation_id_are_checked_at_commit() {
    let (mut host, _, _) = fixture();
    let (caller, ctx) = context(&mut host, "a", vec![Field::Title]);
    let first = state(&ctx, "one", 0);
    let t1 = host.prepare(&caller, first.clone()).unwrap();
    assert_eq!(host.prepare(&caller, first).unwrap(), t1);
    let t2 = host.prepare(&caller, state(&ctx, "two", 0)).unwrap();
    assert_eq!(host.commit(&caller, &t1), Ok(1));
    assert_eq!(host.commit(&caller, &t1), Ok(1));
    assert_eq!(host.commit(&caller, &t2), Err(Error::Conflict));
    assert_eq!(
        host.prepare(&caller, state(&ctx, "one", 1)),
        Err(Error::Replay)
    );
    assert_eq!(
        host.state_get(&caller, &ctx, "draft")
            .unwrap()
            .unwrap()
            .version,
        1
    );
}

#[test]
fn namespaces_and_tickets_cannot_cross_plugins() {
    let (mut host, _, _) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Title]);
    let (b, cb) = context(&mut host, "b", vec![Field::Title]);
    let ticket = host.prepare(&a, state(&ca, "one", 0)).unwrap();
    assert_eq!(host.commit(&b, &ticket), Err(Error::Denied));
    host.commit(&a, &ticket).unwrap();
    assert_eq!(host.state_get(&b, &cb, "draft"), Ok(None));
    assert_eq!(host.state_get(&b, &cb, "a:draft"), Ok(None));
}

#[test]
fn private_a_to_host_title_to_b_remains_private() {
    let (mut host, store, _) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Title, Field::Note]);
    assert!(
        host.read(&a, &ca, "track-1")
            .unwrap()
            .contains_key(&Field::Note)
    );
    let write = WriteRequest {
        context_id: ca,
        operation_id: "encoded-note".into(),
        expected_version: 1,
        write: Write::Annotate {
            object_id: "track-1".into(),
            text: "encoded-private-note".into(),
        },
    };
    let ticket = host.prepare(&a, write).unwrap();
    assert_eq!(host.commit(&a, &ticket), Ok(2));
    let b = caller("b");
    let bs = host.host_session("b", b.clone()).unwrap();
    let bc = host
        .host_context(
            &bs,
            "b-task",
            vec![Selection {
                id: "track-1".into(),
                version: 2,
                fields: vec![Field::Title],
            }],
        )
        .unwrap();
    assert_eq!(host.read(&b, &bc, "track-1"), Err(Error::Denied));
    let ledger = &store.0.lock().unwrap().0;
    let annotation = ledger.annotations.values().next().unwrap();
    assert_eq!(annotation.value.provenance.level, Level::L2);
    assert_eq!(annotation.value.provenance.source_install, "a");
    assert!(!ledger.deliveries.is_empty());
}

#[test]
fn unknown_history_or_provenance_is_private_and_never_self_downgraded() {
    let (mut host, store, _) = fixture();
    store.0.lock().unwrap().0.history.clear();
    let (b, cb) = context(&mut host, "b", vec![Field::Title]);
    assert_eq!(host.read(&b, &cb, "track-1"), Err(Error::Denied));
    assert_eq!(host.snapshot().unwrap()[1].historical_level, Level::L2);
}

#[test]
fn reinstall_and_hash_publisher_data_generation_changes_invalidate_old_channels() {
    for field in [
        "hash",
        "publisher",
        "generation",
        "data",
        "install",
        "epoch",
    ] {
        let (mut host, store, _) = fixture();
        let (a, ca) = context(&mut host, "a", vec![Field::Title]);
        let ticket = host.prepare(&a, state(&ca, "op", 0)).unwrap();
        {
            let mut data = store.0.lock().unwrap();
            let install = data.0.installs.get_mut("a").unwrap();
            match field {
                "hash" => install.identity.content_hash = "b".repeat(64),
                "publisher" => install.identity.publisher = "new-publisher".into(),
                "generation" => install.identity.generation += 1,
                "data" => install.identity.data_generation += 1,
                "install" => install.identity.install_id = "new-install".into(),
                _ => install.epoch += 1,
            }
        }
        assert!(host.commit(&a, &ticket).is_err(), "{field}");
    }
}

#[test]
fn restart_invalidates_sessions_and_pending_work_but_preserves_data_and_history() {
    let (mut host, store, time) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Note]);
    host.read(&a, &ca, "track-1").unwrap();
    let ticket = host.prepare(&a, state(&ca, "op", 0)).unwrap();
    host.commit(&a, &ticket).unwrap();
    let mut restored = Runtime::recover(store.clone(), time, Sequence(100)).unwrap();
    assert_eq!(restored.commit(&a, &ticket), Err(Error::Denied));
    assert_eq!(restored.snapshot().unwrap()[0].historical_level, Level::L2);
    assert_eq!(
        store.0.lock().unwrap().0.namespaces["a"]["draft"]
            .provenance
            .level,
        Level::L2
    );
}

#[test]
fn corrupt_policy_and_secret_input_fail_closed() {
    let (mut host, store, _) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Title]);
    let mut secret = object("secret", "account-1", Level::Secret);
    secret.fields.remove(&Field::Note);
    host.host_publish(secret).unwrap();
    let session = store.0.lock().unwrap().0.contexts[&ca].session_id.clone();
    let ctx = host
        .host_context(
            &session,
            "secret",
            vec![Selection {
                id: "secret".into(),
                version: 1,
                fields: vec![Field::Title],
            }],
        )
        .unwrap();
    assert_eq!(host.read(&a, &ctx, "secret"), Err(Error::Denied));
    store.0.lock().unwrap().0.grants.remove("a");
    assert_eq!(host.snapshot(), Err(Error::Corrupt));
}

#[test]
fn oversized_payload_and_unselected_annotation_have_no_effect() {
    let (mut host, _, _) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Title]);
    let mut request = state(&ca, "large", 0);
    request.write = Write::State {
        key: "draft".into(),
        schema_version: 1,
        text: "a".repeat(MAX_VALUE_BYTES + 1),
    };
    assert_eq!(host.prepare(&a, request), Err(Error::Budget));
    let request = WriteRequest {
        context_id: ca,
        operation_id: "guessed".into(),
        expected_version: 1,
        write: Write::Annotate {
            object_id: "track-2".into(),
            text: "title".into(),
        },
    };
    assert_eq!(host.prepare(&a, request), Err(Error::Denied));
}

#[test]
fn changed_content_cannot_reuse_an_old_grant_even_for_a_new_session() {
    let (mut host, store, _) = fixture();
    store
        .0
        .lock()
        .unwrap()
        .0
        .installs
        .get_mut("a")
        .unwrap()
        .identity
        .content_hash = "b".repeat(64);
    assert_eq!(
        host.host_session("a", caller("fresh-channel")),
        Err(Error::Corrupt)
    );
}

#[test]
fn operation_ids_do_not_replay_through_a_new_native_channel() {
    let (mut host, _, _) = fixture();
    let (a, ca) = context(&mut host, "a", vec![Field::Title]);
    let ticket = host.prepare(&a, state(&ca, "once", 0)).unwrap();
    host.commit(&a, &ticket).unwrap();
    let next = caller("new-channel");
    let session = host.host_session("a", next.clone()).unwrap();
    let context = host
        .host_context(
            &session,
            "next-task",
            vec![Selection {
                id: "track-1".into(),
                version: 1,
                fields: vec![Field::Title],
            }],
        )
        .unwrap();
    assert_eq!(
        host.prepare(&next, state(&context, "once", 1)),
        Err(Error::Replay)
    );
}

#[test]
fn retained_lineage_and_public_refresh_cannot_erase_private_origin() {
    let (mut host, store, _) = fixture();
    let mut private = object("private", "account-1", Level::L2);
    private.version = 1;
    host.host_publish(private.clone()).unwrap();
    private.version = 2;
    private
        .fields
        .get_mut(&Field::Title)
        .unwrap()
        .provenance
        .level = Level::L0;
    host.host_publish(private).unwrap();
    let (a, ca) = context(&mut host, "a", vec![Field::Note]);
    host.read(&a, &ca, "track-1").unwrap();
    {
        let mut data = store.0.lock().unwrap();
        let mut replaced = data.0.installs["a"].clone();
        replaced.identity.install_id = "replacement".into();
        replaced.historical_level = Level::L0;
        let mut grant = data.0.grants["a"].clone();
        grant.identity = replaced.identity.clone();
        data.0.installs.insert("replacement".into(), replaced);
        data.0.grants.insert("replacement".into(), grant);
    }
    assert_eq!(
        host.snapshot()
            .unwrap()
            .iter()
            .find(|i| i.install_id == "replacement")
            .unwrap()
            .historical_level,
        Level::L2
    );
    assert!(
        store
            .0
            .lock()
            .unwrap()
            .0
            .objects
            .values()
            .filter(|o| o.id == "private")
            .all(|o| o.fields[&Field::Title].provenance.level == Level::L2)
    );
}

/// Simulates time spent waiting for the native Store's serialized transaction.
struct AdmissionStore {
    memory: Memory,
    clock: Time,
    enter_at: Arc<AtomicU64>,
}
impl Store for AdmissionStore {
    fn transaction<T>(
        &mut self,
        change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.memory.transaction(|ledger| {
            let now = self.enter_at.swap(0, Ordering::SeqCst);
            if now != 0 {
                self.clock.0.store(now, Ordering::SeqCst);
            }
            change(ledger)
        })
    }
}

fn guard_expiry_after_admission(capability: bool) {
    for expires in ["grant", "session", "context"] {
        let (_, store, clock) = fixture();
        let enter_at = Arc::new(AtomicU64::new(0));
        let mut host = Runtime::recover(
            AdmissionStore {
                memory: store.clone(),
                clock: clock.clone(),
                enter_at: enter_at.clone(),
            },
            clock,
            Sequence(100),
        )
        .unwrap();
        let caller = caller("admission");
        let session = host.host_session("a", caller.clone()).unwrap();
        let context = host
            .host_context(
                &session,
                "task",
                vec![Selection {
                    id: "track-1".into(),
                    version: 1,
                    fields: vec![Field::Title],
                }],
            )
            .unwrap();
        {
            let ledger = &mut store.0.lock().unwrap().0;
            // Test-owned persisted package proof grants the named capability only.
            let identity = ledger.installs["a"].identity.clone();
            ledger.packages.insert(
                "a".into(),
                PackageRecord {
                    identity: identity.clone(),
                    candidate: Candidate {
                        plugin_id: identity.plugin_id.clone(),
                        version: "1.0.0".into(),
                        package_hash: identity.content_hash.clone(),
                        signer: None,
                        execution: "sandbox-code".into(),
                        data_schema: 1,
                        capabilities: vec!["crypto.sha256".into()],
                        required_capabilities: vec![],
                        compatible: true,
                    },
                    data_hash: "b".repeat(64),
                    rollback: None,
                    installed: true,
                    granted_capabilities: ["crypto.sha256".into()].into(),
                },
            );
            match expires {
                "grant" => ledger.grants.get_mut("a").unwrap().expires_at_ms = 10,
                "session" => ledger.sessions.get_mut(&session).unwrap().expires_at_ms = 10,
                _ => ledger.contexts.get_mut(&context).unwrap().expires_at_ms = 10,
            }
        }
        let mut check = || {
            if capability {
                host.check_capability(&caller, &context, "crypto.sha256")
            } else {
                host.check_context(&caller, &context)
            }
        };
        assert_eq!(check(), Ok(()), "valid {expires} before admission wait");
        enter_at.store(9, Ordering::SeqCst);
        assert_eq!(check(), Ok(()), "valid {expires} before its exact boundary");
        enter_at.store(10, Ordering::SeqCst);
        assert_eq!(
            check(),
            Err(Error::Expired),
            "expired {expires} at admission"
        );
    }
}

#[test]
fn context_guard_refreshes_time_after_transaction_admission() {
    guard_expiry_after_admission(false);
}

#[test]
fn capability_guard_refreshes_time_after_transaction_admission() {
    guard_expiry_after_admission(true);
}
