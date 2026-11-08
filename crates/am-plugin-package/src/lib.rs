//! Restricted .amplugin validation. Owned bytes are the only loading authority;
//! no extraction, installation decisions, network or plugin execution occurs here.
#![forbid(unsafe_code)]

mod paths;
mod signature;
mod zip_boundary;

use am_plugin_protocol::{PackageIntegrity, PackageSignature, PluginManifest, decode, parse_json};
pub use signature::{
    INTEGRITY_DOMAIN, REVOCATION_DOMAIN, hash, verify_revocations, verify_signature,
};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};

pub const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_FILES: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Archive,
    Path,
    Budget,
    Integrity,
    Signature,
    Manifest,
    Unsupported,
    Resource,
    Cancelled,
}

/// Private fields prevent adapters from minting a verified package from a renderer claim.
#[derive(Debug, Clone)]
pub struct VerifiedPackage {
    bytes: Vec<u8>,
    manifest: PluginManifest,
    files: BTreeMap<String, Vec<u8>>,
    content_hash: String,
    signer: Option<String>,
}
impl VerifiedPackage {
    pub fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }
    pub fn content_hash(&self) -> &str {
        &self.content_hash
    }
    /// A verified signature proves key possession only. The host must pin publisher identity.
    pub fn signer(&self) -> Option<&str> {
        self.signer.as_deref()
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn payload(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }
}

pub fn verify(bytes: Vec<u8>, cancelled: impl Fn() -> bool) -> Result<VerifiedPackage, Error> {
    if cancelled() {
        return Err(Error::Cancelled);
    }
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(Error::Budget);
    }
    // Check the directory before ZipArchive can allocate from untrusted entry counts or
    // collapse duplicate filenames. Local/central headers must describe identical bytes.
    let entries = zip_boundary::validate(&bytes)?;
    let mut zip = zip::ZipArchive::new(Cursor::new(&bytes)).map_err(|_| Error::Archive)?;
    let mut files = BTreeMap::new();
    let mut total = 0usize;
    for (index, entry) in entries.iter().enumerate() {
        if cancelled() {
            return Err(Error::Cancelled);
        }
        let mut file = zip.by_index(index).map_err(|_| Error::Archive)?;
        if file.name_raw() != entry.path.as_bytes() {
            return Err(Error::Archive);
        }
        let mut output = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        loop {
            if cancelled() {
                return Err(Error::Cancelled);
            }
            let count = file.read(&mut chunk).map_err(|_| Error::Archive)?;
            if count == 0 {
                break;
            }
            total = total.checked_add(count).ok_or(Error::Budget)?;
            if output.len() + count > MAX_FILE_BYTES
                || total > MAX_TOTAL_BYTES
                || output.len() + count > entry.compressed.saturating_mul(100)
            {
                return Err(Error::Budget);
            }
            output.extend_from_slice(&chunk[..count]);
        }
        if output.len() != entry.size {
            return Err(Error::Archive);
        }
        files.insert(entry.path.clone(), output);
    }
    let integrity_bytes = files.get("integrity.json").ok_or(Error::Integrity)?;
    let integrity: PackageIntegrity = decode(integrity_bytes).map_err(|_| Error::Integrity)?;
    let mut expected = BTreeMap::new();
    for entry in &integrity.files {
        paths::validate(&entry.path)?;
        if matches!(entry.path.as_str(), "integrity.json" | "signature.json")
            || expected.insert(&entry.path, entry).is_some()
        {
            return Err(Error::Integrity);
        }
        let value = files.get(&entry.path).ok_or(Error::Integrity)?;
        if entry.size != value.len() as i64 || entry.sha256 != hash(value) {
            return Err(Error::Integrity);
        }
    }
    if files
        .keys()
        .filter(|key| !matches!(key.as_str(), "integrity.json" | "signature.json"))
        .any(|key| !expected.contains_key(key))
    {
        return Err(Error::Integrity);
    }
    let signer = if let Some(signature) = files.get("signature.json") {
        let signature: PackageSignature = decode(signature).map_err(|_| Error::Signature)?;
        Some(verify_signature(
            INTEGRITY_DOMAIN,
            integrity_bytes,
            &signature,
        )?)
    } else {
        None
    };
    let manifest_raw = files.get("manifest.json").ok_or(Error::Manifest)?;
    let manifest_value = parse_json(manifest_raw).map_err(|_| Error::Manifest)?;
    if [
        "manifestVersion",
        "packageFormatVersion",
        "runtimeProfileVersion",
        "contributionVersion",
        "dataSchemaVersion",
    ]
    .iter()
    .any(|key| {
        manifest_value
            .get(key)
            .is_some_and(|v| v.as_u64() != Some(1))
    }) {
        return Err(Error::Unsupported);
    }
    let manifest: PluginManifest =
        decode(files.get("manifest.json").ok_or(Error::Manifest)?).map_err(|_| Error::Manifest)?;
    let code = manifest.execution.as_str() == "sandbox-code";
    if code != files.contains_key("dist/main.js") || !code && files.contains_key("dist/main.js.map")
    {
        return Err(Error::Manifest);
    }
    for (path, value) in &files {
        validate_resource(path, value)?;
    }
    let content_hash = hash(&bytes);
    Ok(VerifiedPackage {
        bytes,
        manifest,
        files,
        content_hash,
        signer,
    })
}

fn validate_resource(path: &str, value: &[u8]) -> Result<(), Error> {
    if path == "dist/main.js" {
        let code = std::str::from_utf8(value).map_err(|_| Error::Resource)?;
        for reference in code
            .lines()
            .filter_map(|line| line.split_once("sourceMappingURL=").map(|(_, value)| value))
        {
            // Match the complete value: a remote URL can hide this marker in its query/fragment.
            if reference.trim_end() != "main.js.map" {
                return Err(Error::Resource);
            }
        }
    } else if path.ends_with(".map") {
        let map = parse_json(value).map_err(|_| Error::Resource)?;
        if map.get("sourceRoot").is_some_and(|r| r != "")
            || map["sources"].as_array().is_none_or(|a| {
                a.iter()
                    .any(|s| s.as_str().is_none_or(|s| paths::validate(s).is_err()))
            })
        {
            return Err(Error::Resource);
        }
    } else if path.ends_with(".json") {
        parse_json(value).map_err(|_| Error::Resource)?;
    } else if path.ends_with(".png") {
        if value.len() < 24
            || &value[..8] != b"\x89PNG\r\n\x1a\n"
            || &value[12..16] != b"IHDR"
            || [16, 20].iter().any(|i| {
                let n = u32::from_be_bytes(value[*i..*i + 4].try_into().expect("four bytes"));
                n == 0 || n > 8192
            })
        {
            return Err(Error::Resource);
        }
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        if !value.starts_with(b"\xff\xd8\xff") || !value.ends_with(b"\xff\xd9") {
            return Err(Error::Resource);
        }
    } else if path.ends_with(".webp")
        && (value.len() < 16 || &value[..4] != b"RIFF" || &value[8..12] != b"WEBP")
    {
        return Err(Error::Resource);
    }
    Ok(())
}
