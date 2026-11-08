//! Disposable, bounded resource bytes. No URLs, credentials or product records enter this DB.
//! Indexed lookups/LRU and fixed-size chunks bound both memory and disk work per request.
mod memory;
#[cfg(test)]
mod tests;
use memory::MemoryCache;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;

pub const CHUNK_BYTES: usize = 1024 * 1024;
pub const MIN_CAPACITY: u64 = 128 * 1024 * 1024;
pub const MAX_CAPACITY: u64 = 100 * 1024 * 1024 * 1024;
const DEFAULT_MEMORY_CAPACITY: u64 = 64 * 1024 * 1024;
const MAX_MEMORY_CAPACITY: u64 = 1024 * 1024 * 1024;
fn default_memory_capacity() -> u64 {
    DEFAULT_MEMORY_CAPACITY
}
const MAX_ENTRIES: u64 = 32_768;
const ENTRY_OVERHEAD: u64 = 1024;
const TTL_SECONDS: u64 = 7 * 24 * 3600;
const HOT_IO_DEADLINE: std::time::Duration = std::time::Duration::from_millis(100);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    capacity_bytes: u64,
    #[serde(default = "default_memory_capacity")]
    memory_capacity_bytes: u64,
    directory: Option<PathBuf>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            capacity_bytes: 1024 * 1024 * 1024,
            memory_capacity_bytes: DEFAULT_MEMORY_CAPACITY,
            directory: None,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSnapshot {
    capacity_bytes: u64,
    used_bytes: u64,
    image_bytes: u64,
    audio_bytes: u64,
    entry_count: u64,
    memory_capacity_bytes: u64,
    memory_used_bytes: u64,
    memory_entry_count: u64,
    directory: String,
    custom_directory: bool,
    can_choose_directory: bool,
}
#[derive(Clone)]
pub struct Piece {
    pub bytes: Vec<u8>,
    pub offset: u64,
    pub total: u64,
    pub mime: String,
}
struct OpenCache {
    db: Connection,
    path: PathBuf,
    used: u64,
    count: u64,
    _lock: std::fs::File,
}
struct Inner {
    preferences: Preferences,
    open: Option<OpenCache>,
}
#[derive(Clone)]
pub struct ResourceCache {
    inner: Arc<Mutex<Inner>>,
    memory: Arc<Mutex<MemoryCache>>,
    jobs: Arc<Semaphore>,
    deferred_writes: Arc<Semaphore>,
    epoch: Arc<AtomicU64>,
    settings_directory: PathBuf,
    default_directory: PathBuf,
    #[cfg(test)]
    test_io_deadline: std::time::Duration,
}

