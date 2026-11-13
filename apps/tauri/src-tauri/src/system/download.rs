use crate::{browser::verification::require_main, state::RuntimeState};
use serde::Serialize;
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{State, WebviewWindow};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadReceipt {
    file_name: String,
    size_bytes: u64,
    sha256: String,
}

#[tauri::command]
pub async fn verify_download(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    request_id: String,
    file_name: String,
    size_bytes: u64,
    sha256: String,
) -> Result<bool, String> {
    require_main(&window)?;
    if !valid_file_name(&file_name)
        || size_bytes > 512 * 1024 * 1024
        || sha256.len() != 64
        || !sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || uuid::Uuid::parse_str(&request_id).is_err()
    {
        return Err("下载校验参数无效。".into());
    }
    let cancelled = state.requests.lock().unwrap().begin(&request_id)?;
    let result = async {
        if cancelled.is_cancelled() {
            return Ok(false);
        }
        #[cfg(desktop)]
        {
            let Some(directory) = state.downloads.load(&state.directory)? else {
                return Ok(false);
            };
            tauri::async_runtime::spawn_blocking(move || {
                matches_download(&directory, &file_name, size_bytes, &sha256, &cancelled)
            })
            .await
            .map_err(|_| "下载校验任务失败。".to_owned())
        }
        #[cfg(target_os = "android")]
        {
            super::android::verify_download(window.app_handle(), &file_name, size_bytes, &sha256)
                .await
        }
        #[cfg(target_os = "ios")]
        Ok(false)
    }
    .await;
    state.requests.lock().unwrap().finish(&request_id);
    result
}

#[tauri::command]
pub async fn save_download(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<DownloadReceipt>, String> {
    require_main(&window)?;
    let _ = &state;
    if !valid_file_name(&file_name) || bytes.len() > 512 * 1024 * 1024 {
        return Err("下载文件超过预算或文件名无效。".into());
    }
    #[cfg(target_os = "android")]
    {
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("移动保存超过 32 MiB 预算。".into());
        }
        let app = window.app_handle().clone();
        let receipt = DownloadReceipt {
            file_name: file_name.clone(),
            size_bytes: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        if super::android::verify_download(&app, &file_name, receipt.size_bytes, &receipt.sha256)
            .await?
        {
            return Ok(Some(receipt));
        }
        let destination = super::android::prepare_download(&app, &file_name).await?;
        let Some(token) = destination.token else {
            return Ok(None);
        };
        tauri::async_runtime::spawn_blocking(move || {
            super::android::commit_save(&app, &token, &bytes)
        })
        .await
        .map_err(|_| "保存任务失败。")??;
        Ok(Some(receipt))
    }
    #[cfg(desktop)]
    {
        if let Some(directory) = state.downloads.load(&state.directory)? {
            return tauri::async_runtime::spawn_blocking(move || {
                write_download(&directory, &file_name, &bytes).map(Some)
            })
            .await
            .map_err(|_| "保存任务失败。")?;
        }
        let handle = window.clone();
        let path = tauri::async_runtime::spawn_blocking(move || {
            handle
                .dialog()
                .file()
                .set_file_name(file_name)
                .blocking_save_file()
        })
        .await
        .map_err(|_| "保存窗口异常。")?;
        let Some(path) = path else { return Ok(None) };
        let path = path.into_path().map_err(|_| "此平台不支持当前保存路径。")?;
        let receipt = DownloadReceipt {
            file_name: path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("保存文件名无效。")?
                .to_owned(),
            size_bytes: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        tokio::fs::write(path, bytes)
            .await
            .map_err(|_| "写入下载文件失败。")?;
        Ok(Some(receipt))
    }
    #[cfg(target_os = "ios")]
    Err("此运行端暂不支持保存下载文件。".into())
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 200
        && !matches!(name, "." | "..")
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
}

/// Exclusive creation handles concurrent downloads and keeps existing files intact.
#[cfg(desktop)]
fn write_download(
    directory: &std::path::Path,
    name: &str,
    bytes: &[u8],
) -> Result<DownloadReceipt, String> {
    use std::io::Write;
    // Serialize compare/create/write, so concurrent equal saves never see a half-written file.
    static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITES.lock().unwrap();
    if !valid_file_name(name) || !directory.is_dir() {
        return Err("下载目录不可用，请在设置中重新选择目录。".into());
    }
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("下载文件名无效。")?;
    let extension = path.extension().and_then(|s| s.to_str());
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let cancelled = tokio_util::sync::CancellationToken::new();
    if matches_download(directory, name, bytes.len() as u64, &sha256, &cancelled) {
        return Ok(DownloadReceipt {
            file_name: name.to_owned(),
            size_bytes: bytes.len() as u64,
            sha256,
        });
    }
    for index in 0..1000 {
        let candidate = if index == 0 {
            name.to_owned()
        } else {
            format!(
                "{stem} ({index}){}",
                extension.map(|s| format!(".{s}")).unwrap_or_default()
            )
        };
        let destination = directory.join(&candidate);
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err("写入下载目录失败，请检查目录权限和磁盘空间，或重新选择目录。".into());
            }
        };
        if file.write_all(bytes).and_then(|_| file.sync_all()).is_err() {
            drop(file);
            let _ = std::fs::remove_file(destination);
            return Err("写入下载文件失败，请检查磁盘空间。".into());
        }
        return Ok(DownloadReceipt {
            file_name: candidate,
            size_bytes: bytes.len() as u64,
            sha256,
        });
    }
    Err("下载目录中的同名文件过多，请更换目录或清理后重试。".into())
}

