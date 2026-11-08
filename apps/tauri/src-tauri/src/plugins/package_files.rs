//! Private immutable package/data snapshots. File locks serialize separate app processes;
//! SQLite remains the committed pointer authority. No ZIP paths become disk paths.
use am_plugin_package::{MAX_ARCHIVE_BYTES, VerifiedPackage, hash, verify};
use am_plugin_runtime::{Candidate, Error, InstallFiles, Namespace, PackageRecord};
use fs2::FileExt;
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) struct PackageFiles {
    root: PathBuf,
    _lock: File,
    snapshot: Option<VerifiedPackage>,
    pub(super) disk_limit: u64,
}
impl PackageFiles {
    pub fn open(root: PathBuf) -> Result<Self, Error> {
        fs::create_dir_all(&root).map_err(|_| Error::Storage)?;
        plain(&root)?;
        let lock_path = root.join("install.lock");
        if lock_path.exists() {
            plain(&lock_path)?;
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(|_| Error::Storage)?;
        lock.try_lock_exclusive().map_err(|_| Error::Conflict)?;
        for name in ["code", "data", "staging"] {
            let directory = root.join(name);
            fs::create_dir_all(&directory).map_err(|_| Error::Storage)?;
            plain(&directory)?;
        }
        Ok(Self {
            root,
            _lock: lock,
            snapshot: None,
            disk_limit: 256 * 1024 * 1024,
        })
    }
    pub fn stage(
        &mut self,
        bytes: Vec<u8>,
        cancelled: impl Fn() -> bool,
    ) -> Result<VerifiedPackage, Error> {
        let package = verify(bytes, &cancelled).map_err(|error| match error {
            am_plugin_package::Error::Unsupported => Error::Unsupported,
            _ => Error::Corrupt,
        })?;
        if cancelled() {
            return Err(Error::Expired);
        }
        let path = self.path("staging", package.content_hash())?;
        self.write_immutable(&path, package.bytes())?;
        self.snapshot = Some(package.clone());
        Ok(package)
    }
    pub fn use_snapshot(&mut self, package: VerifiedPackage) {
        self.snapshot = Some(package);
    }
    fn path(&self, kind: &str, key: &str) -> Result<PathBuf, Error> {
        if key.len() != 64
            || !key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(Error::Corrupt);
        }
        plain(&self.root)?;
        plain(&self.root.join(kind))?;
        let path = self.root.join(kind).join(key);
        if path.exists() {
            plain(&path)?;
        }
        Ok(path)
    }
    fn read(&self, kind: &str, key: &str, limit: usize) -> Result<Vec<u8>, Error> {
        let path = self.path(kind, key)?;
        let file = File::open(path).map_err(|_| Error::Storage)?;
        if file.metadata().map_err(|_| Error::Storage)?.len() > limit as u64 {
            return Err(Error::Budget);
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::Storage)?;
        if bytes.len() > limit || hash(&bytes) != key {
            return Err(Error::Corrupt);
        }
        Ok(bytes)
    }
    fn write_immutable(&self, path: &Path, bytes: &[u8]) -> Result<(), Error> {
        if path.exists() {
            plain(path)?;
            let existing = File::open(path).map_err(|_| Error::Storage)?;
            let mut old = Vec::new();
            existing
                .take(bytes.len() as u64 + 1)
                .read_to_end(&mut old)
                .map_err(|_| Error::Storage)?;
            return if old == bytes {
                Ok(())
            } else {
                Err(Error::Corrupt)
            };
        }
        let mut used = 0u64;
        for kind in ["code", "data", "staging"] {
            for entry in fs::read_dir(self.root.join(kind)).map_err(|_| Error::Storage)? {
                let entry = entry.map_err(|_| Error::Storage)?;
                plain(&entry.path())?;
                used = used
                    .checked_add(entry.metadata().map_err(|_| Error::Storage)?.len())
                    .ok_or(Error::Budget)?;
                if used.saturating_add(bytes.len() as u64) > self.disk_limit {
                    return Err(Error::Budget);
                }
            }
        }
        let temporary = self
            .root
            .join("staging")
            .join(format!("partial-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| Error::Storage)?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| Error::Storage)?;
            drop(file);
            durable_rename(&temporary, path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}
impl InstallFiles for PackageFiles {
    fn publish_code(&mut self, candidate: &Candidate) -> Result<(), Error> {
        let snapshot = self.snapshot.as_ref().ok_or(Error::Denied)?;
        if snapshot.content_hash() != candidate.package_hash {
            return Err(Error::Conflict);
        }
        // Re-read private staging and verify again before publication; user input is never reopened.
        let bytes = self.read("staging", &candidate.package_hash, MAX_ARCHIVE_BYTES)?;
        verify(bytes.clone(), || false).map_err(|_| Error::Corrupt)?;
        self.write_immutable(&self.path("code", &candidate.package_hash)?, &bytes)
    }
    fn publish_data(&mut self, data: &Namespace) -> Result<String, Error> {
        let bytes = serde_json::to_vec(data).map_err(|_| Error::Corrupt)?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(Error::Budget);
        }
        let key = hash(&bytes);
        self.write_immutable(&self.path("data", &key)?, &bytes)?;
        Ok(key)
    }
    fn verify_pair(&mut self, record: &PackageRecord) -> Result<Vec<u8>, Error> {
        let bytes = self.read("code", &record.candidate.package_hash, MAX_ARCHIVE_BYTES)?;
        let package = verify(bytes, || false).map_err(|_| Error::Corrupt)?;
        if super::packages::candidate(&package) != record.candidate {
            return Err(Error::Corrupt);
        }
        self.load_data(record)?;
        Ok(package.bytes().to_vec())
    }
    fn load_data(&mut self, record: &PackageRecord) -> Result<Namespace, Error> {
        let bytes = self.read("data", &record.data_hash, 2 * 1024 * 1024)?;
        serde_json::from_slice(&bytes).map_err(|_| Error::Corrupt)
    }
    fn gc(&mut self, code: &BTreeSet<String>, data: &BTreeSet<String>) -> Result<(), Error> {
        for (kind, keep) in [("code", code), ("data", data), ("staging", code)] {
            let directory = self.root.join(kind);
            plain(&directory)?;
            for entry in fs::read_dir(directory).map_err(|_| Error::Storage)? {
                let entry = entry.map_err(|_| Error::Storage)?;
                plain(&entry.path())?;
                if !entry.file_type().map_err(|_| Error::Storage)?.is_file() {
                    return Err(Error::Corrupt);
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                // The live preview is a GC root. Cancellation/expiry releases it.
                if !keep.contains(&name)
                    && self
                        .snapshot
                        .as_ref()
                        .is_none_or(|p| p.content_hash() != name)
                {
                    fs::remove_file(entry.path()).map_err(|_| Error::Storage)?;
                }
            }
        }
        Ok(())
    }
}
fn plain(path: &Path) -> Result<(), Error> {
    let metadata = fs::symlink_metadata(path).map_err(|_| Error::Storage)?;
    if metadata.file_type().is_symlink() {
        return Err(Error::Corrupt);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(Error::Corrupt);
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn durable_rename(from: &Path, to: &Path) -> Result<(), Error> {
    fs::rename(from, to).map_err(|_| Error::Storage)?;
    for path in [from.parent(), to.parent()].into_iter().flatten() {
        File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error::Storage)?;
    }
    Ok(())
}
#[cfg(windows)]
fn durable_rename(from: &Path, to: &Path) -> Result<(), Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both live NUL-terminated buffers describe application-generated private paths. No replace
    // flag is used; a content-addressed destination is immutable. Windows flushes the move.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
        return Err(Error::Storage);
    }
    Ok(())
}
