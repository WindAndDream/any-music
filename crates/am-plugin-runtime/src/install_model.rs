use crate::{Error, Identity, Level, StateValue};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub type Namespace = BTreeMap<String, StateValue>;

/// Supplied only by the native verifier, never deserialized from a renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub plugin_id: String,
    pub version: String,
    pub package_hash: String,
    pub signer: Option<String>,
    pub execution: String,
    pub data_schema: u64,
    pub capabilities: Vec<String>,
    pub required_capabilities: Vec<String>,
    pub compatible: bool,
}

/// Application-owned intersection of build/channel/target admission. No wire deserializer.
#[derive(Debug, Clone)]
pub struct InstallPolicy {
    pub declarative: bool,
    pub sandbox_code: bool,
    pub capabilities: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageRecord {
    pub identity: Identity,
    pub candidate: Candidate,
    pub data_hash: String,
    pub rollback: Option<Box<PackageRecord>>,
    pub installed: bool,
    pub granted_capabilities: BTreeSet<String>,
}

/// Native opaque preview carries identity/epoch, revocation revision and exact candidate.
/// Only its display projection is serialized by the application.
#[derive(Debug, Clone)]
pub struct InstallPreview {
    pub(crate) candidate: Candidate,
    pub(crate) previous: Option<Identity>,
    pub(crate) epoch: u64,
    pub(crate) revocation_sequence: u64,
    pub(crate) historical_level: Level,
    pub(crate) inherited: BTreeSet<String>,
    pub(crate) pinned: bool,
    pub(crate) allowed: bool,
    pub(crate) expires_at_ms: u64,
}
impl InstallPreview {
    pub fn candidate(&self) -> &Candidate {
        &self.candidate
    }
    pub fn can_install(&self) -> bool {
        self.allowed
    }
    pub fn publisher_verified(&self) -> bool {
        self.pinned
    }
    pub fn historical_level(&self) -> Level {
        self.historical_level
    }
    pub fn added_permissions(&self) -> Vec<String> {
        self.candidate
            .capabilities
            .iter()
            .filter(|id| !self.inherited.contains(*id))
            .cloned()
            .collect()
    }
}

/// An explicit host confirmation. Publisher/data transfer is separate from capability consent.
#[derive(Debug, Clone)]
pub struct InstallConsent {
    pub capabilities: BTreeSet<String>,
    pub pin_publisher: bool,
    pub transfer_data: bool,
    pub read_ceiling: Level,
    pub user_linked_network: bool,
    pub private_network: bool,
}

/// Single-use native rollback confirmation; never serialized or constructed by a renderer.
/// Consuming it cannot restore grants, and stale identity/epoch/revocation state is rejected.
#[derive(Debug)]
pub struct RollbackPreview {
    pub(crate) previous: Identity,
    pub(crate) record: PackageRecord,
    pub(crate) epoch: u64,
    pub(crate) revocation_sequence: u64,
    pub(crate) expires_at_ms: u64,
}
impl RollbackPreview {
    pub fn candidate(&self) -> &Candidate {
        &self.record.candidate
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallJournal {
    pub candidate: PackageRecord,
    pub old: Option<PackageRecord>,
    pub old_data: Namespace,
    pub data: Namespace,
    pub suspended_epoch: u64,
    pub was_enabled: bool,
    pub committed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revocations {
    pub sequence: u64,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub plugin_ids: BTreeSet<String>,
    pub hashes: BTreeSet<String>,
    pub publishers: BTreeSet<String>,
    pub pinned_publishers: BTreeMap<String, String>,
}
impl Revocations {
    pub fn denies(&self, candidate: &Candidate) -> bool {
        self.plugin_ids.contains(&candidate.plugin_id)
            || self.hashes.contains(&candidate.package_hash)
            || candidate
                .signer
                .as_ref()
                .is_some_and(|s| self.publishers.contains(s))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallPoint {
    Prepared,
    OldDataDurable,
    CodeDurable,
    DataDurable,
    Published,
    BeforeCommit,
    Committed,
    Recovered,
}

/// Implementations use private content-addressed paths, durable files/parent directories and
/// cooperative cancellation. No package-supplied path is ever a filesystem destination.
pub trait InstallFiles {
    fn publish_code(&mut self, candidate: &Candidate) -> Result<(), Error>;
    fn publish_data(&mut self, data: &Namespace) -> Result<String, Error>;
    /// Return the exact owned archive bytes checked against the record. Execution must consume
    /// these bytes, never reopen a path after verification.
    fn verify_pair(&mut self, record: &PackageRecord) -> Result<Vec<u8>, Error>;
    fn load_data(&mut self, record: &PackageRecord) -> Result<Namespace, Error>;
    fn checkpoint(&mut self, _point: InstallPoint) -> Result<(), Error> {
        Ok(())
    }
    fn gc(&mut self, code: &BTreeSet<String>, data: &BTreeSet<String>) -> Result<(), Error>;
}

/// Host-supported versioned operations touch only an owned namespace copy. External JS is
/// never temporarily evaluated for migration; unsupported schema changes leave old data intact.
#[derive(Debug, Clone)]
pub enum DataMigration {
    Copy,
    Rename { from: String, to: String },
}

#[derive(Debug)]
pub struct LoadedPackage {
    pub session_id: String,
    pub package_bytes: Vec<u8>,
}
