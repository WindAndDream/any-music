//! Pin a Profile to its selected system browser across background/visible handoffs and app restarts.
//! The marker contains only a browser kind; never a supplied executable path or credentials.
use std::path::{Path, PathBuf};

pub(super) fn resolve(
    root: &Path,
    id: &str,
    requested: Option<&str>,
    agent: &str,
) -> Result<(String, PathBuf), String> {
    resolve_with(
        root,
        id,
        requested,
        agent,
        crate::browser::verification::find_browser,
    )
}

fn resolve_with(
    root: &Path,
    id: &str,
    requested: Option<&str>,
    agent: &str,
    find: impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<(String, PathBuf), String> {
    crate::model::validate_id(id)?;
    let marker = root.join(id).join(".account-browser");
    crate::storage::vault::recover_atomic(&marker)?;
    let saved = match std::fs::read(&marker) {
        Ok(bytes) => {
            Some(String::from_utf8(bytes).map_err(|_| "network-error:账号浏览器配置无效。")?)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("network-error:无法读取账号浏览器配置。".into()),
    };
    // Migrate existing Edge profiles using the actual persisted browser UA.
    let kind = requested
        .filter(|kind| *kind != "system")
        .or(saved.as_deref())
        .or_else(|| agent.contains("Edg/").then_some("edge"));
    if let Some(kind) = kind {
        if !matches!(kind, "chrome" | "edge") {
            return Err("invalid-input:请选择系统 Chrome 或 Edge。".into());
        }
        let path = find(kind).map_err(|_| {
            format!(
                "network-error:未找到此账号使用的 {kind}；请安装该浏览器或在账号设置中选择浏览器。"
            )
        })?;
        return Ok((kind.into(), path));
    }
    find("chrome")
        .map(|path| ("chrome".into(), path))
        .or_else(|_| find("edge").map(|path| ("edge".into(), path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoffs_and_restarts_keep_the_browser_even_when_chrome_becomes_available() {
        let root = std::env::temp_dir().join(format!("any-music-browser-{}", uuid::Uuid::new_v4()));
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(root.join(&id)).unwrap();
        let both = |kind: &str| Ok(PathBuf::from(format!("{kind}.exe")));
        assert_eq!(
            resolve_with(&root, &id, None, "Edg/154", both).unwrap().0,
            "edge"
        );
        std::fs::write(root.join(&id).join(".account-browser"), "edge").unwrap();
        assert_eq!(
            resolve_with(&root, &id, None, "Chrome/154", both)
                .unwrap()
                .0,
            "edge"
        );
        assert_eq!(
            resolve_with(&root, &id, Some("chrome"), "", both)
                .unwrap()
                .0,
            "chrome"
        );
        assert!(
            resolve_with(&root, &id, None, "", |_| Err("missing".into()))
                .unwrap_err()
                .contains("edge")
        );
        std::fs::write(root.join(&id).join(".account-browser"), "../../other.exe").unwrap();
        assert!(resolve_with(&root, &id, None, "", both).is_err());
        assert!(resolve_with(&root, "../other", None, "", both).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
