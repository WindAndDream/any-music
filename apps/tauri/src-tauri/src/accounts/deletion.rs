//! Profile removal is a rename transaction followed by single-concurrency, retryable GC.
//! Tombstones are never account profiles again; a restart retries interrupted cleanup.
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

pub(crate) fn detach(directory: &Path, id: &str) -> Result<(), String> {
    crate::model::validate_id(id)?;
    let vault = directory.join(format!("{id}.vault"));
    for path in [
        &vault,
        &vault.with_extension("pending"),
        &vault.with_extension("previous"),
    ] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("无法移除加密凭证。".into()),
        }
    }
    let profile = directory.join("profiles").join(id);
    let metadata = match std::fs::symlink_metadata(&profile) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("无法检查账号 Profile。".into()),
    };
    let root = directory
        .join("profiles")
        .canonicalize()
        .map_err(|_| "无法检查账号目录。")?;
    let directory = directory.canonicalize().map_err(|_| "无法检查数据目录。")?;
    if root.parent() != Some(directory.as_path()) {
        return Err("拒绝使用数据目录以外的账号目录。".into());
    }
    let checked = profile
        .canonicalize()
        .map_err(|_| "无法检查账号 Profile。")?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || checked.parent() != Some(root.as_path())
    {
        return Err("拒绝清理账号目录以外的 Profile。".into());
    }
    let trash = directory.join("deleted-profiles");
    std::fs::create_dir_all(&trash).map_err(|_| "无法准备账号清理目录。")?;
    let trash = trash.canonicalize().map_err(|_| "无法检查账号清理目录。")?;
    if trash.parent() != Some(directory.as_path()) {
        return Err("拒绝使用数据目录以外的清理目录。".into());
    }
    std::fs::rename(checked, trash.join(uuid::Uuid::new_v4().to_string()))
        .map_err(|_| "账号已停用，但浏览器目录仍被占用，请关闭浏览器后再次删除。".into())
}

pub(crate) fn schedule(directory: PathBuf) {
    #[derive(Default)]
    struct Queue {
        running: bool,
        directories: BTreeSet<PathBuf>,
    }
    static QUEUE: OnceLock<Mutex<Queue>> = OnceLock::new();
    let queue = QUEUE.get_or_init(|| Mutex::new(Queue::default()));
    {
        let mut state = queue.lock().unwrap();
        state.directories.insert(directory);
        if state.running {
            return;
        }
        state.running = true;
    }
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            let directory = {
                let mut state = queue.lock().unwrap();
                let Some(directory) = state.directories.pop_first() else {
                    state.running = false;
                    return;
                };
                directory
            };
            collect(&directory);
        }
    });
}

fn collect(directory: &Path) {
    let Ok(root) = directory.canonicalize() else {
        return;
    };
    let Ok(trash) = directory.join("deleted-profiles").canonicalize() else {
        return;
    };
    if trash.parent() != Some(root.as_path()) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&trash) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let owned = entry
            .file_name()
            .to_str()
            .is_some_and(|id| crate::model::validate_id(id).is_ok());
        if !owned
            || !entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        {
            continue;
        }
        if let Ok(checked) = path.canonicalize()
            && checked.parent() == Some(trash.as_path())
        {
            // Locked files remain as durable tombstones for the next pass/restart.
            let _ = std::fs::remove_dir_all(checked);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detaches_without_walking_profile_and_gc_retries_owned_tombstones_only() {
        let root = std::env::temp_dir().join(format!("am-delete-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        let profile = root.join("profiles").join(&id);
        std::fs::create_dir_all(profile.join("Cache/nested")).unwrap();
        std::fs::write(profile.join("Cache/nested/data"), b"cache").unwrap();
        std::fs::write(root.join(format!("{id}.vault")), b"encrypted").unwrap();
        detach(&root, &id).unwrap();
        assert!(!profile.exists());
        assert!(!root.join(format!("{id}.vault")).exists());
        let tombstone = std::fs::read_dir(root.join("deleted-profiles"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(tombstone.join("Cache/nested/data").exists());
        std::fs::create_dir(root.join("deleted-profiles/unowned")).unwrap();
        collect(&root);
        assert!(!tombstone.exists());
        assert!(root.join("deleted-profiles/unowned").exists());
        assert!(detach(&root, "../escape").is_err());
        detach(&root, &id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