/// Only the requested name is opened. Full streaming hashing keeps memory independent of file size.
#[cfg(desktop)]
fn matches_download(
    directory: &std::path::Path,
    name: &str,
    size: u64,
    sha256: &str,
    cancelled: &tokio_util::sync::CancellationToken,
) -> bool {
    use std::io::Read;
    if !valid_file_name(name) || cancelled.is_cancelled() {
        return false;
    }
    let path = directory.join(name);
    let Ok(metadata) = std::fs::symlink_metadata(&path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != size {
        return false;
    }
    // Windows path lookup ignores case; the actual filename must still match exactly.
    if std::fs::canonicalize(&path)
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_owned()))
        .as_deref()
        != Some(std::ffi::OsStr::new(name))
    {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        if cancelled.is_cancelled() {
            return false;
        }
        let Ok(count) = file.read(&mut buffer) else {
            return false;
        };
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > size {
            return false;
        }
        hasher.update(&buffer[..count]);
    }
    !cancelled.is_cancelled() && total == size && format!("{:x}", hasher.finalize()) == sha256
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(desktop)]
    #[test]
    fn verification_requires_the_exact_name_and_full_content_and_handles_deletion() {
        let root = std::env::temp_dir().join(format!("am-verify-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let bytes = vec![7u8; 150_000];
        let receipt = write_download(&root, "song.mp3", &bytes).unwrap();
        let cancelled = tokio_util::sync::CancellationToken::new();
        assert!(matches_download(
            &root,
            "song.mp3",
            receipt.size_bytes,
            &receipt.sha256,
            &cancelled
        ));
        let mut corrupt = bytes.clone();
        corrupt[149_999] = 8;
        std::fs::write(root.join("song.mp3"), &corrupt).unwrap();
        assert!(!matches_download(
            &root,
            "song.mp3",
            receipt.size_bytes,
            &receipt.sha256,
            &cancelled
        ));
        std::fs::write(root.join("song.mp3"), &bytes).unwrap();
        std::fs::rename(root.join("song.mp3"), root.join("renamed.mp3")).unwrap();
        assert!(!matches_download(
            &root,
            "song.mp3",
            receipt.size_bytes,
            &receipt.sha256,
            &cancelled
        ));
        write_download(&root, "song.mp3", &bytes).unwrap();
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        std::fs::remove_file(root.join("song.mp3")).unwrap();
        assert!(!matches_download(
            &root,
            "song.mp3",
            receipt.size_bytes,
            &receipt.sha256,
            &cancelled
        ));
        write_download(&root, "song.mp3", &bytes).unwrap();
        cancelled.cancel();
        assert!(!matches_download(
            &root,
            "song.mp3",
            receipt.size_bytes,
            &receipt.sha256,
            &cancelled
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(desktop)]
    #[test]
    fn simultaneous_identical_saves_create_only_one_complete_file() {
        let root = std::env::temp_dir().join(format!("am-equal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| write_download(&root, "song.mp3", b"content").unwrap());
            }
        });
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        assert_eq!(std::fs::read(root.join("song.mp3")).unwrap(), b"content");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filenames_cannot_escape_the_selected_directory() {
        for name in [
            "",
            ".",
            "..",
            "../song.mp3",
            "a/b",
            "a\\b",
            "c:song",
            "a\0.mp3",
            "song.",
        ] {
            assert!(!valid_file_name(name), "{name:?}");
        }
        assert!(valid_file_name("歌曲 - 作者.mp3"));
    }

    #[cfg(desktop)]
    #[test]
    fn concurrent_saves_preserve_existing_files_and_reject_missing_directories() {
        let root = std::env::temp_dir().join(format!("am-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("歌曲.mp3"), b"original").unwrap();
        std::thread::scope(|scope| {
            for _ in 0..4 {
                scope.spawn(|| write_download(&root, "歌曲.mp3", b"new").unwrap());
            }
        });
        assert_eq!(std::fs::read(root.join("歌曲.mp3")).unwrap(), b"original");
        for index in 1..=4 {
            assert_eq!(
                std::fs::read(root.join(format!("歌曲 ({index}).mp3"))).unwrap(),
                b"new"
            );
        }
        assert!(write_download(&root.join("missing"), "歌曲.mp3", b"new").is_err());
        assert!(write_download(&root, "../escape.mp3", b"new").is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 5);
        std::fs::remove_dir_all(root).unwrap();
    }
}