pub fn digest(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn storage_error(error: impl std::fmt::Display) -> String {
    format!("storage-write-failed:缓存存储不可用：{error}")
}
fn validate_capacity(capacity: u64) -> Result<(), String> {
    if !(MIN_CAPACITY..=MAX_CAPACITY).contains(&capacity) {
        return Err("invalid-input:缓存容量必须在 128 MiB 至 100 GiB 之间。".into());
    }
    Ok(())
}
impl ResourceCache {
    pub fn new(settings_directory: PathBuf, default_directory: PathBuf) -> Self {
        Self {
            settings_directory,
            default_directory,
            #[cfg(test)]
            test_io_deadline: HOT_IO_DEADLINE,
            epoch: Arc::default(),
            jobs: Arc::new(Semaphore::new(1)),
            deferred_writes: Arc::new(Semaphore::new(4)),
            inner: Arc::new(Mutex::new(Inner {
                preferences: Preferences::default(),
                open: None,
            })),
            memory: Arc::default(),
        }
    }
    fn hot_io_deadline(&self) -> std::time::Duration {
        #[cfg(test)]
        {
            self.test_io_deadline
        }
        #[cfg(not(test))]
        {
            HOT_IO_DEADLINE
        }
    }
    /// Content/stream tests wait for real disk work independently of CI disk speed.
    /// Deadline/busy-worker tests keep the production budget and control the worker.
    #[cfg(test)]
    pub(crate) fn with_test_io_deadline(mut self, deadline: std::time::Duration) -> Self {
        self.test_io_deadline = deadline;
        self
    }
    /// Settings operations wait; hot-path cache operations bypass a busy disk instead of queueing.
    async fn run<R: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Inner, &Self) -> Result<R, String> + Send + 'static,
    ) -> Result<R, String> {
        let permit = self
            .jobs
            .clone()
            .acquire_owned()
            .await
            .map_err(storage_error)?;
        let cache = self.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            work(&mut cache.inner.lock().unwrap(), &cache)
        })
        .await
        .map_err(storage_error)?
    }
    fn open<'a>(&self, inner: &'a mut Inner) -> Result<&'a mut OpenCache, String> {
        if inner.open.is_none() {
            let settings = self.settings_directory.join("resource-cache.json");
            crate::storage::vault::recover_atomic(&settings)?;
            if settings.exists() {
                inner.preferences =
                    serde_json::from_slice(&std::fs::read(settings).map_err(storage_error)?)
                        .map_err(storage_error)?;
            }
            validate_capacity(inner.preferences.capacity_bytes)?;
            if inner.preferences.memory_capacity_bytes > MAX_MEMORY_CAPACITY {
                return Err("invalid-input:内存缓存容量必须在 0 至 1024 MiB 之间。".into());
            }
            if inner
                .preferences
                .directory
                .as_ref()
                .is_some_and(|p| !p.is_absolute())
            {
                return Err("invalid-input:缓存目录无效。".into());
            }
            let directory = inner
                .preferences
                .directory
                .as_ref()
                .unwrap_or(&self.default_directory);
            inner.open = Some(OpenCache::open(
                directory,
                inner.preferences.capacity_bytes,
            )?);
            self.memory
                .lock()
                .unwrap()
                .configure(inner.preferences.memory_capacity_bytes);
        }
        Ok(inner.open.as_mut().unwrap())
    }
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }
    #[cfg(test)]
    pub async fn covers(&self, key: String, start: u64, end: u64) -> bool {
        if start > end || end > i64::MAX as u64 {
            return false;
        }
        let Ok(permit) = self.jobs.clone().try_acquire_owned() else {
            return false;
        };
        let cache = self.clone();
        let job = tokio::task::spawn_blocking(move || -> Result<bool, String> {
            let _permit = permit;
            let mut inner = cache.inner.lock().unwrap();
            let opened = cache.open(&mut inner)?;
            let mut statement=opened.db.prepare(
                "SELECT offset,length(body) FROM resources WHERE key=?1 AND expires>?2 AND offset<=?3 ORDER BY offset"
            ).map_err(storage_error)?;
            let rows = statement
                .query_map(params![key, now(), end], |r| {
                    Ok((r.get::<_, u64>(0)?, r.get::<_, u64>(1)?))
                })
                .map_err(storage_error)?;
            let mut cursor = start;
            for row in rows {
                let (offset, length) = row.map_err(storage_error)?;
                if offset > cursor {
                    return Ok(false);
                }
                cursor = cursor.max(offset + length);
                if cursor > end {
                    return Ok(true);
                }
            }
            Ok(false)
        });
        matches!(
            tokio::time::timeout(self.hot_io_deadline(), job).await,
            Ok(Ok(Ok(true)))
        )
    }
    pub async fn read(&self, key: String, offset: u64) -> Option<Piece> {
        if offset > i64::MAX as u64 {
            return None;
        }
        if let Some(piece) = self.memory.lock().unwrap().read(&key, offset) {
            return Some(piece);
        }
        let epoch = self.epoch();
        let permit = self.jobs.clone().try_acquire_owned().ok()?;
        let cache = self.clone();
        let job = tokio::task::spawn_blocking(move || -> Result<Option<Piece>, String> {
            let _permit = permit;
            let mut inner = cache.inner.lock().unwrap();
            let opened = cache.open(&mut inner)?;
            let piece = opened.db.query_row(
                "SELECT offset,total,mime,body,expires FROM resources WHERE key=?1 AND offset<=?2 AND offset+length(body)>?2 AND expires>?3 ORDER BY offset DESC LIMIT 1",
                params![key, offset, now()],
                |r| Ok((Piece { offset: r.get(0)?, total: r.get(1)?, mime: r.get(2)?, bytes: r.get(3)? }, r.get::<_, u64>(4)?))
            ).optional().map_err(storage_error)?;
            let piece = piece.filter(|(p, _)| p.offset + p.bytes.len() as u64 > offset);
            if let Some((p, expires)) = &piece {
                // Coalesce hot accesses to one index update per minute per chunk.
                opened.db.execute("UPDATE resources SET touched=?3 WHERE key=?1 AND offset=?2 AND touched<?3-60", params![key, p.offset, now()]).map_err(storage_error)?;
                if cache.epoch() == epoch {
                    cache.memory.lock().unwrap().put(&key, p, *expires);
                }
            }
            Ok(piece.map(|(p, _)| p))
        });
        tokio::time::timeout(self.hot_io_deadline(), job)
            .await
            .ok()?
            .ok()?
            .ok()?
    }
    #[cfg(test)]
    pub async fn put(&self, epoch: u64, key: String, kind: &'static str, piece: Piece) {
        self.put_inner(epoch, key, kind, piece, false).await;
    }
    pub fn reserve_deferred_write(&self) -> Option<tokio::sync::OwnedSemaphorePermit> {
        self.deferred_writes.clone().try_acquire_owned().ok()
    }
    #[cfg(test)]
    pub async fn wait_deferred_writes(&self) {
        let _permit = self
            .deferred_writes
            .clone()
            .acquire_many_owned(4)
            .await
            .unwrap();
    }
    pub async fn put_deferred(&self, epoch: u64, key: String, kind: &'static str, piece: Piece) {
        self.put_inner(epoch, key, kind, piece, true).await;
    }
    async fn put_inner(
        &self,
        epoch: u64,
        key: String,
        kind: &'static str,
        piece: Piece,
        wait: bool,
    ) {
        if piece.bytes.is_empty()
            || piece.bytes.len() > CHUNK_BYTES
            || piece
                .offset
                .checked_add(piece.bytes.len() as u64)
                .is_none_or(|end| end > piece.total)
            || piece.total > i64::MAX as u64
            || piece.mime.len() > 128
        {
            return;
        }
        let permit = if wait {
            match tokio::time::timeout(HOT_IO_DEADLINE, self.jobs.clone().acquire_owned()).await {
                Ok(Ok(permit)) => permit,
                _ => return,
            }
        } else {
            let Ok(permit) = self.jobs.clone().try_acquire_owned() else {
                return;
            };
            permit
        };
        let cache = self.clone();
        let job = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let _permit = permit;
            let mut inner = cache.inner.lock().unwrap();
            if cache.epoch() != epoch {
                return Ok(());
            }
            cache.open(&mut inner)?;
            let capacity = inner.preferences.capacity_bytes;
            let opened = inner.open.as_mut().unwrap();
            // Replacing a representation invalidates every old segment before publishing bytes.
            let old_total: Option<u64> = opened
                .db
                .query_row(
                    "SELECT total FROM resources WHERE key=?1 LIMIT 1",
                    [&key],
                    |r| r.get(0),
                )
                .optional()
                .map_err(storage_error)?;
            if old_total.is_some_and(|total| total != piece.total) {
                cache.memory.lock().unwrap().invalidate(&key);
                opened.remove_key(&key)?;
            }
            let existing: Option<(u64, u64)> = opened
                .db
                .query_row(
                    "SELECT length(body),expires FROM resources WHERE key=?1 AND offset=?2",
                    params![key, piece.offset],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(storage_error)?;
            if let Some((length, expires)) = existing {
                if expires > now() && length >= piece.bytes.len() as u64 {
                    return Ok(());
                }
                opened
                    .db
                    .execute(
                        "DELETE FROM resources WHERE key=?1 AND offset=?2",
                        params![key, piece.offset],
                    )
                    .map_err(storage_error)?;
                opened.used -= length + ENTRY_OVERHEAD;
                opened.count -= 1;
            }
            let charge = piece.bytes.len() as u64 + ENTRY_OVERHEAD;
            opened.trim(capacity, charge)?;
            opened
                .db
                .execute(
                    "INSERT INTO resources VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        key,
                        piece.offset,
                        piece.total,
                        piece.mime,
                        kind,
                        now(),
                        now() + TTL_SECONDS,
                        piece.bytes
                    ],
                )
                .map_err(storage_error)?;
            opened.used += charge;
            opened.count += 1;
            cache
                .memory
                .lock()
                .unwrap()
                .put(&key, &piece, now() + TTL_SECONDS);
            Ok(())
        });
        // A disconnected custom volume cannot stall playback indefinitely. The worker
        // retains its permit until IO finishes, even when this best-effort wait expires.
        let _ = tokio::time::timeout(self.hot_io_deadline(), job).await;
    }
    pub async fn snapshot(&self) -> Result<CacheSnapshot, String> {
        self.run(|inner, cache| cache.snapshot_inner(inner)).await
    }
    fn snapshot_inner(&self, inner: &mut Inner) -> Result<CacheSnapshot, String> {
        self.open(inner)?;
        let opened = inner.open.as_mut().unwrap();
        let (image, audio) = opened.db.query_row("SELECT COALESCE(SUM(CASE WHEN kind='image' THEN length(body) ELSE 0 END),0),COALESCE(SUM(CASE WHEN kind='audio' THEN length(body) ELSE 0 END),0) FROM resources", [], |r| Ok((r.get(0)?, r.get(1)?))).map_err(storage_error)?;
        let (memory_used_bytes, memory_entry_count) = {
            let memory = self.memory.lock().unwrap();
            (memory.used, memory.count())
        };
        let snapshot = CacheSnapshot {
            capacity_bytes: inner.preferences.capacity_bytes,
            used_bytes: opened.used,
            image_bytes: image,
            audio_bytes: audio,
            entry_count: opened.count,
            memory_capacity_bytes: inner.preferences.memory_capacity_bytes,
            memory_used_bytes,
            memory_entry_count,
            directory: opened
                .path
                .parent()
                .unwrap()
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .into(),
            custom_directory: inner.preferences.directory.is_some(),
            can_choose_directory: cfg!(desktop),
        };
        Ok(snapshot)
    }
    pub async fn configure(&self, capacity: u64) -> Result<CacheSnapshot, String> {
        validate_capacity(capacity)?;
        self.run(move |inner, cache| {
            cache.open(inner)?;
            let mut next = inner.preferences.clone();
            next.capacity_bytes = capacity;
            cache.epoch.fetch_add(1, Ordering::AcqRel);
            cache.open(inner)?.trim(capacity, 0)?;
            cache.save(&next)?;
            inner.preferences = next;
            cache.snapshot_inner(inner)
        })
        .await
    }
    pub async fn configure_memory(&self, capacity: u64) -> Result<CacheSnapshot, String> {
        if capacity > MAX_MEMORY_CAPACITY {
            return Err("invalid-input:内存缓存容量必须在 0 至 1024 MiB 之间。".into());
        }
        self.run(move |inner, cache| {
            cache.open(inner)?;
            let mut next = inner.preferences.clone();
            next.memory_capacity_bytes = capacity;
            cache.save(&next)?;
            cache.epoch.fetch_add(1, Ordering::AcqRel);
            cache.memory.lock().unwrap().configure(capacity);
            inner.preferences = next;
            cache.snapshot_inner(inner)
        })
        .await
    }
    fn save(&self, preferences: &Preferences) -> Result<(), String> {
        crate::storage::vault::write_atomic(
            &self.settings_directory.join("resource-cache.json"),
            &serde_json::to_vec(preferences).map_err(storage_error)?,
        )
    }
    pub async fn clear(&self) -> Result<CacheSnapshot, String> {
        self.run(|inner, cache| {
            cache.epoch.fetch_add(1, Ordering::AcqRel);
            cache.memory.lock().unwrap().clear();
            cache.open(inner)?;
            let opened = inner.open.take().unwrap();
            inner.open = Some(opened.reset(inner.preferences.capacity_bytes)?);
            cache.snapshot_inner(inner)
        })
        .await
    }
    /// The selected parent only receives our dedicated child directory. Never recursively delete
    /// user folders. A path switch drops old disposable bytes before committing the preference.
    #[cfg(desktop)]
    pub async fn set_directory(&self, parent: Option<PathBuf>) -> Result<CacheSnapshot, String> {
        self.run(move |inner, cache| {
            cache.open(inner)?;
            let directory = parent.map(|p| p.join("AnyMusicCache"));
            if directory == inner.preferences.directory {
                return cache.snapshot_inner(inner);
            }
            let target = directory.as_ref().unwrap_or(&cache.default_directory);
            std::fs::create_dir_all(target).map_err(storage_error)?;
            // Validate the destination and acquire its process lock before clearing anything.
            let replacement = OpenCache::open(target, inner.preferences.capacity_bytes)?;
            let mut next = inner.preferences.clone();
            next.directory = directory;
            cache.epoch.fetch_add(1, Ordering::AcqRel);
            cache.memory.lock().unwrap().clear();
            // Only our own DB contents are removed, including during a directory switch.
            if let Some(opened) = inner.open.take() {
                inner.open = Some(opened.reset(inner.preferences.capacity_bytes)?);
            }
            cache.save(&next)?;
            inner.open = Some(replacement);
            inner.preferences = next;
            cache.snapshot_inner(inner)
        })
        .await
    }
}
impl OpenCache {
    fn open(directory: &std::path::Path, capacity: u64) -> Result<Self, String> {
        std::fs::create_dir_all(directory).map_err(storage_error)?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("resources-v1.lock"))
            .map_err(storage_error)?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| "storage-write-failed:缓存目录正在被另一个应用进程使用。")?;
        let path = directory.join("resources-v1.sqlite3");
        Self::open_locked(path, lock, capacity)
    }
    fn reset(self, capacity: u64) -> Result<Self, String> {
        let Self {
            db, path, _lock, ..
        } = self;
        drop(db);
        // Keep the process lock while removing one owned DB. Clearing requires no
        // rollback journal or second copy, including when the volume is nearly full.
        std::fs::remove_file(&path).map_err(storage_error)?;
        Self::open_locked(path, _lock, capacity)
    }
    fn open_locked(path: PathBuf, lock: std::fs::File, capacity: u64) -> Result<Self, String> {
        let existing = path.exists();
        let db = Connection::open(&path).map_err(storage_error)?;
        let application_id: i64 = db
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .map_err(storage_error)?;
        if existing && application_id != 0x414d4348 {
            return Err("storage-write-failed:该缓存文件不属于 Any Music，已保留原文件。".into());
        }
        db.busy_timeout(std::time::Duration::from_millis(250))
            .map_err(storage_error)?;
        // FULL auto-vacuum releases pages at commit; small transactions bound journal growth.
        db.execute_batch("PRAGMA application_id=1095582536; PRAGMA auto_vacuum=FULL; PRAGMA journal_mode=DELETE; PRAGMA cache_size=-2048; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS resources (key TEXT NOT NULL, offset INTEGER NOT NULL, total INTEGER NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, touched INTEGER NOT NULL, expires INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(key,offset));
            CREATE INDEX IF NOT EXISTS resource_lru ON resources(touched);
            CREATE INDEX IF NOT EXISTS resource_expiry ON resources(expires);").map_err(storage_error)?;
        let (used, count) = db
            .query_row(
                "SELECT COALESCE(SUM(length(body)+1024),0),COUNT(*) FROM resources",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(storage_error)?;
        let mut opened = Self {
            _lock: lock,
            db,
            path,
            used,
            count,
        };
        opened.trim(capacity, 0)?;
        Ok(opened)
    }
    fn remove_key(&mut self, key: &str) -> Result<(), String> {
        let (charge, count): (u64, u64) = self
            .db
            .query_row(
                "SELECT COALESCE(SUM(length(body)+1024),0),COUNT(*) FROM resources WHERE key=?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(storage_error)?;
        self.db
            .execute("DELETE FROM resources WHERE key=?1", [key])
            .map_err(storage_error)?;
        self.used -= charge;
        self.count -= count;
        Ok(())
    }
    fn trim(&mut self, capacity: u64, extra: u64) -> Result<(), String> {
        while self.used + extra > capacity || self.count >= MAX_ENTRIES {
            // Up to 32 MiB per transaction bounds rollback scratch space while avoiding
            // thousands of fsync/auto-vacuum cycles when reducing a populated cache.
            let candidates = self
                .db
                .prepare(
                    "SELECT rowid,length(body)+1024 FROM resources ORDER BY touched,rowid LIMIT 32",
                )
                .map_err(storage_error)?
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u64>(1)?)))
                .map_err(storage_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(storage_error)?;
            let transaction = self.db.transaction().map_err(storage_error)?;
            let (mut used, mut count) = (self.used, self.count);
            for (rowid, charge) in candidates {
                if used + extra <= capacity && count < MAX_ENTRIES {
                    break;
                }
                transaction
                    .execute("DELETE FROM resources WHERE rowid=?1", [rowid])
                    .map_err(storage_error)?;
                used -= charge;
                count -= 1;
            }
            transaction.commit().map_err(storage_error)?;
            self.used = used;
            self.count = count;
        }
        Ok(())
    }
}
