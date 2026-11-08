use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_OBJECTS: usize = 100;
pub const MAX_VALUE_BYTES: usize = 16 * 1024;
pub const MAX_NAMESPACE_BYTES: usize = 1024 * 1024;
pub const MAX_LEDGER_ROWS: usize = 4096;
pub const MAX_LIFETIME_MS: u64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Denied,
    Expired,
    Conflict,
    Replay,
    Budget,
    Corrupt,
    Storage,
    Unsupported,
}

/// The adapter must rollback on error and acknowledge only after durable commit.
/// The closure is synchronous so no external side effect can escape the commit/revoke lock.
pub trait Store {
    fn transaction<T>(
        &mut self,
        change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
    ) -> Result<T, Error>;
}
pub trait Clock {
    fn now_ms(&self) -> u64;
}
pub trait Ids {
    fn next_id(&mut self) -> String;
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Level {
    L0,
    L1,
    #[default]
    L2,
    Secret,
}

/// Created by native host code. Deliberately has no Deserialize implementation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub channel: String,
    pub document: String,
    pub account_scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub install_id: String,
    pub plugin_id: String,
    pub content_hash: String,
    pub publisher: String,
    pub generation: u64,
    pub data_generation: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Install {
    pub identity: Identity,
    pub epoch: u64,
    pub enabled: bool,
    pub historical_level: Level,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub identity: Identity,
    pub read_ceiling: Level,
    pub state: bool,
    pub annotate: bool,
    pub expires_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Session {
    pub id: String,
    pub identity: Identity,
    pub epoch: u64,
    pub channel: String,
    pub document: String,
    pub account_scope: String,
    pub expires_at_ms: u64,
}

/// These are the only fields the offline data boundary can project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Field {
    Title,
    Artist,
    Note,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provenance {
    pub level: Level,
    pub source_install: String,
    pub source_context: String,
    pub generation: u64,
    pub data_generation: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Value {
    pub text: String,
    pub provenance: Provenance,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostObject {
    pub id: String,
    pub account_scope: String,
    pub version: u64,
    pub fields: BTreeMap<Field, Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    pub version: u64,
    pub fields: Vec<Field>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Context {
    pub id: String,
    pub session_id: String,
    pub task_id: String,
    pub expires_at_ms: u64,
    pub selection: Vec<Selection>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateValue {
    pub text: String,
    pub version: u64,
    pub schema_version: u64,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Write {
    State {
        key: String,
        schema_version: u64,
        text: String,
    },
    /// A non-destructive host annotation. It does not rewrite the source's title or recipe.
    Annotate { object_id: String, text: String },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteRequest {
    pub operation_id: String,
    pub context_id: String,
    pub expected_version: u64,
    pub write: Write,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub identity: Identity,
    pub epoch: u64,
    pub session_id: String,
    pub request: WriteRequest,
    pub committed_version: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Annotation {
    pub version: u64,
    pub value: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JournalEntry {
    pub install_id: String,
    pub epoch: u64,
    pub action: String,
}

/// Serialized only by trusted persistence. No ledger/authority import from portable backups.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ledger {
    pub installs: BTreeMap<String, Install>,
    pub grants: BTreeMap<String, Grant>,
    pub sessions: BTreeMap<String, Session>,
    pub contexts: BTreeMap<String, Context>,
    pub tasks: BTreeMap<String, Task>,
    pub namespaces: BTreeMap<String, BTreeMap<String, StateValue>>,
    pub objects: BTreeMap<String, HostObject>,
    pub annotations: BTreeMap<String, Annotation>,
    pub deliveries: BTreeMap<String, Provenance>,
    pub journal: BTreeMap<String, JournalEntry>,
    /// Publisher + plugin lineage survives installation replacement and data retention.
    pub history: BTreeMap<String, Level>,
    /// S13 records are native-only, never imported from plugin backups.
    #[serde(default)]
    pub network_grants: BTreeMap<String, NetworkGrant>,
    #[serde(default)]
    pub exits: BTreeMap<String, ExitReservation>,
    #[serde(default)]
    pub outbound_audit: BTreeMap<String, Audit>,
    #[serde(default)]
    pub packages: BTreeMap<String, crate::PackageRecord>,
    #[serde(default)]
    pub install_journal: BTreeMap<String, crate::InstallJournal>,
    #[serde(default)]
    pub revocations: crate::Revocations,
}

pub const NETWORK_IDLE_MS: u64 = 90 * 24 * 60 * 60 * 1000;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum NetworkScope {
    Public,
    Hosts(Vec<String>),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkGrant {
    pub identity: Identity,
    pub scope: NetworkScope,
    pub ceiling: Level,
    /// Separate trusted confirmation of the L1+network combination.
    pub user_linked_approved: bool,
    /// Both declaration and independent highest-risk confirmation are required for L2.
    pub private_egress_declared: bool,
    pub private_egress_approved: bool,
    pub expires_at_ms: u64,
    pub last_used_at_ms: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExitKind {
    Sandbox,
    Declarative,
    Image,
    Media,
    Download,
    ExternalLink,
    Export,
    HostWrite,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExitReservation {
    pub id: String,
    pub session_id: String,
    pub context_id: String,
    pub identity: Identity,
    pub epoch: u64,
    pub kind: ExitKind,
    pub requests: u64,
    pub bytes: u64,
    pub active: bool,
}
/// Opaque native lease. Not deserializable or transferable to a plugin.
#[derive(Debug)]
pub struct ExitPermit {
    pub(crate) id: String,
    pub(crate) install_id: String,
}
impl ExitPermit {
    pub fn install_id(&self) -> &str {
        &self.install_id
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Audit {
    pub install_id: String,
    pub time_ms: u64,
    /// Redacted host: no path/query/userinfo; never includes plugin-supplied subdomain data.
    pub host_class: String,
    pub kind: ExitKind,
    pub status_class: u16,
    pub bytes: u64,
    pub denied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSnapshot {
    pub install_id: String,
    pub plugin_id: String,
    pub content_hash: String,
    pub publisher: String,
    pub generation: u64,
    pub data_generation: u64,
    pub permission_epoch: u64,
    pub enabled: bool,
    pub historical_level: Level,
}

pub(crate) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
}
pub(crate) fn object_key(account: &str, id: &str) -> String {
    // JSON tuple framing avoids collisions between arbitrary account/object IDs.
    serde_json::to_string(&(account, id)).expect("string tuple")
}
pub(crate) fn lineage(identity: &Identity) -> String {
    object_key(&identity.publisher, &identity.plugin_id)
}
