//! Product snapshot IPC owns product.json, independently of account configuration and credentials.
use super::vault;
use crate::{browser::verification::require_main, state::RuntimeState};
use std::sync::Mutex;
use tauri::{State, WebviewWindow};

// Serializes the revision check with the atomic replacement, including concurrent IPC calls.
static PRODUCT_WRITE: Mutex<()> = Mutex::new(());

fn validate_replacement(
    previous: &serde_json::Value,
    next: &serde_json::Value,
) -> Result<(), String> {
    if next
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(2)
        || (previous != &serde_json::json!({})
            && previous
                .get("schemaVersion")
                .and_then(serde_json::Value::as_u64)
                != Some(2))
    {
        return Err("产品数据格式不受支持。".into());
    }
    if previous != &serde_json::json!({}) {
        let old_revision = previous.get("revision").and_then(serde_json::Value::as_u64);
        let new_revision = next.get("revision").and_then(serde_json::Value::as_u64);
        if old_revision.is_none()
            || new_revision.is_none()
            || new_revision < old_revision
            || (new_revision == old_revision && previous != next)
        {
            return Err("产品快照代次冲突，请重新加载。".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_product_data(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    value: serde_json::Value,
) -> Result<(), String> {
    require_main(&window)?;
    let _guard = PRODUCT_WRITE.lock().map_err(|_| "产品存储锁不可用。")?;
    let bytes = serde_json::to_vec(&value).map_err(|_| "资料库序列化失败。")?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("资料库超过 32 MiB 存储预算。".into());
    }
    let path = state.directory.join("product.json");
    vault::recover_atomic(&path)?;
    if path.exists() {
        let previous_bytes = std::fs::read(&path).map_err(|_| "无法读取产品快照。")?;
        let previous: serde_json::Value =
            serde_json::from_slice(&previous_bytes).map_err(|_| "产品快照损坏，已保留原文件。")?;
        validate_replacement(&previous, &value)?;
    }
    vault::write_atomic(&path, &bytes)
}

#[tauri::command]
pub fn load_product_data(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<serde_json::Value, String> {
    require_main(&window)?;
    let path = state.directory.join("product.json");
    vault::recover_atomic(&path)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|_| "无法读取资料库。")?)
        .map_err(|_| "资料库存储损坏。".into())
}

#[cfg(test)]
mod tests {
    use super::validate_replacement;
    use serde_json::json;

    #[test]
    fn snapshot_round_trip_preserves_fractional_playback_history_for_generation_checksums() {
        let source = r#"{"durationMs":11066.667000000001,"otherDurationMs":2056846.0089999998}"#;
        let parsed: serde_json::Value = serde_json::from_str(source).unwrap();
        assert_eq!(
            parsed["durationMs"].as_f64().unwrap().to_bits(),
            11066.667000000001_f64.to_bits()
        );
        assert_eq!(
            parsed["otherDurationMs"].as_f64().unwrap().to_bits(),
            2056846.0089999998_f64.to_bits()
        );
        let bytes = serde_json::to_vec(&parsed).unwrap();
        let restored: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(restored, parsed);
    }

    #[test]
    fn prevents_unsupported_formats_and_stale_overwrites() {
        let old = json!({"schemaVersion": 2, "revision": 8, "values": {}});
        assert!(
            validate_replacement(&old, &json!({"updatedAtMs": u64::MAX, "values": {}})).is_err()
        );
        assert!(validate_replacement(&old, &json!({"schemaVersion": 2, "revision": 7})).is_err());
        assert!(
            validate_replacement(
                &old,
                &json!({"schemaVersion": 2, "revision": 8, "values": {"changed": true}})
            )
            .is_err()
        );
        assert!(validate_replacement(&json!({"schemaVersion": 3}), &old).is_err());
        assert!(validate_replacement(&old, &old).is_ok());
        assert!(
            validate_replacement(
                &old,
                &json!({"schemaVersion": 2, "revision": 9, "values": {}})
            )
            .is_ok()
        );
        assert!(validate_replacement(&json!({"updatedAtMs": 99999}), &old).is_err());
        assert!(validate_replacement(&json!({}), &old).is_ok());
    }
}
