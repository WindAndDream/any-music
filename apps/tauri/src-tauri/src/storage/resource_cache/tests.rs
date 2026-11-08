use super::*;

fn cache_at(root: &std::path::Path) -> ResourceCache {
    ResourceCache::new(root.to_path_buf(), root.join("cache"))
        .with_test_io_deadline(std::time::Duration::from_secs(30))
}

fn fixture() -> (PathBuf, ResourceCache) {
    let root = std::env::temp_dir().join(format!("am-resource-cache-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let cache = cache_at(&root);
    (root, cache)
}
fn piece(offset: u64, total: u64, bytes: &[u8]) -> Piece {
    Piece {
        bytes: bytes.to_vec(),
        offset,
        total,
        mime: "audio/mp4".into(),
    }
}

#[tokio::test]
async fn memory_hits_bypass_busy_disk_and_preferences_survive_without_bytes() {
    let (root, cache) = fixture();
    cache
        .put(0, "media".into(), "audio", piece(0, 4, b"keep"))
        .await;
    cache.snapshot().await.unwrap();
    let permit = cache.jobs.clone().acquire_owned().await.unwrap();
    assert_eq!(cache.read("media".into(), 0).await.unwrap().bytes, b"keep");
    drop(permit);
    let before = cache.epoch();
    let snapshot = cache.configure_memory(0).await.unwrap();
    assert_eq!(snapshot.memory_used_bytes, 0);
    assert!(
        cache
            .configure_memory(MAX_MEMORY_CAPACITY + 1)
            .await
            .is_err()
    );
    cache
        .put(before, "late".into(), "audio", piece(0, 4, b"late"))
        .await;
    assert!(cache.read("late".into(), 0).await.is_none());
    // The independent disk tier still serves bytes when memory is disabled.
    assert_eq!(cache.read("media".into(), 0).await.unwrap().bytes, b"keep");
    drop(cache);
    let cache = ResourceCache::new(root.clone(), root.join("cache"));
    let snapshot = cache.snapshot().await.unwrap();
    assert_eq!(snapshot.memory_capacity_bytes, 0);
    assert_eq!(snapshot.memory_entry_count, 0);
    cache
        .configure_memory(DEFAULT_MEMORY_CAPACITY)
        .await
        .unwrap();
    assert!(cache.read("media".into(), 0).await.is_some());
    assert!(cache.snapshot().await.unwrap().memory_used_bytes > 0);
    assert_eq!(cache.clear().await.unwrap().memory_used_bytes, 0);
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn overlapping_short_fragment_does_not_hide_a_longer_cached_range() {
    let (root, cache) = fixture();
    cache
        .put(0, "media".into(), "audio", piece(0, 12, b"abcdefghijkl"))
        .await;
    cache
        .put(0, "media".into(), "audio", piece(4, 12, b"ef"))
        .await;
    let found = cache.read("media".into(), 8).await.unwrap();
    assert_eq!(found.offset, 0);
    assert_eq!(&found.bytes[8..], b"ijkl");
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn shrinking_real_capacity_is_bounded_and_failed_eviction_never_commits_preferences() {
    let (root, cache) = fixture();
    let bytes = vec![0; CHUNK_BYTES];
    for index in 0..129 {
        cache
            .put(
                0,
                format!("asset-{index}"),
                "audio",
                piece(0, CHUNK_BYTES as u64, &bytes),
            )
            .await;
        // Settings reads also drain any IO whose hot-path wait timed out under load.
        cache.snapshot().await.unwrap();
    }
    assert!(cache.snapshot().await.unwrap().used_bytes > MIN_CAPACITY);
    cache
        .run(|inner, cache| {
            cache
                .open(inner)?
                .db
                .execute_batch("PRAGMA query_only=ON")
                .map_err(storage_error)?;
            Ok(())
        })
        .await
        .unwrap();
    assert!(cache.configure(MIN_CAPACITY).await.is_err());
    assert_eq!(
        cache.snapshot().await.unwrap().capacity_bytes,
        1024 * 1024 * 1024
    );
    assert!(!root.join("resource-cache.json").exists());
    cache
        .run(|inner, cache| {
            cache
                .open(inner)?
                .db
                .execute_batch("PRAGMA query_only=OFF")
                .map_err(storage_error)?;
            Ok(())
        })
        .await
        .unwrap();
    let snapshot = cache.configure(MIN_CAPACITY).await.unwrap();
    assert!(snapshot.used_bytes <= MIN_CAPACITY);
    assert_eq!(snapshot.capacity_bytes, MIN_CAPACITY);
    cache.clear().await.unwrap();
    assert!(
        std::fs::metadata(root.join("cache/resources-v1.sqlite3"))
            .unwrap()
            .len()
            < 1024 * 1024
    );
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn process_lock_preserves_accounting_and_failed_foreign_destination_keeps_old_cache() {
    let (root, cache) = fixture();
    cache
        .put(0, "old".into(), "audio", piece(0, 4, b"keep"))
        .await;
    cache.snapshot().await.unwrap();
    let other = cache_at(&root);
    assert!(
        other
            .snapshot()
            .await
            .err()
            .unwrap()
            .contains("另一个应用进程")
    );
    #[cfg(desktop)]
    {
        let target = root.join("foreign");
        std::fs::create_dir_all(target.join("AnyMusicCache")).unwrap();
        let db = Connection::open(target.join("AnyMusicCache/resources-v1.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE user_data(value TEXT); INSERT INTO user_data VALUES ('preserve');",
        )
        .unwrap();
        assert!(
            cache
                .set_directory(Some(target))
                .await
                .err()
                .unwrap()
                .contains("不属于 Any Music")
        );
        assert_eq!(
            db.query_row("SELECT value FROM user_data", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "preserve"
        );
        assert_eq!(cache.read("old".into(), 0).await.unwrap().bytes, b"keep");
    }
    drop(cache);
    assert_eq!(other.read("old".into(), 0).await.unwrap().bytes, b"keep");
    drop(other);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn persists_chunks_and_settings_without_urls_and_clear_rejects_late_writes() {
    let (root, cache) = fixture();
    let key = digest(&["audio", "account", "track", "quality"]);
    let epoch = cache.epoch();
    cache
        .put(epoch, key.clone(), "audio", piece(0, 8, b"abcd"))
        .await;
    cache
        .put(epoch, key.clone(), "audio", piece(4, 8, b"efgh"))
        .await;
    assert_eq!(cache.read(key.clone(), 2).await.unwrap().bytes, b"abcd");
    assert_eq!(cache.snapshot().await.unwrap().audio_bytes, 8);
    cache.configure(MIN_CAPACITY).await.unwrap();
    drop(cache);
    let cache = cache_at(&root);
    assert_eq!(cache.snapshot().await.unwrap().capacity_bytes, MIN_CAPACITY);
    assert_eq!(cache.read(key.clone(), 4).await.unwrap().bytes, b"efgh");
    let before_clear = cache.epoch();
    assert_eq!(cache.clear().await.unwrap().used_bytes, 0);
    cache
        .put(before_clear, key.clone(), "audio", piece(0, 8, b"late"))
        .await;
    assert!(cache.read(key.clone(), 0).await.is_none());
    cache
        .put(cache.epoch(), key.clone(), "audio", piece(0, 4, b"new!"))
        .await;
    assert_eq!(cache.read(key, 0).await.unwrap().bytes, b"new!");
    assert!(cache.configure(1024 * 1024).await.is_err());
    assert!(cache.configure(MAX_CAPACITY + 1).await.is_err());
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn bounded_indexed_lru_reclaims_disk_and_replaces_short_probes() {
    let (root, cache) = fixture();
    // This test mutates disk timestamps directly; exercise that tier without memory hits.
    cache.configure_memory(0).await.unwrap();
    let epoch = cache.epoch();
    cache
        .put(epoch, "probe".into(), "audio", piece(0, 8, b"ab"))
        .await;
    cache
        .put(epoch, "probe".into(), "audio", piece(0, 8, b"abcdefgh"))
        .await;
    assert_eq!(
        cache.read("probe".into(), 4).await.unwrap().bytes,
        b"abcdefgh"
    );
    cache
        .run(|inner, cache| {
            let opened = cache.open(inner)?;
            opened.trim(0, 0)?;
            assert_eq!(opened.used, 0);
            Ok(())
        })
        .await
        .unwrap();
    cache
        .put(epoch, "old".into(), "audio", piece(0, 4, b"old!"))
        .await;
    cache
        .put(epoch, "new".into(), "image", piece(0, 4, b"new!"))
        .await;
    cache
        .run(|inner, cache| {
            let opened = cache.open(inner)?;
            opened
                .db
                .execute("UPDATE resources SET touched=1 WHERE key='old'", [])
                .unwrap();
            opened.trim(4 + ENTRY_OVERHEAD, 0)?;
            Ok(())
        })
        .await
        .unwrap();
    assert!(cache.read("old".into(), 0).await.is_none());
    assert!(cache.read("new".into(), 0).await.is_some());
    cache
        .run(|inner, cache| {
            cache
                .open(inner)?
                .db
                .execute("UPDATE resources SET expires=0", [])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
        .unwrap();
    assert!(cache.read("new".into(), 0).await.is_none());
    cache
        .put(cache.epoch(), "new".into(), "image", piece(0, 4, b"fresh"))
        .await;
    // The invalid overlong response is rejected, then an expired row can be replaced.
    cache
        .put(cache.epoch(), "new".into(), "image", piece(0, 4, b"new!"))
        .await;
    assert_eq!(cache.read("new".into(), 0).await.unwrap().bytes, b"new!");
    let before = std::fs::metadata(root.join("cache/resources-v1.sqlite3"))
        .unwrap()
        .len();
    cache.clear().await.unwrap();
    assert!(
        std::fs::metadata(root.join("cache/resources-v1.sqlite3"))
            .unwrap()
            .len()
            <= before
    );
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn rejects_invalid_chunks_and_busy_disk_without_queueing_and_retries_failed_open() {
    let (root, cache) = fixture();
    std::fs::write(root.join("cache"), b"file instead of directory").unwrap();
    assert!(cache.read("a".into(), 0).await.is_none());
    std::fs::remove_file(root.join("cache")).unwrap();
    cache
        .put(0, "a".into(), "audio", piece(0, 2, b"toolong"))
        .await;
    assert!(cache.read("a".into(), 0).await.is_none());
    let permit = cache.jobs.clone().acquire_owned().await.unwrap();
    assert!(cache.read("busy".into(), 0).await.is_none());
    cache
        .put(0, "busy".into(), "audio", piece(0, 4, b"skip"))
        .await;
    drop(permit);
    cache
        .put(0, "a".into(), "audio", piece(0, 4, b"okay"))
        .await;
    assert_eq!(cache.read("a".into(), 0).await.unwrap().bytes, b"okay");
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(desktop)]
#[tokio::test]
async fn directory_switch_only_clears_owned_database_and_survives_restart() {
    let (root, cache) = fixture();
    let chosen = root.join("chosen");
    std::fs::create_dir_all(&chosen).unwrap();
    let unrelated = chosen.join("music.mp3");
    std::fs::write(&unrelated, b"keep").unwrap();
    cache
        .put(0, "a".into(), "audio", piece(0, 4, b"test"))
        .await;
    let snapshot = cache.set_directory(Some(chosen.clone())).await.unwrap();
    assert!(snapshot.custom_directory);
    assert_eq!(snapshot.used_bytes, 0);
    assert!(unrelated.exists());
    cache
        .put(cache.epoch(), "b".into(), "audio", piece(0, 4, b"test"))
        .await;
    drop(cache);
    let cache = cache_at(&root);
    assert!(cache.read("b".into(), 0).await.is_some());
    cache.set_directory(None).await.unwrap();
    assert_eq!(std::fs::read(unrelated).unwrap(), b"keep");
    assert!(cache.read("a".into(), 0).await.is_none());
    drop(cache);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn timed_out_hot_operations_keep_the_worker_permit_and_skip_later_requests() {
    for operation in ["read", "covers", "put"] {
        let (root, fixture_cache) = fixture();
        drop(fixture_cache);
        let cache = ResourceCache::new(root.clone(), root.join("cache"));
        assert_eq!(
            cache.hot_io_deadline(),
            std::time::Duration::from_millis(100)
        );
        cache
            .put(0, "seed".into(), "audio", piece(0, 4, b"seed"))
            .await;
        // A settings operation drains even a seed write whose caller timed out.
        assert_eq!(cache.snapshot().await.unwrap().audio_bytes, 4);
        // Exercise disk admission even when the develop branch's memory tier is warm.
        cache.memory.lock().unwrap().configure(0);

        let inner = cache.inner.clone();
        let (locked, ready) = tokio::sync::oneshot::channel();
        let (release, released) = std::sync::mpsc::channel();
        let blocker = std::thread::spawn(move || {
            let _guard = inner.lock().unwrap();
            let _ = locked.send(());
            // Dropping the sender also releases this gate if an assertion panics.
            let _ = released.recv();
        });
        ready.await.unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            match operation {
                "read" => assert!(cache.read("seed".into(), 0).await.is_none()),
                "covers" => assert!(!cache.covers("seed".into(), 0, 3).await),
                "put" => {
                    cache
                        .put(0, "late".into(), "audio", piece(0, 4, b"late"))
                        .await
                }
                _ => unreachable!(),
            }
            // A timed-out caller cannot release admission while blocking IO is alive.
            assert_eq!(cache.jobs.available_permits(), 0);
            assert!(cache.read("seed".into(), 0).await.is_none());
            assert!(!cache.covers("seed".into(), 0, 3).await);
            cache
                .put(0, "skipped".into(), "audio", piece(0, 4, b"skip"))
                .await;
        })
        .await;
        release.send(()).unwrap();
        blocker.join().unwrap();
        result.expect("Hot cache operations must return while disk IO is blocked");

        let snapshot = cache.snapshot().await.unwrap();
        // Only the admitted write may finish late; requests arriving while busy never queue.
        assert_eq!(snapshot.entry_count, if operation == "put" { 2 } else { 1 });
        assert_eq!(snapshot.audio_bytes, if operation == "put" { 8 } else { 4 });
        cache.clear().await.unwrap();
        drop(cache);
        std::fs::remove_dir_all(root).unwrap();
    }
}
