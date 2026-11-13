//! The transport/source of a list is not a trust root. Only app-provisioned fingerprints
//! may sign revocations. Distribution URLs and automatic refresh belong to S15 delivery.
use super::{NativeClock, PluginAuthority};
use am_plugin_runtime::Clock;

// No production distribution key has been provisioned. Never trust a key shipped by a package.
const APP_REVOCATION_ROOTS: &[&str] = &[];
impl PluginAuthority {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "S15 distribution is not configured; no renderer trust-root setter exists"
        )
    )]
    pub(super) fn apply_signed_revocations(
        &self,
        raw: &[u8],
        envelope: &[u8],
    ) -> Result<(), String> {
        let roots = APP_REVOCATION_ROOTS
            .iter()
            .map(|s| (*s).to_owned())
            .collect::<Vec<_>>();
        self.apply_revocations_from_roots(raw, envelope, &roots)
    }
    fn apply_revocations_from_roots(
        &self,
        raw: &[u8],
        envelope: &[u8],
        roots: &[String],
    ) -> Result<(), String> {
        if raw.len() > 262144 || envelope.len() > 4096 {
            return Err("撤销清单超出预算。".into());
        }
        let list =
            am_plugin_package::verify_revocations(raw, envelope, roots, NativeClock.now_ms())
                .map_err(|_| "撤销清单签名或有效期无效。")?;
        let revoked = self.with(|runtime| {
            runtime.apply_revocations(list)?;
            runtime.snapshot().map(|snapshot| {
                snapshot
                    .into_iter()
                    .filter(|i| !i.enabled)
                    .map(|i| i.install_id)
                    .collect::<Vec<_>>()
            })
        })?;
        for id in revoked {
            self.cancel_network(&id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    #[test]
    fn self_supplied_keys_cannot_revoke_and_signed_replay_is_rejected() {
        let directory = std::env::temp_dir().join(format!(
            "any-music-s14-revocations-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let authority = PluginAuthority::new(directory.clone());
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../packages/plugin-sdk/test/fixtures/packages/revocations.json"
        ))
        .unwrap();
        let raw = base64::engine::general_purpose::STANDARD
            .decode(vector["raw"].as_str().unwrap())
            .unwrap();
        let envelope = serde_json::to_vec(&vector["envelope"]).unwrap();
        assert!(authority.apply_signed_revocations(&raw, &envelope).is_err());
        let roots = vec![
            vector["envelope"]["fingerprint"]
                .as_str()
                .unwrap()
                .to_owned(),
        ];
        authority
            .apply_revocations_from_roots(&raw, &envelope, &roots)
            .unwrap();
        assert!(
            authority
                .apply_revocations_from_roots(&raw, &envelope, &roots)
                .is_err()
        );
        drop(authority);
        assert_eq!(directory.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
