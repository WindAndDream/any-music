use super::*;
use crate::storage::plugins::PluginStore;
use am_plugin_runtime::*;
use base64::Engine;
use std::collections::BTreeSet;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("any-music-s14-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        // This test owns exactly this newly created temporary directory, never a user path.
        if self.0.parent() == Some(std::env::temp_dir().as_path())
            && self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("any-music-s14-")
        {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
struct Time;
impl Clock for Time {
    fn now_ms(&self) -> u64 {
        1000
    }
}
struct Random;
impl Ids for Random {
    fn next_id(&mut self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
}
type Host = Runtime<PluginStore, Time, Random>;
fn host(dir: &Directory) -> Host {
    Runtime::recover(
        PluginStore::open(&dir.0.join("plugins.sqlite3")).unwrap(),
        Time,
        Random,
    )
    .unwrap()
}
fn files(dir: &Directory) -> PackageFiles {
    PackageFiles::open(dir.0.join("packages")).unwrap()
}
fn fixture(name: &str) -> Vec<u8> {
    let corpus: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../../../../packages/plugin-sdk/test/fixtures/packages/corpus.json"
    ))
    .unwrap();
    base64::engine::general_purpose::STANDARD
        .decode(
            corpus.iter().find(|c| c["name"] == name).unwrap()["base64"]
                .as_str()
                .unwrap(),
        )
        .unwrap()
}
#[test]
fn suspension_invalidates_previews_and_late_acquisition_without_erasing_committed_storage() {
    let directory = Directory::new();
    let authority = PluginAuthority::new(directory.0.clone());
    authority
        .preview_package(fixture("unsigned-store"))
        .unwrap();
    let old = authority.acquisition.lock().unwrap().child_token();
    let database = std::fs::read(directory.0.join("plugins.sqlite3")).unwrap();
    authority.suspend_acquisitions();
    assert!(old.is_cancelled());
    assert!(authority.preview.lock().unwrap().is_none());
    assert!(!authority.acquisition.lock().unwrap().is_cancelled());
    assert!(
        authority
            .preview_package_cancellable(fixture("unsigned-store"), &old)
            .is_err()
    );
    assert_eq!(
        std::fs::read(directory.0.join("plugins.sqlite3")).unwrap(),
        database
    );
    assert!(authority.preview_package(fixture("unsigned-store")).is_ok());
}
fn policy() -> InstallPolicy {
    InstallPolicy {
        declarative: true,
        sandbox_code: true,
        capabilities: ["state.read", "state.write", "network.publicHttps"]
            .map(str::to_owned)
            .into(),
    }
}
fn consent() -> InstallConsent {
    InstallConsent {
        capabilities: policy().capabilities,
        pin_publisher: false,
        transfer_data: true,
        read_ceiling: Level::L0,
        user_linked_network: false,
        private_network: false,
    }
}
fn install(runtime: &mut Host, files: &mut PackageFiles, name: &str) -> Identity {
    let package = files.stage(fixture(name), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    runtime
        .install_package(
            preview,
            consent(),
            &policy(),
            files,
            DataMigration::Copy,
            || false,
        )
        .unwrap()
}
struct FaultFiles {
    files: PackageFiles,
    point: InstallPoint,
}
impl InstallFiles for FaultFiles {
    fn publish_code(&mut self, c: &Candidate) -> Result<(), Error> {
        self.files.publish_code(c)
    }
    fn publish_data(&mut self, d: &Namespace) -> Result<String, Error> {
        self.files.publish_data(d)
    }
    fn verify_pair(&mut self, r: &PackageRecord) -> Result<Vec<u8>, Error> {
        self.files.verify_pair(r)
    }
    fn load_data(&mut self, r: &PackageRecord) -> Result<Namespace, Error> {
        self.files.load_data(r)
    }
    fn gc(&mut self, c: &BTreeSet<String>, d: &BTreeSet<String>) -> Result<(), Error> {
        self.files.gc(c, d)
    }
    fn checkpoint(&mut self, p: InstallPoint) -> Result<(), Error> {
        if self.point == p {
            Err(Error::Storage)
        } else {
            Ok(())
        }
    }
}
#[test]
fn every_directory_db_cut_recovers_whole_pair_without_resurrecting_sessions() {
    for point in [
        InstallPoint::Prepared,
        InstallPoint::OldDataDurable,
        InstallPoint::CodeDurable,
        InstallPoint::DataDurable,
        InstallPoint::Published,
        InstallPoint::BeforeCommit,
        InstallPoint::Committed,
    ] {
        let dir = Directory::new();
        let mut runtime = host(&dir);
        let mut disk = files(&dir);
        let old = install(&mut runtime, &mut disk, "unsigned-store");
        let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
        let next_hash = package.content_hash().to_owned();
        let preview = runtime
            .preview_install(candidate(&package), &policy())
            .unwrap();
        let mut broken = FaultFiles { files: disk, point };
        assert!(
            runtime
                .install_package(
                    preview,
                    consent(),
                    &policy(),
                    &mut broken,
                    DataMigration::Copy,
                    || false
                )
                .is_err(),
            "{point:?}"
        );
        drop(broken);
        drop(runtime);
        let mut runtime = host(&dir);
        let mut disk = files(&dir);
        runtime.recover_packages(&mut disk).unwrap();
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(
            snapshot[0].content_hash,
            if point == InstallPoint::Committed {
                next_hash
            } else {
                old.content_hash.clone()
            },
            "{point:?}"
        );
        assert!(snapshot[0].permission_epoch > 1);
        let mut db = PluginStore::open(&dir.0.join("plugins.sqlite3")).unwrap();
        db.transaction(|l| {
            assert!(l.install_journal.is_empty());
            assert!(l.sessions.is_empty());
            let p = &l.packages[&old.install_id];
            disk.verify_pair(p)?;
            assert_eq!(p.identity, l.installs[&old.install_id].identity);
            Ok(())
        })
        .unwrap();
        runtime.gc_packages(&mut disk).unwrap();
    }
}
#[test]
fn source_snapshot_changes_cannot_change_previewed_or_executed_bytes() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let mut user_bytes = fixture("unsigned-store");
    let package = disk.stage(user_bytes.clone(), || false).unwrap();
    let expected = package.content_hash().to_owned();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    user_bytes.fill(0);
    let installed = runtime
        .install_package(
            preview,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false,
        )
        .unwrap();
    assert_eq!(installed.content_hash, expected);
    std::fs::write(dir.0.join("packages/code").join(&expected), b"tampered").unwrap();
    runtime.recover_packages(&mut disk).unwrap();
    assert!(!runtime.snapshot().unwrap()[0].enabled);
}
#[test]
fn revoked_permissions_survive_failed_update_restart_rollback_and_reinstall() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    let mut broken = FaultFiles {
        files: disk,
        point: InstallPoint::BeforeCommit,
    };
    assert!(
        runtime
            .install_package(
                preview,
                consent(),
                &policy(),
                &mut broken,
                DataMigration::Copy,
                || false
            )
            .is_err()
    );
    runtime.revoke(&old.install_id).unwrap();
    let epoch = runtime.snapshot().unwrap()[0].permission_epoch;
    drop(broken);
    drop(runtime);
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    runtime.recover_packages(&mut disk).unwrap();
    assert!(!runtime.snapshot().unwrap()[0].enabled);
    let new = install(&mut runtime, &mut disk, "unsigned-deflate");
    runtime.revoke(&new.install_id).unwrap();
    let rollback = runtime
        .preview_rollback(&new.install_id, &policy(), &mut disk)
        .unwrap();
    runtime
        .rollback_package(rollback, &policy(), &mut disk, || false)
        .unwrap();
    let snapshot = runtime.snapshot().unwrap();
    assert!(!snapshot[0].enabled);
    assert!(snapshot[0].permission_epoch > epoch);
    assert_eq!(snapshot[0].content_hash, old.content_hash);
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    assert_eq!(preview.added_permissions(), vec!["state.write"]);
}
#[test]
fn stale_concurrent_preview_and_cancellation_do_not_replace_active_data() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    assert!(matches!(
        PackageFiles::open(dir.0.join("packages")),
        Err(Error::Conflict)
    ));
    let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
    let a = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    let b = a.clone();
    runtime
        .install_package(
            a,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false,
        )
        .unwrap();
    assert_eq!(
        runtime.install_package(
            b,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false
        ),
        Err(Error::Conflict)
    );
    let package = disk.stage(fixture("unsigned-store"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    let calls = AtomicUsize::new(0);
    assert!(
        runtime
            .install_package(
                preview,
                consent(),
                &policy(),
                &mut disk,
                DataMigration::Copy,
                || calls.fetch_add(1, Ordering::SeqCst) > 0
            )
            .is_err()
    );
    runtime.recover_packages(&mut disk).unwrap();
    assert_ne!(
        runtime.snapshot().unwrap()[0].content_hash,
        old.content_hash
    );
}
#[test]
fn revocation_lists_are_monotonic_and_known_revocations_never_disappear() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    let list = am_plugin_protocol::PackageRevocations {
        version: 1,
        sequence: 2,
        issued_at_ms: 500,
        expires_at_ms: 2000,
        plugin_ids: vec![],
        package_hashes: vec![old.content_hash.clone()],
        publisher_keys: vec![],
    };
    runtime.apply_revocations(list.clone()).unwrap();
    assert!(!runtime.snapshot().unwrap()[0].enabled);
    assert_eq!(runtime.apply_revocations(list.clone()), Err(Error::Replay));
    let mut next = list;
    next.sequence = 3;
    next.package_hashes.clear();
    runtime.apply_revocations(next).unwrap();
    let package = disk.stage(fixture("unsigned-store"), || false).unwrap();
    assert!(
        runtime
            .preview_install(candidate(&package), &policy())
            .is_err()
    );
    runtime.recover_packages(&mut disk).unwrap();
    assert!(!runtime.snapshot().unwrap()[0].enabled);
}
#[test]
fn migration_only_changes_own_copy_and_rollback_restores_matching_data() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    let mut db = PluginStore::open(&dir.0.join("plugins.sqlite3")).unwrap();
    db.transaction(|l| {
        l.namespaces.insert(
            old.install_id.clone(),
            BTreeMap::from([(
                "old".into(),
                StateValue {
                    text: "private".into(),
                    version: 7,
                    schema_version: 1,
                    provenance: Provenance {
                        level: Level::L2,
                        source_install: old.install_id.clone(),
                        source_context: "original".into(),
                        generation: 1,
                        data_generation: 1,
                    },
                },
            )]),
        );
        l.namespaces.insert("other-plugin".into(), BTreeMap::new());
        Ok(())
    })
    .unwrap();
    let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    runtime
        .install_package(
            preview,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Rename {
                from: "old".into(),
                to: "new".into(),
            },
            || false,
        )
        .unwrap();
    db.transaction(|l| {
        assert_eq!(
            l.namespaces[&old.install_id]["new"].provenance.level,
            Level::L2
        );
        assert_eq!(
            l.namespaces[&old.install_id]["new"]
                .provenance
                .data_generation,
            2
        );
        assert!(l.namespaces["other-plugin"].is_empty());
        Ok(())
    })
    .unwrap();
    let rollback = runtime
        .preview_rollback(&old.install_id, &policy(), &mut disk)
        .unwrap();
    runtime
        .rollback_package(rollback, &policy(), &mut disk, || false)
        .unwrap();
    db.transaction(|l| {
        assert!(l.namespaces[&old.install_id].contains_key("old"));
        assert!(!l.namespaces[&old.install_id].contains_key("new"));
        assert!(l.grants.is_empty());
        Ok(())
    })
    .unwrap();
    runtime.uninstall_package(&old.install_id).unwrap();
    runtime.delete_package_data(&old.install_id).unwrap();
    runtime.gc_packages(&mut disk).unwrap();
    db.transaction(|l| {
        assert!(!l.namespaces.contains_key(&old.install_id));
        assert!(!l.history.is_empty());
        Ok(())
    })
    .unwrap();
}
#[test]
fn unsigned_same_version_and_publisher_rotation_need_explicit_data_confirmation() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    install(&mut runtime, &mut disk, "unsigned-store");
    for name in ["unsigned-deflate", "signed-golden"] {
        let package = disk.stage(fixture(name), || false).unwrap();
        let preview = runtime
            .preview_install(candidate(&package), &policy())
            .unwrap();
        assert!(!preview.publisher_verified());
        assert!(!preview.added_permissions().is_empty());
        let mut no = consent();
        no.transfer_data = false;
        assert_eq!(
            runtime.install_package(
                preview,
                no,
                &policy(),
                &mut disk,
                DataMigration::Copy,
                || false
            ),
            Err(Error::Denied)
        );
    }
}
#[test]
fn production_preview_never_enables_or_creates_grants() {
    let dir = Directory::new();
    let mut authority = PluginAuthority::new(dir.0.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = false;
    let preview = authority
        .preview_package(fixture("unsigned-store"))
        .unwrap();
    assert!(!preview.can_install);
    assert!(authority.commit_preview(&preview.token, consent()).is_err());
    assert!(authority.with(|r| r.snapshot()).unwrap().is_empty());
}

#[test]
fn unsupported_optional_capability_versions_do_not_receive_old_version_permissions() {
    let package = am_plugin_package::verify(fixture("unsigned-store"), || false).unwrap();
    let mut manifest = package.manifest().clone();
    manifest.capabilities[0].version = 2;
    let candidate = candidate_from_manifest(&manifest, package.content_hash(), package.signer());
    assert!(candidate.compatible);
    assert!(candidate.capabilities.is_empty());
    manifest.capabilities[0].required = true;
    let candidate = candidate_from_manifest(&manifest, package.content_hash(), package.signer());
    assert!(!candidate.compatible);
    let dir = Directory::new();
    let mut runtime = host(&dir);
    assert!(
        !runtime
            .preview_install(candidate, &policy())
            .unwrap()
            .can_install()
    );
    manifest.capabilities[0].required = false;
    manifest.capabilities[0].version = 1;
    manifest.sdk.minimum = "00.1.0".into();
    assert!(
        !candidate_from_manifest(&manifest, package.content_hash(), package.signer()).compatible
    );
}

#[test]
fn installation_count_exhaustion_never_commits_an_unreadable_ledger() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let mut db = PluginStore::open(&dir.0.join("plugins.sqlite3")).unwrap();
    db.transaction(|ledger| {
        for n in 0..128 {
            let id = format!("retained-{n}");
            ledger.installs.insert(
                id.clone(),
                Install {
                    identity: Identity {
                        install_id: id,
                        plugin_id: format!("retained.plugin-{n}"),
                        content_hash: "a".repeat(64),
                        publisher: "retained".into(),
                        generation: 1,
                        data_generation: 1,
                    },
                    epoch: 1,
                    enabled: false,
                    historical_level: Level::L2,
                },
            );
        }
        Ok(())
    })
    .unwrap();
    let package = disk.stage(fixture("unsigned-store"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    assert_eq!(
        runtime.install_package(
            preview,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false
        ),
        Err(Error::Budget)
    );
    assert_eq!(runtime.snapshot().unwrap().len(), 128);
    db.transaction(|ledger| {
        assert!(ledger.install_journal.is_empty());
        Ok(())
    })
    .unwrap();
}

#[test]
fn disk_full_and_gc_never_delete_current_or_rollback_data() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    disk.disk_limit = 0;
    assert_eq!(
        runtime.install_package(
            preview,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false
        ),
        Err(Error::Budget)
    );
    disk.disk_limit = 256 * 1024 * 1024;
    runtime.recover_packages(&mut disk).unwrap();
    runtime.gc_packages(&mut disk).unwrap();
    assert_eq!(
        runtime.snapshot().unwrap()[0].content_hash,
        old.content_hash
    );
    assert!(dir.0.join("packages/code").join(old.content_hash).exists());
}

fn package_caller() -> Caller {
    Caller {
        channel: "package-channel".into(),
        document: "executor://package".into(),
        account_scope: "local".into(),
    }
}
#[test]
fn each_load_reverifies_bytes_and_cannot_use_the_old_fixture_session_api() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let installed = install(&mut runtime, &mut disk, "unsigned-store");
    assert_eq!(
        runtime.host_session(&installed.install_id, package_caller()),
        Err(Error::Denied)
    );
    assert!(
        runtime
            .host_package_session(
                &installed.install_id,
                package_caller(),
                &mut disk,
                &policy()
            )
            .is_ok()
    );
    std::fs::write(
        dir.0.join("packages/code").join(&installed.content_hash),
        b"tampered",
    )
    .unwrap();
    assert!(
        runtime
            .host_package_session(
                &installed.install_id,
                package_caller(),
                &mut disk,
                &policy()
            )
            .is_err()
    );
}

