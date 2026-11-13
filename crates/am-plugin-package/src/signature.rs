use crate::Error;
use am_plugin_protocol::{PackageRevocations, PackageSignature, decode};
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

pub const INTEGRITY_DOMAIN: &[u8] = b"AnyMusic.amplugin.integrity.v1\0";
pub const REVOCATION_DOMAIN: &[u8] = b"AnyMusic.amplugin.revocations.v1\0";
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hex<const N: usize>(text: &str) -> Result<[u8; N], Error> {
    if text.len() != N * 2
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(Error::Signature);
    }
    let mut result = [0; N];
    for (i, byte) in result.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).map_err(|_| Error::Signature)?;
    }
    Ok(result)
}
pub fn verify_signature(
    domain: &[u8],
    raw: &[u8],
    envelope: &PackageSignature,
) -> Result<String, Error> {
    let public = hex::<32>(&envelope.public_key)?;
    if hash(&public) != envelope.fingerprint {
        return Err(Error::Signature);
    }
    let key = VerifyingKey::from_bytes(&public).map_err(|_| Error::Signature)?;
    let signature = Signature::from_bytes(&hex::<64>(&envelope.signature)?);
    let mut message = Vec::with_capacity(domain.len() + raw.len());
    message.extend_from_slice(domain);
    message.extend_from_slice(raw);
    key.verify_strict(&message, &signature)
        .map_err(|_| Error::Signature)?;
    Ok(envelope.fingerprint.clone())
}

/// Caller supplies app-owned trust roots and time. Package-provided keys cannot revoke others.
pub fn verify_revocations(
    raw: &[u8],
    envelope: &[u8],
    trusted_keys: &[String],
    now_ms: u64,
) -> Result<PackageRevocations, Error> {
    let envelope: PackageSignature = decode(envelope).map_err(|_| Error::Signature)?;
    let signer = verify_signature(REVOCATION_DOMAIN, raw, &envelope)?;
    if !trusted_keys.contains(&signer) {
        return Err(Error::Signature);
    }
    let list: PackageRevocations = decode(raw).map_err(|_| Error::Signature)?;
    if list.issued_at_ms > now_ms as i64
        || list.expires_at_ms <= now_ms as i64
        || list.expires_at_ms <= list.issued_at_ms
        || list
            .package_hashes
            .iter()
            .chain(&list.publisher_keys)
            .any(|s| hex::<32>(s).is_err())
    {
        return Err(Error::Signature);
    }
    Ok(list)
}
