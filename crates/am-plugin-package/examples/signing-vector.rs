//! Offline interoperability probe. An ephemeral key is generated and discarded in memory;
//! only public verification material is printed. This is not the S15 CLI signer.
use am_plugin_package::{INTEGRITY_DOMAIN, hash};
use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
fn main() {
    let mut secret = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    let key = SigningKey::from_bytes(&secret);
    secret.fill(0);
    let public = key.verifying_key().to_bytes();
    let raw = "{\"version\":1, \"files\":[] }\n";
    let message = [INTEGRITY_DOMAIN, raw.as_bytes()].concat();
    let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    println!(
        "{}",
        serde_json::json!({"raw":raw,"envelope":{"version":1,"algorithm":"Ed25519","keyId":"ephemeral-rust-vector","publicKey":hex(&public),"fingerprint":hash(&public),"signature":hex(&key.sign(&message).to_bytes())}})
    );
}
