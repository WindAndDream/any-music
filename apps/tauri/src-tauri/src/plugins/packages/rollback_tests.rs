//! Native rollback regressions use real SQLite/package files without opening application UI.
use super::*;

fn ledger(authority: &PluginAuthority) -> serde_json::Value {
    PluginStore::open(&authority.path)
        .unwrap()
        .transaction(|value| Ok(serde_json::to_value(value).unwrap()))
        .unwrap()
}

fn updated_authority() -> (Directory, Arc<PluginAuthority>, Identity) {
    let directory = Directory::new();
    let mut authority = PluginAuthority::new(directory.0.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = true;
    let first = authority
        .preview_package(fixture("unsigned-store"))
        .unwrap();
    let identity = authority.commit_preview(&first.token, consent()).unwrap();
    update(&authority);
    (directory, authority, identity)
}

fn update(authority: &PluginAuthority) {
    let next = authority
        .preview_package(fixture("unsigned-deflate"))
        .unwrap();
    authority.commit_preview(&next.token, consent()).unwrap();
}

#[test]
fn unadmitted_rollback_preview_and_commit_preserve_the_entire_ledger() {
    let (_directory, mut authority, identity) = updated_authority();
    let preview = authority.preview_rollback(&identity.install_id).unwrap();
    Arc::get_mut(&mut authority).unwrap().admitted = false;
    let before = ledger(&authority);
    assert!(authority.preview_rollback(&identity.install_id).is_err());
    assert!(authority.commit_rollback(preview, true).is_err());
    assert_eq!(ledger(&authority), before);
}

#[test]
fn declining_confirmation_and_ending_the_session_cannot_commit() {
    for stopped in [false, true] {
        let (_directory, authority, identity) = updated_authority();
        let preview = authority.preview_rollback(&identity.install_id).unwrap();
        let before = ledger(&authority);
        authority.stopped.store(stopped, Ordering::SeqCst);
        assert!(authority.commit_rollback(preview, stopped).is_err());
        assert_eq!(ledger(&authority), before);
    }
}

#[test]
fn approved_rollback_keeps_security_history_and_revokes_current_authority() {
    let (_directory, authority, original) = updated_authority();
    let before = ledger(&authority);
    let old_state = authority
        .with(|runtime| runtime.snapshot())
        .unwrap()
        .remove(0);
    let preview = authority.preview_rollback(&original.install_id).unwrap();
    assert_eq!(preview.candidate().package_hash, original.content_hash);
    // A preview itself must not stop an enabled installation or change its grants/data.
    assert_eq!(ledger(&authority), before);
    authority.commit_rollback(preview, true).unwrap();
    let after = ledger(&authority);
    let state = authority
        .with(|runtime| runtime.snapshot())
        .unwrap()
        .remove(0);
    assert_eq!(state.content_hash, original.content_hash);
    assert_eq!(state.generation, old_state.generation + 1);
    assert_eq!(state.permission_epoch, old_state.permission_epoch + 1);
    assert!(!state.enabled);
    assert_eq!(after["history"], before["history"]);
    for key in ["grants", "network_grants", "sessions", "contexts", "exits"] {
        assert!(after[key].as_object().unwrap().is_empty(), "{key}");
    }
}

#[test]
fn concurrent_confirmation_cannot_replay_a_completed_rollback() {
    let (_directory, authority, identity) = updated_authority();
    let first = authority.preview_rollback(&identity.install_id).unwrap();
    let second = authority.preview_rollback(&identity.install_id).unwrap();
    authority.commit_rollback(first, true).unwrap();
    let after = ledger(&authority);
    assert!(authority.commit_rollback(second, true).is_err());
    assert_eq!(ledger(&authority), after);
}

#[test]
fn update_revoke_and_revocation_revision_invalidate_an_open_confirmation() {
    for action in ["update", "revoke", "revocation-revision"] {
        let (_directory, authority, identity) = updated_authority();
        let preview = authority.preview_rollback(&identity.install_id).unwrap();
        match action {
            "update" => update(&authority),
            "revoke" => authority
                .with(|runtime| runtime.revoke(&identity.install_id))
                .unwrap(),
            _ => PluginStore::open(&authority.path)
                .unwrap()
                .transaction(|value| {
                    value.revocations.sequence += 1;
                    Ok(())
                })
                .unwrap(),
        }
        let before = ledger(&authority);
        assert!(
            authority.commit_rollback(preview, true).is_err(),
            "{action}"
        );
        assert_eq!(ledger(&authority), before, "{action}");
    }
}

#[test]
fn tampered_retained_code_is_reverified_before_preview_and_commit() {
    for before_preview in [false, true] {
        let (_directory, authority, identity) = updated_authority();
        let preview = if before_preview {
            None
        } else {
            Some(authority.preview_rollback(&identity.install_id).unwrap())
        };
        std::fs::write(
            authority
                .package_directory
                .join("code")
                .join(&identity.content_hash),
            b"tampered",
        )
        .unwrap();
        let before = ledger(&authority);
        if let Some(preview) = preview {
            assert!(authority.commit_rollback(preview, true).is_err());
        } else {
            assert!(authority.preview_rollback(&identity.install_id).is_err());
        }
        assert_eq!(ledger(&authority), before);
    }
}

#[test]
fn absent_or_unknown_rollback_does_not_disable_the_current_installation() {
    let directory = Directory::new();
    let mut authority = PluginAuthority::new(directory.0.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = true;
    let preview = authority
        .preview_package(fixture("unsigned-store"))
        .unwrap();
    let identity = authority.commit_preview(&preview.token, consent()).unwrap();
    let before = ledger(&authority);
    for id in [&identity.install_id, "unknown-install"] {
        assert!(authority.preview_rollback(id).is_err());
        assert_eq!(ledger(&authority), before);
    }
}

#[test]
fn expiry_and_cancellation_before_or_during_commit_preserve_the_ledger() {
    use std::sync::atomic::AtomicU64;
    #[derive(Clone)]
    struct ClockValue {
        value: Arc<AtomicU64>,
        expire_during_commit: Arc<std::sync::atomic::AtomicBool>,
        reads: Arc<AtomicUsize>,
    }
    impl Clock for ClockValue {
        fn now_ms(&self) -> u64 {
            if self.expire_during_commit.load(Ordering::SeqCst)
                && self.reads.fetch_add(1, Ordering::SeqCst) > 0
            {
                u64::MAX
            } else {
                self.value.load(Ordering::SeqCst)
            }
        }
    }
    for mode in ["expired", "expire-during", "cancel-before", "cancel-during"] {
        let directory = Directory::new();
        let clock = ClockValue {
            value: Arc::new(AtomicU64::new(1000)),
            expire_during_commit: Arc::default(),
            reads: Arc::default(),
        };
        let mut runtime = Runtime::recover(
            PluginStore::open(&directory.0.join("plugins.sqlite3")).unwrap(),
            clock.clone(),
            Random,
        )
        .unwrap();
        let mut disk = files(&directory);
        let mut identity = None;
        for name in ["unsigned-store", "unsigned-deflate"] {
            let package = disk.stage(fixture(name), || false).unwrap();
            let preview = runtime
                .preview_install(candidate(&package), &policy())
                .unwrap();
            identity = Some(
                runtime
                    .install_package(
                        preview,
                        consent(),
                        &policy(),
                        &mut disk,
                        DataMigration::Copy,
                        || false,
                    )
                    .unwrap(),
            );
        }
        let preview = runtime
            .preview_rollback(&identity.unwrap().install_id, &policy(), &mut disk)
            .unwrap();
        let mut store = PluginStore::open(&directory.0.join("plugins.sqlite3")).unwrap();
        let before = store
            .transaction(|value| Ok(serde_json::to_value(value).unwrap()))
            .unwrap();
        if mode == "expired" {
            clock.value.store(1000 + MAX_LIFETIME_MS, Ordering::SeqCst);
        }
        clock
            .expire_during_commit
            .store(mode == "expire-during", Ordering::SeqCst);
        let calls = AtomicUsize::new(0);
        let result = runtime.rollback_package(preview, &policy(), &mut disk, || {
            mode == "cancel-before"
                || mode == "cancel-during" && calls.fetch_add(1, Ordering::SeqCst) > 0
        });
        assert_eq!(
            result,
            Err(if mode == "expired" || mode == "expire-during" {
                Error::Expired
            } else {
                Error::Denied
            }),
            "{mode}"
        );
        assert_eq!(
            store
                .transaction(|value| Ok(serde_json::to_value(value).unwrap()))
                .unwrap(),
            before,
            "{mode}"
        );
    }
}
