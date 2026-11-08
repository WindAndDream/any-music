use am_plugin_package::{REVOCATION_DOMAIN, hash, verify_revocations};
use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
use serde_json::json;
#[test]
fn only_app_trust_roots_can_publish_fresh_revocations_and_rotate_preprovisioned_keys() {
    for _ in 0..2 {
        let mut secret = [0; 32];
        rand::rngs::OsRng.fill_bytes(&mut secret);
        let key = SigningKey::from_bytes(&secret);
        secret.fill(0);
        let public = key.verifying_key().to_bytes();
        let fingerprint = hash(&public);
        let raw=serde_json::to_vec(&json!({"version":1,"sequence":4,"issuedAtMs":500,"expiresAtMs":2000,"pluginIds":[],"packageHashes":[],"publisherKeys":[]})).unwrap();
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let signature = key.sign(&[REVOCATION_DOMAIN, &raw].concat());
        let envelope=serde_json::to_vec(&json!({"version":1,"algorithm":"Ed25519","keyId":"test-root","publicKey":hex(&public),"fingerprint":fingerprint,"signature":hex(&signature.to_bytes())})).unwrap();
        assert!(verify_revocations(&raw, &envelope, &[], 1000).is_err());
        assert!(
            verify_revocations(
                &raw,
                &envelope,
                &["other-root".into(), fingerprint.clone()],
                1000
            )
            .is_ok()
        );
        assert!(
            verify_revocations(&raw, &envelope, std::slice::from_ref(&fingerprint), 499).is_err()
        );
        assert!(
            verify_revocations(&raw, &envelope, std::slice::from_ref(&fingerprint), 2000).is_err()
        );
        let mut tampered = raw.clone();
        tampered.push(b' ');
        assert!(verify_revocations(&tampered, &envelope, &[fingerprint], 1000).is_err());
    }
}
