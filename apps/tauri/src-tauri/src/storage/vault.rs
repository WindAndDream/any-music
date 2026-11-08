#[cfg(not(target_os = "android"))]
use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
    ChaCha20Poly1305, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use std::io::Write;
use std::path::Path;

pub fn load_key() -> Result<[u8; 32], String> {
    #[cfg(target_os = "android")]
    {
        Err("Android 凭证持久化需要原生 Keystore 适配，当前不可用。".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let entry = keyring::Entry::new("com.anymusic.native", "credential-encryption-key")
            .map_err(|_| "系统密钥保险库不可用。")?;
        match entry.get_password() {
            Ok(value) => STANDARD
                .decode(value)
                .map_err(|_| "系统密钥损坏。")?
                .try_into()
                .map_err(|_| "系统密钥长度错误。".into()),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0; 32];
                rand::thread_rng().fill_bytes(&mut key);
                entry
                    .set_password(&STANDARD.encode(key))
                    .map_err(|_| "无法保存系统密钥；不会退回明文存储。")?;
                Ok(key)
            }
            Err(_) => Err("无法读取系统密钥保险库。".into()),
        }
    }
}

pub fn seal(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(key.into());
    let mut nonce = [0; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "凭证加密失败。")?;
    Ok([nonce.to_vec(), encrypted].concat())
}
pub fn open(key: &[u8; 32], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 28 {
        return Err("加密凭证损坏。".into());
    }
    ChaCha20Poly1305::new(key.into())
        .decrypt(Nonce::from_slice(&encrypted[..12]), &encrypted[12..])
        .map_err(|_| "凭证认证失败。".into())
}
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    recover_atomic(path)?;
    let temporary = path.with_extension("pending");
    let mut file = std::fs::File::create(&temporary).map_err(|_| "无法写入本地数据。")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法写入本地数据。")?;
    drop(file);
    // Windows rename does not replace an existing file; retain a recovery copy until replacement succeeds.
    let backup = path.with_extension("previous");
    if path.exists() {
        std::fs::rename(path, &backup).map_err(|_| "无法备份本地数据。")?;
    }
    if std::fs::rename(&temporary, path).is_err() {
        if backup.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        return Err("无法提交本地数据。".into());
    }
    if backup.exists() {
        let _ = std::fs::remove_file(backup);
    }
    Ok(())
}
pub fn recover_atomic(path: &Path) -> Result<(), String> {
    let backup = path.with_extension("previous");
    if !path.exists() && backup.exists() {
        std::fs::rename(&backup, path).map_err(|_| "无法恢复上次本地写入。")?;
    }
    if path.exists() && backup.exists() {
        std::fs::remove_file(backup).map_err(|_| "无法清理本地恢复记录。")?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encryption_authenticates_and_uses_fresh_nonces() {
        let a = seal(&[1; 32], b"secret").unwrap();
        let b = seal(&[1; 32], b"secret").unwrap();
        assert_ne!(a, b);
        assert_eq!(open(&[1; 32], &a).unwrap(), b"secret");
        assert!(open(&[2; 32], &a).is_err());
    }
    #[test]
    fn interrupted_replacement_restores_the_previous_snapshot() {
        let directory =
            std::env::temp_dir().join(format!("any-music-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("accounts.json");
        write_atomic(&path, b"original").unwrap();
        std::fs::rename(&path, path.with_extension("previous")).unwrap();
        std::fs::write(path.with_extension("pending"), b"incomplete").unwrap();
        recover_atomic(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        write_atomic(&path, b"replacement").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
        std::fs::remove_dir_all(directory).unwrap();
    }
}