#[test]
fn failed_committed_load_restores_safe_code_data_pair_with_new_epoch_and_no_grants() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let old = install(&mut runtime, &mut disk, "unsigned-store");
    let new = install(&mut runtime, &mut disk, "unsigned-deflate");
    let epoch = runtime.snapshot().unwrap()[0].permission_epoch;
    std::fs::write(
        dir.0.join("packages/code").join(&new.content_hash),
        b"tampered",
    )
    .unwrap();
    runtime.recover_packages(&mut disk).unwrap();
    let snapshot = runtime.snapshot().unwrap();
    assert_eq!(snapshot[0].content_hash, old.content_hash);
    assert!(!snapshot[0].enabled);
    assert!(snapshot[0].permission_epoch > epoch);
}

#[test]
fn pinned_continuity_inherits_only_live_effective_permissions() {
    let dir = Directory::new();
    let mut runtime = host(&dir);
    let mut disk = files(&dir);
    let package = disk.stage(fixture("signed-golden"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    let mut approval = consent();
    approval.pin_publisher = true;
    approval.capabilities.clear();
    let installed = runtime
        .install_package(
            preview,
            approval,
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false,
        )
        .unwrap();
    let package = disk.stage(fixture("signed-update"), || false).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    assert!(preview.publisher_verified());
    assert_eq!(preview.added_permissions(), vec!["state.write"]);
    runtime
        .install_package(
            preview,
            consent(),
            &policy(),
            &mut disk,
            DataMigration::Copy,
            || false,
        )
        .unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    assert!(preview.added_permissions().is_empty());
    runtime.revoke(&installed.install_id).unwrap();
    let preview = runtime
        .preview_install(candidate(&package), &policy())
        .unwrap();
    assert_eq!(preview.added_permissions(), vec!["state.write"]);
}

struct DbFault {
    store: PluginStore,
    count: Arc<AtomicUsize>,
    fail: Arc<AtomicUsize>,
}
impl Store for DbFault {
    fn transaction<T>(
        &mut self,
        change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let count = self.count.fetch_add(1, Ordering::SeqCst) + 1;
        if count == self.fail.load(Ordering::SeqCst) {
            self.store.fail_before_commit = true;
        }
        let result = self.store.transaction(change);
        self.store.fail_before_commit = false;
        result
    }
}
#[test]
fn sqlite_commit_failures_at_each_transaction_boundary_preserve_a_complete_pair() {
    for cut in 1..=4 {
        let dir = Directory::new();
        let mut initial = host(&dir);
        let mut disk = files(&dir);
        let old = install(&mut initial, &mut disk, "unsigned-store");
        drop(initial);
        let count = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicUsize::new(usize::MAX));
        let mut runtime = Runtime::recover(
            DbFault {
                store: PluginStore::open(&dir.0.join("plugins.sqlite3")).unwrap(),
                count: count.clone(),
                fail: fail.clone(),
            },
            Time,
            Random,
        )
        .unwrap();
        let package = disk.stage(fixture("unsigned-deflate"), || false).unwrap();
        let new_hash = package.content_hash().to_owned();
        let preview = runtime
            .preview_install(candidate(&package), &policy())
            .unwrap();
        fail.store(count.load(Ordering::SeqCst) + cut, Ordering::SeqCst);
        assert!(
            runtime
                .install_package(
                    preview,
                    consent(),
                    &policy(),
                    &mut disk,
                    DataMigration::Copy,
                    || false
                )
                .is_err()
        );
        drop(runtime);
        drop(disk);
        let mut runtime = host(&dir);
        let mut disk = files(&dir);
        runtime.recover_packages(&mut disk).unwrap();
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(
            snapshot[0].content_hash,
            if cut == 4 {
                new_hash
            } else {
                old.content_hash.clone()
            }
        );
    }
}

#[test]
fn stale_confirmation_preserves_the_new_preview_and_terminal_state_tracks_commit() {
    let dir = Directory::new();
    let mut authority = PluginAuthority::new(dir.0.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = true;
    let preview = authority
        .preview_package(fixture("unsigned-store"))
        .unwrap();
    assert!(authority.commit_preview("stale-token", consent()).is_err());
    assert_eq!(
        authority.preview.lock().unwrap().as_ref().unwrap().token,
        preview.token
    );
    assert!(authority.preview_result.lock().unwrap().is_none());
    authority.commit_preview(&preview.token, consent()).unwrap();
    assert_eq!(
        authority.preview_result.lock().unwrap().as_ref(),
        Some(&(preview.token, true))
    );
}

#[path = "rollback_tests.rs"]
mod rollback_tests;
