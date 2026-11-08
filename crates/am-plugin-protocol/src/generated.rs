// Generated from plugin-sdk/schema. Do not edit; run pnpm generate:protocol.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalizedText {
    #[serde(rename = "zh-CN")]
    pub zh_cn: String,
    #[serde(rename = "en")]
    pub en: String,
}

impl crate::ProtocolDto for LocalizedText {
    const SCHEMA: &'static str = "LocalizedText";
}

fn is_localized_text(v: &serde_json::Value) -> bool {
    is_schema_node_0(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WireErrorCode {
    #[serde(rename = "invalid-input")]
    InvalidInput,
    #[serde(rename = "unsupported-version")]
    UnsupportedVersion,
    #[serde(rename = "capability-unavailable")]
    CapabilityUnavailable,
    #[serde(rename = "operation-cancelled")]
    OperationCancelled,
    #[serde(rename = "timeout")]
    Timeout,
    #[serde(rename = "limit-exceeded")]
    LimitExceeded,
    #[serde(rename = "invalid-response")]
    InvalidResponse,
    #[serde(rename = "upstream-error")]
    UpstreamError,
    #[serde(rename = "access-denied")]
    AccessDenied,
    #[serde(rename = "not-found")]
    NotFound,
    #[serde(rename = "rate-limited")]
    RateLimited,
    #[serde(rename = "conflict")]
    Conflict,
    #[serde(rename = "not-authenticated")]
    NotAuthenticated,
    #[serde(rename = "account-unavailable")]
    AccountUnavailable,
    #[serde(rename = "unsupported-url")]
    UnsupportedUrl,
    #[serde(rename = "verification-required")]
    VerificationRequired,
    #[serde(rename = "pagination-unavailable")]
    PaginationUnavailable,
    #[serde(rename = "network-error")]
    NetworkError,
}

impl WireErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid-input",
            Self::UnsupportedVersion => "unsupported-version",
            Self::CapabilityUnavailable => "capability-unavailable",
            Self::OperationCancelled => "operation-cancelled",
            Self::Timeout => "timeout",
            Self::LimitExceeded => "limit-exceeded",
            Self::InvalidResponse => "invalid-response",
            Self::UpstreamError => "upstream-error",
            Self::AccessDenied => "access-denied",
            Self::NotFound => "not-found",
            Self::RateLimited => "rate-limited",
            Self::Conflict => "conflict",
            Self::NotAuthenticated => "not-authenticated",
            Self::AccountUnavailable => "account-unavailable",
            Self::UnsupportedUrl => "unsupported-url",
            Self::VerificationRequired => "verification-required",
            Self::PaginationUnavailable => "pagination-unavailable",
            Self::NetworkError => "network-error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    #[serde(rename = "code")]
    pub code: WireErrorCode,
    #[serde(rename = "message")]
    pub message: String,
    #[serde(rename = "isRetryable")]
    pub is_retryable: bool,
}

impl crate::ProtocolDto for WireError {
    const SCHEMA: &'static str = "WireError";
}

fn is_wire_error(v: &serde_json::Value) -> bool {
    is_schema_node_2(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequirement {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "required")]
    pub required: bool,
    #[serde(rename = "reason")]
    pub reason: LocalizedText,
}

impl crate::ProtocolDto for CapabilityRequirement {
    const SCHEMA: &'static str = "CapabilityRequirement";
}

fn is_capability_requirement(v: &serde_json::Value) -> bool {
    is_schema_node_5(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ExtensionRequirementId {
    #[serde(rename = "navigation.sidebar")]
    NavigationSidebar,
    #[serde(rename = "workspace.views")]
    WorkspaceViews,
    #[serde(rename = "track.actions.secondary")]
    TrackActionsSecondary,
    #[serde(rename = "track.details")]
    TrackDetails,
    #[serde(rename = "trackList.operator.actions")]
    TrackListOperatorActions,
    #[serde(rename = "trackList.filters")]
    TrackListFilters,
    #[serde(rename = "settings.sections")]
    SettingsSections,
    #[serde(rename = "music.sources")]
    MusicSources,
}

impl ExtensionRequirementId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NavigationSidebar => "navigation.sidebar",
            Self::WorkspaceViews => "workspace.views",
            Self::TrackActionsSecondary => "track.actions.secondary",
            Self::TrackDetails => "track.details",
            Self::TrackListOperatorActions => "trackList.operator.actions",
            Self::TrackListFilters => "trackList.filters",
            Self::SettingsSections => "settings.sections",
            Self::MusicSources => "music.sources",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtensionRequirement {
    #[serde(rename = "id")]
    pub id: ExtensionRequirementId,
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "required")]
    pub required: bool,
}

impl crate::ProtocolDto for ExtensionRequirement {
    const SCHEMA: &'static str = "ExtensionRequirement";
}

fn is_extension_requirement(v: &serde_json::Value) -> bool {
    is_schema_node_9(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionScopeSectionsItem {
    #[serde(rename = "catalog")]
    Catalog,
    #[serde(rename = "queue")]
    Queue,
    #[serde(rename = "favorites")]
    Favorites,
    #[serde(rename = "playlists")]
    Playlists,
    #[serde(rename = "history")]
    History,
}

impl ContributionScopeSectionsItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Catalog => "catalog",
            Self::Queue => "queue",
            Self::Favorites => "favorites",
            Self::Playlists => "playlists",
            Self::History => "history",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionScopeFormsItem {
    #[serde(rename = "desktop")]
    Desktop,
    #[serde(rename = "mobile")]
    Mobile,
}

impl ContributionScopeFormsItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Mobile => "mobile",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContributionScope {
    #[serde(rename = "sections")]
    pub sections: Vec<ContributionScopeSectionsItem>,
    #[serde(rename = "forms")]
    pub forms: Vec<ContributionScopeFormsItem>,
}

impl crate::ProtocolDto for ContributionScope {
    const SCHEMA: &'static str = "ContributionScope";
}

fn is_contribution_scope(v: &serde_json::Value) -> bool {
    is_schema_node_11(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionDescriptorPointId {
    #[serde(rename = "navigation.sidebar")]
    NavigationSidebar,
    #[serde(rename = "workspace.views")]
    WorkspaceViews,
    #[serde(rename = "track.actions.secondary")]
    TrackActionsSecondary,
    #[serde(rename = "track.details")]
    TrackDetails,
    #[serde(rename = "trackList.operator.actions")]
    TrackListOperatorActions,
    #[serde(rename = "trackList.filters")]
    TrackListFilters,
    #[serde(rename = "settings.sections")]
    SettingsSections,
    #[serde(rename = "music.sources")]
    MusicSources,
}

impl ContributionDescriptorPointId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NavigationSidebar => "navigation.sidebar",
            Self::WorkspaceViews => "workspace.views",
            Self::TrackActionsSecondary => "track.actions.secondary",
            Self::TrackDetails => "track.details",
            Self::TrackListOperatorActions => "trackList.operator.actions",
            Self::TrackListFilters => "trackList.filters",
            Self::SettingsSections => "settings.sections",
            Self::MusicSources => "music.sources",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionDescriptorInputSchemaId {
    #[serde(rename = "urn:any-music:plugin:command-context:1")]
    UrnAnyMusicPluginCommandContext1,
}

impl ContributionDescriptorInputSchemaId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UrnAnyMusicPluginCommandContext1 => "urn:any-music:plugin:command-context:1",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionDescriptorEventSchemaId {
    #[serde(rename = "urn:any-music:plugin:ui-event:1")]
    UrnAnyMusicPluginUiEvent1,
}

impl ContributionDescriptorEventSchemaId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UrnAnyMusicPluginUiEvent1 => "urn:any-music:plugin:ui-event:1",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionDescriptorCardinality {
    #[serde(rename = "many")]
    Many,
}

impl ContributionDescriptorCardinality {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Many => "many",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ContributionDescriptorFallback {
    #[serde(rename = "hidden")]
    Hidden,
}

impl ContributionDescriptorFallback {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Hidden => "hidden",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContributionDescriptor {
    #[serde(rename = "contributionId")]
    pub contribution_id: String,
    #[serde(rename = "pointId")]
    pub point_id: ContributionDescriptorPointId,
    #[serde(rename = "contractVersion")]
    pub contract_version: i64,
    #[serde(rename = "required")]
    pub required: bool,
    #[serde(rename = "title")]
    pub title: LocalizedText,
    #[serde(rename = "scope")]
    pub scope: ContributionScope,
    #[serde(rename = "commandId", default, skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(rename = "viewId", default, skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
    #[serde(
        rename = "providerId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub provider_id: Option<String>,
    #[serde(rename = "inputSchemaId")]
    pub input_schema_id: ContributionDescriptorInputSchemaId,
    #[serde(rename = "eventSchemaId")]
    pub event_schema_id: ContributionDescriptorEventSchemaId,
    #[serde(rename = "cardinality")]
    pub cardinality: ContributionDescriptorCardinality,
    #[serde(rename = "fallback")]
    pub fallback: ContributionDescriptorFallback,
    #[serde(rename = "budgetProfileVersion")]
    pub budget_profile_version: i64,
}

impl crate::ProtocolDto for ContributionDescriptor {
    const SCHEMA: &'static str = "ContributionDescriptor";
}

fn is_contribution_descriptor(v: &serde_json::Value) -> bool {
    is_schema_node_16(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandDescriptor {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "title")]
    pub title: LocalizedText,
}

impl crate::ProtocolDto for CommandDescriptor {
    const SCHEMA: &'static str = "CommandDescriptor";
}

fn is_command_descriptor(v: &serde_json::Value) -> bool {
    is_schema_node_23(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifestSdk {
    #[serde(rename = "minimum")]
    pub minimum: String,
    #[serde(rename = "maximumExclusive")]
    pub maximum_exclusive: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestExecution {
    #[serde(rename = "declarative")]
    Declarative,
    #[serde(rename = "sandbox-code")]
    SandboxCode,
}

impl PluginManifestExecution {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Declarative => "declarative",
            Self::SandboxCode => "sandbox-code",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestEntry {
    #[serde(rename = "dist/main.js")]
    DistMainJs,
}

impl PluginManifestEntry {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DistMainJs => "dist/main.js",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestIntegrity {
    #[serde(rename = "integrity.json")]
    IntegrityJson,
}

impl PluginManifestIntegrity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::IntegrityJson => "integrity.json",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestFormsItem {
    #[serde(rename = "desktop")]
    Desktop,
    #[serde(rename = "mobile")]
    Mobile,
}

impl PluginManifestFormsItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Mobile => "mobile",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestActivationEventsItem {
    #[serde(rename = "on-command")]
    OnCommand,
    #[serde(rename = "on-view")]
    OnView,
    #[serde(rename = "on-source")]
    OnSource,
}

impl PluginManifestActivationEventsItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::OnCommand => "on-command",
            Self::OnView => "on-view",
            Self::OnSource => "on-source",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginManifestMemoryClass {
    #[serde(rename = "minimum")]
    Minimum,
    #[serde(rename = "increased")]
    Increased,
}

impl PluginManifestMemoryClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Minimum => "minimum",
            Self::Increased => "increased",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginManifest {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub _schema: Option<String>,
    #[serde(rename = "manifestVersion")]
    pub manifest_version: i64,
    #[serde(rename = "packageFormatVersion")]
    pub package_format_version: i64,
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "version")]
    pub version: String,
    #[serde(rename = "name")]
    pub name: LocalizedText,
    #[serde(rename = "description")]
    pub description: LocalizedText,
    #[serde(rename = "sdk")]
    pub sdk: PluginManifestSdk,
    #[serde(rename = "wireVersions")]
    pub wire_versions: Vec<i64>,
    #[serde(rename = "runtimeProfileVersion")]
    pub runtime_profile_version: i64,
    #[serde(rename = "contributionVersion")]
    pub contribution_version: i64,
    #[serde(rename = "dataSchemaVersion")]
    pub data_schema_version: i64,
    #[serde(rename = "execution")]
    pub execution: PluginManifestExecution,
    #[serde(rename = "entry", default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<PluginManifestEntry>,
    #[serde(rename = "integrity")]
    pub integrity: PluginManifestIntegrity,
    #[serde(rename = "forms")]
    pub forms: Vec<PluginManifestFormsItem>,
    #[serde(rename = "capabilities")]
    pub capabilities: Vec<CapabilityRequirement>,
    #[serde(rename = "commands")]
    pub commands: Vec<CommandDescriptor>,
    #[serde(rename = "contributions")]
    pub contributions: Vec<ContributionDescriptor>,
    #[serde(rename = "activationEvents")]
    pub activation_events: Vec<PluginManifestActivationEventsItem>,
    #[serde(rename = "memoryClass")]
    pub memory_class: PluginManifestMemoryClass,
    #[serde(
        rename = "sourceAuthentication",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub source_authentication: Option<SourceAuthentication>,
}

impl crate::ProtocolDto for PluginManifest {
    const SCHEMA: &'static str = "PluginManifest";
}

fn is_plugin_manifest(v: &serde_json::Value) -> bool {
    is_schema_node_24(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostCapabilitiesForm {
    #[serde(rename = "desktop")]
    Desktop,
    #[serde(rename = "mobile")]
    Mobile,
}

impl HostCapabilitiesForm {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Mobile => "mobile",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostCapabilitiesExternalPlugins {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "declarative")]
    Declarative,
    #[serde(rename = "sandbox-code")]
    SandboxCode,
}

impl HostCapabilitiesExternalPlugins {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Declarative => "declarative",
            Self::SandboxCode => "sandbox-code",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilitiesCapabilitiesItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "versions")]
    pub versions: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilitiesExtensionPointsItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "versions")]
    pub versions: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilities {
    #[serde(rename = "sdkVersion")]
    pub sdk_version: String,
    #[serde(rename = "manifestVersions")]
    pub manifest_versions: Vec<i64>,
    #[serde(rename = "wireVersions")]
    pub wire_versions: Vec<i64>,
    #[serde(rename = "runtimeProfileVersions")]
    pub runtime_profile_versions: Vec<i64>,
    #[serde(rename = "contributionVersions")]
    pub contribution_versions: Vec<i64>,
    #[serde(rename = "packageFormatVersions")]
    pub package_format_versions: Vec<i64>,
    #[serde(rename = "dataSchemaVersions")]
    pub data_schema_versions: Vec<i64>,
    #[serde(rename = "form")]
    pub form: HostCapabilitiesForm,
    #[serde(rename = "externalPlugins")]
    pub external_plugins: HostCapabilitiesExternalPlugins,
    #[serde(rename = "sandboxAvailable")]
    pub sandbox_available: bool,
    #[serde(rename = "capabilities")]
    pub capabilities: Vec<HostCapabilitiesCapabilitiesItem>,
    #[serde(rename = "extensionPoints")]
    pub extension_points: Vec<HostCapabilitiesExtensionPointsItem>,
}

impl crate::ProtocolDto for HostCapabilities {
    const SCHEMA: &'static str = "HostCapabilities";
}

fn is_host_capabilities(v: &serde_json::Value) -> bool {
    is_schema_node_43(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandContextObjectRefsItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "version")]
    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandContext {
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "scope")]
    pub scope: ContributionScope,
    #[serde(rename = "objectRefs")]
    pub object_refs: Vec<CommandContextObjectRefsItem>,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: i64,
}

impl crate::ProtocolDto for CommandContext {
    const SCHEMA: &'static str = "CommandContext";
}

fn is_command_context(v: &serde_json::Value) -> bool {
    is_schema_node_47(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginTaskV0State {
    #[serde(rename = "failed")]
    Failed,
}

impl PluginTaskV0State {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginTaskV0 {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "state")]
    pub state: PluginTaskV0State,
    #[serde(rename = "completed")]
    pub completed: i64,
    #[serde(rename = "total", default, skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PluginTaskV1State {
    #[serde(rename = "queued")]
    Queued,
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "succeeded")]
    Succeeded,
    #[serde(rename = "cancelled")]
    Cancelled,
}

impl PluginTaskV1State {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginTaskV1 {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "state")]
    pub state: PluginTaskV1State,
    #[serde(rename = "completed")]
    pub completed: i64,
    #[serde(rename = "total", default, skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum PluginTask {
    V0(Box<PluginTaskV0>),
    V1(Box<PluginTaskV1>),
}

impl crate::ProtocolDto for PluginTask {
    const SCHEMA: &'static str = "PluginTask";
}

fn is_plugin_task(v: &serde_json::Value) -> bool {
    is_schema_node_51(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostEventV0Event {
    #[serde(rename = "player.track-changed")]
    PlayerTrackChanged,
}

impl HostEventV0Event {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PlayerTrackChanged => "player.track-changed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum HostEventV0TrackRef {
    V0(Box<String>),
    V1(Box<()>),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostEventV0 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventVersion")]
    pub event_version: i64,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "event")]
    pub event: HostEventV0Event,
    #[serde(rename = "sequence")]
    pub sequence: i64,
    #[serde(rename = "trackRef")]
    pub track_ref: HostEventV0TrackRef,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostEventV1Event {
    #[serde(rename = "player.ended")]
    PlayerEnded,
}

impl HostEventV1Event {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PlayerEnded => "player.ended",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostEventV1 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventVersion")]
    pub event_version: i64,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "event")]
    pub event: HostEventV1Event,
    #[serde(rename = "sequence")]
    pub sequence: i64,
    #[serde(rename = "trackRef")]
    pub track_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostEventV2Event {
    #[serde(rename = "task.changed")]
    TaskChanged,
}

impl HostEventV2Event {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TaskChanged => "task.changed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostEventV2 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventVersion")]
    pub event_version: i64,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "event")]
    pub event: HostEventV2Event,
    #[serde(rename = "sequence")]
    pub sequence: i64,
    #[serde(rename = "task")]
    pub task: PluginTask,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum HostEvent {
    V0(Box<HostEventV0>),
    V1(Box<HostEventV1>),
    V2(Box<HostEventV2>),
}

impl crate::ProtocolDto for HostEvent {
    const SCHEMA: &'static str = "HostEvent";
}

fn is_host_event(v: &serde_json::Value) -> bool {
    is_schema_node_57(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UiNodeV0Type {
    #[serde(rename = "text")]
    Text,
}

impl UiNodeV0Type {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiNodeV0 {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: UiNodeV0Type,
    #[serde(rename = "text")]
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UiNodeV1Type {
    #[serde(rename = "button")]
    Button,
}

impl UiNodeV1Type {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Button => "button",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiNodeV1 {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: UiNodeV1Type,
    #[serde(rename = "label")]
    pub label: LocalizedText,
    #[serde(rename = "commandId")]
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UiNodeV2Type {
    #[serde(rename = "track-list")]
    TrackList,
}

impl UiNodeV2Type {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TrackList => "track-list",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiNodeV2 {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: UiNodeV2Type,
    #[serde(rename = "listingRef")]
    pub listing_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UiNodeV3Type {
    #[serde(rename = "form")]
    Form,
}

impl UiNodeV3Type {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Form => "form",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum UiNodeV3FieldsItemType {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "number")]
    Number,
    #[serde(rename = "checkbox")]
    Checkbox,
}

impl UiNodeV3FieldsItemType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "number",
            Self::Checkbox => "checkbox",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiNodeV3FieldsItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "label")]
    pub label: LocalizedText,
    #[serde(rename = "type")]
    pub r#type: UiNodeV3FieldsItemType,
    #[serde(rename = "maxLength", default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiNodeV3 {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: UiNodeV3Type,
    #[serde(rename = "label")]
    pub label: LocalizedText,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "fields")]
    pub fields: Vec<UiNodeV3FieldsItem>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum UiNode {
    V0(Box<UiNodeV0>),
    V1(Box<UiNodeV1>),
    V2(Box<UiNodeV2>),
    V3(Box<UiNodeV3>),
}

impl crate::ProtocolDto for UiNode {
    const SCHEMA: &'static str = "UiNode";
}

fn is_ui_node(v: &serde_json::Value) -> bool {
    is_schema_node_68(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiDocument {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "viewId")]
    pub view_id: String,
    #[serde(rename = "viewRevision")]
    pub view_revision: i64,
    #[serde(rename = "nodes")]
    pub nodes: Vec<UiNode>,
}

impl crate::ProtocolDto for UiDocument {
    const SCHEMA: &'static str = "UiDocument";
}

fn is_ui_document(v: &serde_json::Value) -> bool {
    is_schema_node_82(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiEventValuesItem {
    #[serde(rename = "fieldId")]
    pub field_id: String,
    #[serde(rename = "value")]
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiEvent {
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "viewId")]
    pub view_id: String,
    #[serde(rename = "viewRevision")]
    pub view_revision: i64,
    #[serde(rename = "nodeId")]
    pub node_id: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "values", default, skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<UiEventValuesItem>>,
}

impl crate::ProtocolDto for UiEvent {
    const SCHEMA: &'static str = "UiEvent";
}

fn is_ui_event(v: &serde_json::Value) -> bool {
    is_schema_node_85(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireTrackArtistsItem {
    #[serde(rename = "id", default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "name")]
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireTrackStatistics {
    #[serde(rename = "playCount", default, skip_serializing_if = "Option::is_none")]
    pub play_count: Option<i64>,
    #[serde(
        rename = "danmakuCount",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub danmaku_count: Option<i64>,
    #[serde(
        rename = "favoriteCount",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub favorite_count: Option<i64>,
    #[serde(
        rename = "commentCount",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub comment_count: Option<i64>,
    #[serde(rename = "likeCount", default, skip_serializing_if = "Option::is_none")]
    pub like_count: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WireTrackSourceMediaKind {
    #[serde(rename = "audio")]
    Audio,
    #[serde(rename = "video")]
    Video,
    #[serde(rename = "custom")]
    Custom,
}

impl WireTrackSourceMediaKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireTrackSource {
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    #[serde(rename = "mediaKind")]
    pub media_kind: WireTrackSourceMediaKind,
    #[serde(rename = "resourceId")]
    pub resource_id: String,
    #[serde(rename = "partId", default, skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
    #[serde(rename = "pageUrl", default, skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireTrack {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "artists")]
    pub artists: Vec<WireTrackArtistsItem>,
    #[serde(
        rename = "artworkUrl",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub artwork_url: Option<String>,
    #[serde(
        rename = "durationMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub duration_ms: Option<i64>,
    #[serde(
        rename = "publishedAtMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub published_at_ms: Option<i64>,
    #[serde(
        rename = "description",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub description: Option<String>,
    #[serde(
        rename = "sourceTags",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub source_tags: Option<Vec<String>>,
    #[serde(
        rename = "statistics",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub statistics: Option<WireTrackStatistics>,
    #[serde(rename = "source")]
    pub source: WireTrackSource,
}

impl crate::ProtocolDto for WireTrack {
    const SCHEMA: &'static str = "WireTrack";
}

fn is_wire_track(v: &serde_json::Value) -> bool {
    is_schema_node_89(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireTrackPage {
    #[serde(rename = "items")]
    pub items: Vec<WireTrack>,
    #[serde(rename = "pageNumber")]
    pub page_number: i64,
    #[serde(rename = "pageSize")]
    pub page_size: i64,
    #[serde(rename = "total", default, skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
    #[serde(rename = "hasMore")]
    pub has_more: bool,
}

impl crate::ProtocolDto for WireTrackPage {
    const SCHEMA: &'static str = "WireTrackPage";
}

fn is_wire_track_page(v: &serde_json::Value) -> bool {
    is_schema_node_98(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireListing {
    #[serde(rename = "listingRef")]
    pub listing_ref: String,
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "sourceUrl", default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(
        rename = "estimatedTotal",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub estimated_total: Option<i64>,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: i64,
}

impl crate::ProtocolDto for WireListing {
    const SCHEMA: &'static str = "WireListing";
}

fn is_wire_listing(v: &serde_json::Value) -> bool {
    is_schema_node_103(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireMediaQuality {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "label")]
    pub label: String,
    #[serde(rename = "rank")]
    pub rank: i64,
    #[serde(rename = "bitrate", default, skip_serializing_if = "Option::is_none")]
    pub bitrate: Option<i64>,
}

impl crate::ProtocolDto for WireMediaQuality {
    const SCHEMA: &'static str = "WireMediaQuality";
}

fn is_wire_media_quality(v: &serde_json::Value) -> bool {
    is_schema_node_104(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WireMediaLoadingStrategy {
    #[serde(rename = "range")]
    Range,
    #[serde(rename = "eager")]
    Eager,
}

impl WireMediaLoadingStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Range => "range",
            Self::Eager => "eager",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireMedia {
    #[serde(rename = "mediaRef")]
    pub media_ref: String,
    #[serde(rename = "quality")]
    pub quality: WireMediaQuality,
    #[serde(rename = "availableQualities")]
    pub available_qualities: Vec<WireMediaQuality>,
    #[serde(rename = "mimeType", default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "codecs", default, skip_serializing_if = "Option::is_none")]
    pub codecs: Option<String>,
    #[serde(
        rename = "durationMs",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub duration_ms: Option<i64>,
    #[serde(rename = "loadingStrategy")]
    pub loading_strategy: WireMediaLoadingStrategy,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: i64,
}

impl crate::ProtocolDto for WireMedia {
    const SCHEMA: &'static str = "WireMedia";
}

fn is_wire_media(v: &serde_json::Value) -> bool {
    is_schema_node_106(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicSearchInput {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "query")]
    pub query: String,
    #[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i64>,
}

impl crate::ProtocolDto for MusicSearchInput {
    const SCHEMA: &'static str = "MusicSearchInput";
}

fn is_music_search_input(v: &serde_json::Value) -> bool {
    is_schema_node_110(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicImportInput {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i64>,
}

impl crate::ProtocolDto for MusicImportInput {
    const SCHEMA: &'static str = "MusicImportInput";
}

fn is_music_import_input(v: &serde_json::Value) -> bool {
    is_schema_node_111(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicListingInput {
    #[serde(rename = "listingRef")]
    pub listing_ref: String,
}

impl crate::ProtocolDto for MusicListingInput {
    const SCHEMA: &'static str = "MusicListingInput";
}

fn is_music_listing_input(v: &serde_json::Value) -> bool {
    is_schema_node_112(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResolveInput {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "track")]
    pub track: WireTrack,
    #[serde(rename = "qualityId", default, skip_serializing_if = "Option::is_none")]
    pub quality_id: Option<String>,
    #[serde(rename = "taskId")]
    pub task_id: String,
}

impl crate::ProtocolDto for MusicResolveInput {
    const SCHEMA: &'static str = "MusicResolveInput";
}

fn is_music_resolve_input(v: &serde_json::Value) -> bool {
    is_schema_node_113(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicReleaseInput {
    #[serde(rename = "mediaRef")]
    pub media_ref: String,
}

impl crate::ProtocolDto for MusicReleaseInput {
    const SCHEMA: &'static str = "MusicReleaseInput";
}

fn is_music_release_input(v: &serde_json::Value) -> bool {
    is_schema_node_114(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicCancelInputV0 {
    #[serde(rename = "listingRef")]
    pub listing_ref: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicCancelInputV1 {
    #[serde(rename = "taskId")]
    pub task_id: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MusicCancelInput {
    V0(Box<MusicCancelInputV0>),
    V1(Box<MusicCancelInputV1>),
}

impl crate::ProtocolDto for MusicCancelInput {
    const SCHEMA: &'static str = "MusicCancelInput";
}

fn is_music_cancel_input(v: &serde_json::Value) -> bool {
    is_schema_node_115(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyResult {}

impl crate::ProtocolDto for EmptyResult {
    const SCHEMA: &'static str = "EmptyResult";
}

fn is_empty_result(v: &serde_json::Value) -> bool {
    is_schema_node_118(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateGetInput {
    #[serde(rename = "key")]
    pub key: String,
}

impl crate::ProtocolDto for StateGetInput {
    const SCHEMA: &'static str = "StateGetInput";
}

fn is_state_get_input(v: &serde_json::Value) -> bool {
    is_schema_node_119(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateSetInput {
    #[serde(rename = "key")]
    pub key: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: i64,
    #[serde(rename = "value")]
    pub value: String,
    #[serde(rename = "expectedVersion")]
    pub expected_version: i64,
    #[serde(rename = "operationId")]
    pub operation_id: String,
}

impl crate::ProtocolDto for StateSetInput {
    const SCHEMA: &'static str = "StateSetInput";
}

fn is_state_set_input(v: &serde_json::Value) -> bool {
    is_schema_node_120(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum StateValueValue {
    V0(Box<String>),
    V1(Box<()>),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateValue {
    #[serde(rename = "value")]
    pub value: StateValueValue,
    #[serde(rename = "version")]
    pub version: i64,
}

impl crate::ProtocolDto for StateValue {
    const SCHEMA: &'static str = "StateValue";
}

fn is_state_value(v: &serde_json::Value) -> bool {
    is_schema_node_122(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum NetworkInputMethod {
    #[serde(rename = "GET")]
    GET,
    #[serde(rename = "HEAD")]
    HEAD,
    #[serde(rename = "POST")]
    POST,
}

impl NetworkInputMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GET => "GET",
            Self::HEAD => "HEAD",
            Self::POST => "POST",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkInput {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "method")]
    pub method: NetworkInputMethod,
    #[serde(rename = "body", default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

impl crate::ProtocolDto for NetworkInput {
    const SCHEMA: &'static str = "NetworkInput";
}

fn is_network_input(v: &serde_json::Value) -> bool {
    is_schema_node_124(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkResult {
    #[serde(rename = "responseRef")]
    pub response_ref: String,
    #[serde(rename = "status")]
    pub status: i64,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: i64,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: i64,
}

impl crate::ProtocolDto for NetworkResult {
    const SCHEMA: &'static str = "NetworkResult";
}

fn is_network_result(v: &serde_json::Value) -> bool {
    is_schema_node_127(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseReadInput {
    #[serde(rename = "responseRef")]
    pub response_ref: String,
    #[serde(rename = "offset")]
    pub offset: i64,
    #[serde(rename = "length")]
    pub length: i64,
}

impl crate::ProtocolDto for ResponseReadInput {
    const SCHEMA: &'static str = "ResponseReadInput";
}

fn is_response_read_input(v: &serde_json::Value) -> bool {
    is_schema_node_130(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseChunk {
    #[serde(rename = "text")]
    pub text: String,
    #[serde(rename = "nextOffset")]
    pub next_offset: i64,
    #[serde(rename = "done")]
    pub done: bool,
}

impl crate::ProtocolDto for ResponseChunk {
    const SCHEMA: &'static str = "ResponseChunk";
}

fn is_response_chunk(v: &serde_json::Value) -> bool {
    is_schema_node_132(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseReleaseInput {
    #[serde(rename = "responseRef")]
    pub response_ref: String,
}

impl crate::ProtocolDto for ResponseReleaseInput {
    const SCHEMA: &'static str = "ResponseReleaseInput";
}

fn is_response_release_input(v: &serde_json::Value) -> bool {
    is_schema_node_134(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DigestInput {
    #[serde(rename = "text")]
    pub text: String,
}

impl crate::ProtocolDto for DigestInput {
    const SCHEMA: &'static str = "DigestInput";
}

fn is_digest_input(v: &serde_json::Value) -> bool {
    is_schema_node_135(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DigestResult {
    #[serde(rename = "hex")]
    pub hex: String,
}

impl crate::ProtocolDto for DigestResult {
    const SCHEMA: &'static str = "DigestResult";
}

fn is_digest_result(v: &serde_json::Value) -> bool {
    is_schema_node_136(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV0Operation {
    #[serde(rename = "state.get")]
    StateGet,
}

impl HostRequestV0Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateGet => "state.get",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV0 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV0Operation,
    #[serde(rename = "input")]
    pub input: StateGetInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV1Operation {
    #[serde(rename = "state.set")]
    StateSet,
}

impl HostRequestV1Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateSet => "state.set",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV1 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV1Operation,
    #[serde(rename = "input")]
    pub input: StateSetInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV2Operation {
    #[serde(rename = "network.request")]
    NetworkRequest,
}

impl HostRequestV2Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkRequest => "network.request",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV2 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV2Operation,
    #[serde(rename = "input")]
    pub input: NetworkInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV3Operation {
    #[serde(rename = "network.readResponse")]
    NetworkReadResponse,
}

impl HostRequestV3Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReadResponse => "network.readResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV3 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV3Operation,
    #[serde(rename = "input")]
    pub input: ResponseReadInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV4Operation {
    #[serde(rename = "network.releaseResponse")]
    NetworkReleaseResponse,
}

impl HostRequestV4Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReleaseResponse => "network.releaseResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV4 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV4Operation,
    #[serde(rename = "input")]
    pub input: ResponseReleaseInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostRequestV5Operation {
    #[serde(rename = "crypto.sha256")]
    CryptoSha256,
}

impl HostRequestV5Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CryptoSha256 => "crypto.sha256",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostRequestV5 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: HostRequestV5Operation,
    #[serde(rename = "input")]
    pub input: DigestInput,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum HostRequest {
    V0(Box<HostRequestV0>),
    V1(Box<HostRequestV1>),
    V2(Box<HostRequestV2>),
    V3(Box<HostRequestV3>),
    V4(Box<HostRequestV4>),
    V5(Box<HostRequestV5>),
}

impl crate::ProtocolDto for HostRequest {
    const SCHEMA: &'static str = "HostRequest";
}

fn is_host_request(v: &serde_json::Value) -> bool {
    is_schema_node_137(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV0Operation {
    #[serde(rename = "state.get")]
    StateGet,
}

impl HostResponseV0Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateGet => "state.get",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV0 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV0Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: StateValue,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV1Operation {
    #[serde(rename = "state.get")]
    StateGet,
}

impl HostResponseV1Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateGet => "state.get",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV1 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV1Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV2Operation {
    #[serde(rename = "state.set")]
    StateSet,
}

impl HostResponseV2Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateSet => "state.set",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV2 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV2Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: StateValue,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV3Operation {
    #[serde(rename = "state.set")]
    StateSet,
}

impl HostResponseV3Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StateSet => "state.set",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV3 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV3Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV4Operation {
    #[serde(rename = "network.request")]
    NetworkRequest,
}

impl HostResponseV4Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkRequest => "network.request",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV4 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV4Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: NetworkResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV5Operation {
    #[serde(rename = "network.request")]
    NetworkRequest,
}

impl HostResponseV5Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkRequest => "network.request",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV5 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV5Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV6Operation {
    #[serde(rename = "network.readResponse")]
    NetworkReadResponse,
}

impl HostResponseV6Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReadResponse => "network.readResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV6 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV6Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: ResponseChunk,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV7Operation {
    #[serde(rename = "network.readResponse")]
    NetworkReadResponse,
}

impl HostResponseV7Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReadResponse => "network.readResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV7 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV7Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV8Operation {
    #[serde(rename = "network.releaseResponse")]
    NetworkReleaseResponse,
}

impl HostResponseV8Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReleaseResponse => "network.releaseResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV8 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV8Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: EmptyResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV9Operation {
    #[serde(rename = "network.releaseResponse")]
    NetworkReleaseResponse,
}

impl HostResponseV9Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NetworkReleaseResponse => "network.releaseResponse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV9 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV9Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV10Operation {
    #[serde(rename = "crypto.sha256")]
    CryptoSha256,
}

impl HostResponseV10Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CryptoSha256 => "crypto.sha256",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV10 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV10Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: DigestResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HostResponseV11Operation {
    #[serde(rename = "crypto.sha256")]
    CryptoSha256,
}

impl HostResponseV11Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CryptoSha256 => "crypto.sha256",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostResponseV11 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: HostResponseV11Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum HostResponse {
    V0(Box<HostResponseV0>),
    V1(Box<HostResponseV1>),
    V2(Box<HostResponseV2>),
    V3(Box<HostResponseV3>),
    V4(Box<HostResponseV4>),
    V5(Box<HostResponseV5>),
    V6(Box<HostResponseV6>),
    V7(Box<HostResponseV7>),
    V8(Box<HostResponseV8>),
    V9(Box<HostResponseV9>),
    V10(Box<HostResponseV10>),
    V11(Box<HostResponseV11>),
}

impl crate::ProtocolDto for HostResponse {
    const SCHEMA: &'static str = "HostResponse";
}

fn is_host_response(v: &serde_json::Value) -> bool {
    is_schema_node_156(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV0Operation {
    #[serde(rename = "music.search")]
    MusicSearch,
}

impl MusicRequestV0Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicSearch => "music.search",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV0 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV0Operation,
    #[serde(rename = "input")]
    pub input: MusicSearchInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV1Operation {
    #[serde(rename = "music.importUrl")]
    MusicImportUrl,
}

impl MusicRequestV1Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicImportUrl => "music.importUrl",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV1 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV1Operation,
    #[serde(rename = "input")]
    pub input: MusicImportInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV2Operation {
    #[serde(rename = "music.nextPage")]
    MusicNextPage,
}

impl MusicRequestV2Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicNextPage => "music.nextPage",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV2 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV2Operation,
    #[serde(rename = "input")]
    pub input: MusicListingInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV3Operation {
    #[serde(rename = "music.close")]
    MusicClose,
}

impl MusicRequestV3Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicClose => "music.close",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV3 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV3Operation,
    #[serde(rename = "input")]
    pub input: MusicListingInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV4Operation {
    #[serde(rename = "music.cancel")]
    MusicCancel,
}

impl MusicRequestV4Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicCancel => "music.cancel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV4 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV4Operation,
    #[serde(rename = "input")]
    pub input: MusicCancelInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV5Operation {
    #[serde(rename = "music.resolveMedia")]
    MusicResolveMedia,
}

impl MusicRequestV5Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicResolveMedia => "music.resolveMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV5 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV5Operation,
    #[serde(rename = "input")]
    pub input: MusicResolveInput,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicRequestV6Operation {
    #[serde(rename = "music.releaseMedia")]
    MusicReleaseMedia,
}

impl MusicRequestV6Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicReleaseMedia => "music.releaseMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicRequestV6 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(rename = "operation")]
    pub operation: MusicRequestV6Operation,
    #[serde(rename = "input")]
    pub input: MusicReleaseInput,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MusicRequest {
    V0(Box<MusicRequestV0>),
    V1(Box<MusicRequestV1>),
    V2(Box<MusicRequestV2>),
    V3(Box<MusicRequestV3>),
    V4(Box<MusicRequestV4>),
    V5(Box<MusicRequestV5>),
    V6(Box<MusicRequestV6>),
}

impl crate::ProtocolDto for MusicRequest {
    const SCHEMA: &'static str = "MusicRequest";
}

fn is_music_request(v: &serde_json::Value) -> bool {
    is_schema_node_176(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV0Operation {
    #[serde(rename = "music.search")]
    MusicSearch,
}

impl MusicResponseV0Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicSearch => "music.search",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV0 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV0Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: WireListing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV1Operation {
    #[serde(rename = "music.search")]
    MusicSearch,
}

impl MusicResponseV1Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicSearch => "music.search",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV1 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV1Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV2Operation {
    #[serde(rename = "music.importUrl")]
    MusicImportUrl,
}

impl MusicResponseV2Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicImportUrl => "music.importUrl",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV2 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV2Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: WireListing,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV3Operation {
    #[serde(rename = "music.importUrl")]
    MusicImportUrl,
}

impl MusicResponseV3Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicImportUrl => "music.importUrl",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV3 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV3Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV4Operation {
    #[serde(rename = "music.nextPage")]
    MusicNextPage,
}

impl MusicResponseV4Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicNextPage => "music.nextPage",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV4 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV4Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: WireTrackPage,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV5Operation {
    #[serde(rename = "music.nextPage")]
    MusicNextPage,
}

impl MusicResponseV5Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicNextPage => "music.nextPage",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV5 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV5Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV6Operation {
    #[serde(rename = "music.close")]
    MusicClose,
}

impl MusicResponseV6Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicClose => "music.close",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV6 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV6Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: EmptyResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV7Operation {
    #[serde(rename = "music.close")]
    MusicClose,
}

impl MusicResponseV7Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicClose => "music.close",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV7 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV7Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV8Operation {
    #[serde(rename = "music.cancel")]
    MusicCancel,
}

impl MusicResponseV8Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicCancel => "music.cancel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV8 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV8Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: EmptyResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV9Operation {
    #[serde(rename = "music.cancel")]
    MusicCancel,
}

impl MusicResponseV9Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicCancel => "music.cancel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV9 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV9Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV10Operation {
    #[serde(rename = "music.resolveMedia")]
    MusicResolveMedia,
}

impl MusicResponseV10Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicResolveMedia => "music.resolveMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV10 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV10Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: WireMedia,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV11Operation {
    #[serde(rename = "music.resolveMedia")]
    MusicResolveMedia,
}

impl MusicResponseV11Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicResolveMedia => "music.resolveMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV11 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV11Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV12Operation {
    #[serde(rename = "music.releaseMedia")]
    MusicReleaseMedia,
}

impl MusicResponseV12Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicReleaseMedia => "music.releaseMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV12 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV12Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "result")]
    pub result: EmptyResult,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MusicResponseV13Operation {
    #[serde(rename = "music.releaseMedia")]
    MusicReleaseMedia,
}

impl MusicResponseV13Operation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MusicReleaseMedia => "music.releaseMedia",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MusicResponseV13 {
    #[serde(rename = "wireVersion")]
    pub wire_version: i64,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "operation")]
    pub operation: MusicResponseV13Operation,
    #[serde(rename = "ok")]
    pub ok: bool,
    #[serde(rename = "error")]
    pub error: WireError,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MusicResponse {
    V0(Box<MusicResponseV0>),
    V1(Box<MusicResponseV1>),
    V2(Box<MusicResponseV2>),
    V3(Box<MusicResponseV3>),
    V4(Box<MusicResponseV4>),
    V5(Box<MusicResponseV5>),
    V6(Box<MusicResponseV6>),
    V7(Box<MusicResponseV7>),
    V8(Box<MusicResponseV8>),
    V9(Box<MusicResponseV9>),
    V10(Box<MusicResponseV10>),
    V11(Box<MusicResponseV11>),
    V12(Box<MusicResponseV12>),
    V13(Box<MusicResponseV13>),
}

impl crate::ProtocolDto for MusicResponse {
    const SCHEMA: &'static str = "MusicResponse";
}

fn is_music_response(v: &serde_json::Value) -> bool {
    is_schema_node_197(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageIntegrityEntry {
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "size")]
    pub size: i64,
    #[serde(rename = "sha256")]
    pub sha256: String,
}

impl crate::ProtocolDto for PackageIntegrityEntry {
    const SCHEMA: &'static str = "PackageIntegrityEntry";
}

fn is_package_integrity_entry(v: &serde_json::Value) -> bool {
    is_schema_node_215(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageIntegrity {
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "files")]
    pub files: Vec<PackageIntegrityEntry>,
}

impl crate::ProtocolDto for PackageIntegrity {
    const SCHEMA: &'static str = "PackageIntegrity";
}

fn is_package_integrity(v: &serde_json::Value) -> bool {
    is_schema_node_219(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PackageSignatureAlgorithm {
    #[serde(rename = "Ed25519")]
    Ed25519,
}

impl PackageSignatureAlgorithm {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ed25519 => "Ed25519",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageSignature {
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "algorithm")]
    pub algorithm: PackageSignatureAlgorithm,
    #[serde(rename = "keyId")]
    pub key_id: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    #[serde(rename = "fingerprint")]
    pub fingerprint: String,
    #[serde(rename = "signature")]
    pub signature: String,
}

impl crate::ProtocolDto for PackageSignature {
    const SCHEMA: &'static str = "PackageSignature";
}

fn is_package_signature(v: &serde_json::Value) -> bool {
    is_schema_node_222(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageRevocations {
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "sequence")]
    pub sequence: i64,
    #[serde(rename = "issuedAtMs")]
    pub issued_at_ms: i64,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: i64,
    #[serde(rename = "pluginIds")]
    pub plugin_ids: Vec<String>,
    #[serde(rename = "packageHashes")]
    pub package_hashes: Vec<String>,
    #[serde(rename = "publisherKeys")]
    pub publisher_keys: Vec<String>,
}

impl crate::ProtocolDto for PackageRevocations {
    const SCHEMA: &'static str = "PackageRevocations";
}

fn is_package_revocations(v: &serde_json::Value) -> bool {
    is_schema_node_225(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GuestInvocationOperation {
    #[serde(rename = "command.run")]
    CommandRun,
    #[serde(rename = "music.search")]
    MusicSearch,
    #[serde(rename = "music.importUrl")]
    MusicImportUrl,
    #[serde(rename = "music.nextPage")]
    MusicNextPage,
    #[serde(rename = "music.close")]
    MusicClose,
    #[serde(rename = "music.cancel")]
    MusicCancel,
    #[serde(rename = "music.resolveMedia")]
    MusicResolveMedia,
    #[serde(rename = "music.releaseMedia")]
    MusicReleaseMedia,
    #[serde(rename = "migrate")]
    Migrate,
}

impl GuestInvocationOperation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CommandRun => "command.run",
            Self::MusicSearch => "music.search",
            Self::MusicImportUrl => "music.importUrl",
            Self::MusicNextPage => "music.nextPage",
            Self::MusicClose => "music.close",
            Self::MusicCancel => "music.cancel",
            Self::MusicResolveMedia => "music.resolveMedia",
            Self::MusicReleaseMedia => "music.releaseMedia",
            Self::Migrate => "migrate",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestInvocation {
    #[serde(rename = "commandId", default, skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    #[serde(rename = "operation")]
    pub operation: GuestInvocationOperation,
    #[serde(rename = "inputJson")]
    pub input_json: String,
    #[serde(rename = "contextRef")]
    pub context_ref: String,
    #[serde(rename = "sequence")]
    pub sequence: i64,
    #[serde(rename = "deadlineMs")]
    pub deadline_ms: i64,
    #[serde(
        rename = "checkpointJson",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub checkpoint_json: Option<String>,
    #[serde(rename = "response", default, skip_serializing_if = "Option::is_none")]
    pub response: Option<HostResponse>,
}

impl crate::ProtocolDto for GuestInvocation {
    const SCHEMA: &'static str = "GuestInvocation";
}

fn is_guest_invocation(v: &serde_json::Value) -> bool {
    is_schema_node_229(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GuestStepV0Kind {
    #[serde(rename = "complete")]
    Complete,
}

impl GuestStepV0Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Complete => "complete",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestStepV0 {
    #[serde(rename = "kind")]
    pub kind: GuestStepV0Kind,
    #[serde(rename = "outputJson")]
    pub output_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GuestStepV1Kind {
    #[serde(rename = "host")]
    Host,
}

impl GuestStepV1Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Host => "host",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestStepV1 {
    #[serde(rename = "kind")]
    pub kind: GuestStepV1Kind,
    #[serde(rename = "request")]
    pub request: HostRequest,
    #[serde(rename = "checkpointJson")]
    pub checkpoint_json: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum GuestStep {
    V0(Box<GuestStepV0>),
    V1(Box<GuestStepV1>),
}

impl crate::ProtocolDto for GuestStep {
    const SCHEMA: &'static str = "GuestStep";
}

fn is_guest_step(v: &serde_json::Value) -> bool {
    is_schema_node_232(v)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceCredentialField {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "label")]
    pub label: LocalizedText,
    #[serde(rename = "secret")]
    pub secret: bool,
}

impl crate::ProtocolDto for SourceCredentialField {
    const SCHEMA: &'static str = "SourceCredentialField";
}

fn is_source_credential_field(v: &serde_json::Value) -> bool {
    is_schema_node_238(v)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SourceAuthenticationMethodsItem {
    #[serde(rename = "qr")]
    Qr,
    #[serde(rename = "credentials")]
    Credentials,
    #[serde(rename = "phone")]
    Phone,
}

impl SourceAuthenticationMethodsItem {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Qr => "qr",
            Self::Credentials => "credentials",
            Self::Phone => "phone",
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceAuthentication {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i64,
    #[serde(rename = "apiBaseUrl")]
    pub api_base_url: String,
    #[serde(rename = "allowUnauthenticated")]
    pub allow_unauthenticated: bool,
    #[serde(rename = "methods")]
    pub methods: Vec<SourceAuthenticationMethodsItem>,
    #[serde(rename = "credentialFields")]
    pub credential_fields: Vec<SourceCredentialField>,
}

impl crate::ProtocolDto for SourceAuthentication {
    const SCHEMA: &'static str = "SourceAuthentication";
}

fn is_source_authentication(v: &serde_json::Value) -> bool {
    is_schema_node_239(v)
}

pub(crate) fn validate(name: &str, v: &serde_json::Value) -> bool {
    match name {
        "LocalizedText" => is_localized_text(v),
        "WireError" => is_wire_error(v),
        "CapabilityRequirement" => is_capability_requirement(v),
        "ExtensionRequirement" => is_extension_requirement(v),
        "ContributionScope" => is_contribution_scope(v),
        "ContributionDescriptor" => is_contribution_descriptor(v),
        "CommandDescriptor" => is_command_descriptor(v),
        "PluginManifest" => is_plugin_manifest(v),
        "HostCapabilities" => is_host_capabilities(v),
        "CommandContext" => is_command_context(v),
        "PluginTask" => is_plugin_task(v),
        "HostEvent" => is_host_event(v),
        "UiNode" => is_ui_node(v),
        "UiDocument" => is_ui_document(v),
        "UiEvent" => is_ui_event(v),
        "WireTrack" => is_wire_track(v),
        "WireTrackPage" => is_wire_track_page(v),
        "WireListing" => is_wire_listing(v),
        "WireMediaQuality" => is_wire_media_quality(v),
        "WireMedia" => is_wire_media(v),
        "MusicSearchInput" => is_music_search_input(v),
        "MusicImportInput" => is_music_import_input(v),
        "MusicListingInput" => is_music_listing_input(v),
        "MusicResolveInput" => is_music_resolve_input(v),
        "MusicReleaseInput" => is_music_release_input(v),
        "MusicCancelInput" => is_music_cancel_input(v),
        "EmptyResult" => is_empty_result(v),
        "StateGetInput" => is_state_get_input(v),
        "StateSetInput" => is_state_set_input(v),
        "StateValue" => is_state_value(v),
        "NetworkInput" => is_network_input(v),
        "NetworkResult" => is_network_result(v),
        "ResponseReadInput" => is_response_read_input(v),
        "ResponseChunk" => is_response_chunk(v),
        "ResponseReleaseInput" => is_response_release_input(v),
        "DigestInput" => is_digest_input(v),
        "DigestResult" => is_digest_result(v),
        "HostRequest" => is_host_request(v),
        "HostResponse" => is_host_response(v),
        "MusicRequest" => is_music_request(v),
        "MusicResponse" => is_music_response(v),
        "PackageIntegrityEntry" => is_package_integrity_entry(v),
        "PackageIntegrity" => is_package_integrity(v),
        "PackageSignature" => is_package_signature(v),
        "PackageRevocations" => is_package_revocations(v),
        "GuestInvocation" => is_guest_invocation(v),
        "GuestStep" => is_guest_step(v),
        "SourceCredentialField" => is_source_credential_field(v),
        "SourceAuthentication" => is_source_authentication(v),
        _ => false,
    }
}

pub const SDK_VERSION: &str = "0.1.0";

pub const MANIFEST_VERSION: i64 = 1;

pub const WIRE_VERSION: i64 = 1;

pub const CONTRIBUTION_VERSION: i64 = 1;

pub const RUNTIME_PROFILE_VERSION: i64 = 1;

pub const PACKAGE_FORMAT_VERSION: i64 = 1;

pub const DATA_SCHEMA_VERSION: i64 = 1;

pub const BUDGET_PROFILE_VERSION: i64 = 1;

pub const SCHEMA_ID: &str = "urn:any-music:plugin:protocol:1";

pub const CAPABILITIES: &[&str] = &[
    "state.read",
    "state.write",
    "network.publicHttps",
    "crypto.sha256",
    "source.authentication",
];

pub const EXTENSION_POINTS: &[&str] = &[
    "navigation.sidebar",
    "workspace.views",
    "track.actions.secondary",
    "track.details",
    "trackList.operator.actions",
    "trackList.filters",
    "settings.sections",
    "music.sources",
];

pub const LIMIT_MESSAGE_BYTES: usize = 262144;

pub const LIMIT_DEPTH: usize = 32;

pub const LIMIT_NODES: usize = 10000;

pub const LIMIT_STRING_CODE_POINTS: usize = 65536;
fn is_schema_node_1(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 1024)
}

fn is_schema_node_0(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["zh-CN", "en"].contains(&k.as_str()))
            && o.get("zh-CN").is_some_and(is_schema_node_1)
            && o.get("en").is_some_and(is_schema_node_1)
    })
}

fn is_schema_node_3(v: &serde_json::Value) -> bool {
    v.is_string()
        && [
            "invalid-input",
            "unsupported-version",
            "capability-unavailable",
            "operation-cancelled",
            "timeout",
            "limit-exceeded",
            "invalid-response",
            "upstream-error",
            "access-denied",
            "not-found",
            "rate-limited",
            "conflict",
            "not-authenticated",
            "account-unavailable",
            "unsupported-url",
            "verification-required",
            "pagination-unavailable",
            "network-error",
        ]
        .contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_4(v: &serde_json::Value) -> bool {
    v.is_boolean()
}

fn is_schema_node_2(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["code", "message", "isRetryable"].contains(&k.as_str()))
            && o.get("code").is_some_and(is_schema_node_3)
            && o.get("message").is_some_and(is_schema_node_1)
            && o.get("isRetryable").is_some_and(is_schema_node_4)
    })
}

fn is_schema_node_6(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 80)
}

fn is_schema_node_7(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (1..=65535).contains(&n))
}

fn is_schema_node_8(v: &serde_json::Value) -> bool {
    is_localized_text(v)
}

fn is_schema_node_5(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "version", "required", "reason"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("version").is_some_and(is_schema_node_7)
            && o.get("required").is_some_and(is_schema_node_4)
            && o.get("reason").is_some_and(is_schema_node_8)
    })
}

fn is_schema_node_10(v: &serde_json::Value) -> bool {
    v.is_string()
        && [
            "navigation.sidebar",
            "workspace.views",
            "track.actions.secondary",
            "track.details",
            "trackList.operator.actions",
            "trackList.filters",
            "settings.sections",
            "music.sources",
        ]
        .contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_9(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "version", "required"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_10)
            && o.get("version").is_some_and(is_schema_node_7)
            && o.get("required").is_some_and(is_schema_node_4)
    })
}

fn is_schema_node_13(v: &serde_json::Value) -> bool {
    v.is_string()
        && ["catalog", "queue", "favorites", "playlists", "history"]
            .contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_12(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 5 && a.iter().all(is_schema_node_13))
}

fn is_schema_node_15(v: &serde_json::Value) -> bool {
    v.is_string() && ["desktop", "mobile"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_14(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| !a.is_empty() && a.len() <= 2 && a.iter().all(is_schema_node_15))
}

fn is_schema_node_11(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["sections", "forms"].contains(&k.as_str()))
            && o.get("sections").is_some_and(is_schema_node_12)
            && o.get("forms").is_some_and(is_schema_node_14)
    })
}

fn is_schema_node_17(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-9007199254740991..=9007199254740991).contains(&n))
        && v == &serde_json::json!(1)
}

fn is_schema_node_18(v: &serde_json::Value) -> bool {
    is_contribution_scope(v)
}

fn is_schema_node_19(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("urn:any-music:plugin:command-context:1")
}

fn is_schema_node_20(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("urn:any-music:plugin:ui-event:1")
}

fn is_schema_node_21(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("many")
}

fn is_schema_node_22(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("hidden")
}

fn is_schema_node_16(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "contributionId",
                "pointId",
                "contractVersion",
                "required",
                "title",
                "scope",
                "commandId",
                "viewId",
                "providerId",
                "inputSchemaId",
                "eventSchemaId",
                "cardinality",
                "fallback",
                "budgetProfileVersion",
            ]
            .contains(&k.as_str())
        }) && o.get("contributionId").is_some_and(is_schema_node_6)
            && o.get("pointId").is_some_and(is_schema_node_10)
            && o.get("contractVersion").is_some_and(is_schema_node_17)
            && o.get("required").is_some_and(is_schema_node_4)
            && o.get("title").is_some_and(is_schema_node_8)
            && o.get("scope").is_some_and(is_schema_node_18)
            && o.get("commandId").is_none_or(is_schema_node_6)
            && o.get("viewId").is_none_or(is_schema_node_6)
            && o.get("providerId").is_none_or(is_schema_node_6)
            && o.get("inputSchemaId").is_some_and(is_schema_node_19)
            && o.get("eventSchemaId").is_some_and(is_schema_node_20)
            && o.get("cardinality").is_some_and(is_schema_node_21)
            && o.get("fallback").is_some_and(is_schema_node_22)
            && o.get("budgetProfileVersion").is_some_and(is_schema_node_17)
    })
}

fn is_schema_node_23(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["id", "title"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("title").is_some_and(is_schema_node_8)
    })
}

fn is_schema_node_25(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 256)
}

fn is_schema_node_26(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 128)
}

fn is_schema_node_27(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 64)
}

fn is_schema_node_28(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["minimum", "maximumExclusive"].contains(&k.as_str()))
            && o.get("minimum").is_some_and(is_schema_node_27)
            && o.get("maximumExclusive").is_some_and(is_schema_node_27)
    })
}

fn is_schema_node_29(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| !a.is_empty() && a.len() <= 8 && a.iter().all(is_schema_node_7))
}

fn is_schema_node_30(v: &serde_json::Value) -> bool {
    v.is_string() && ["declarative", "sandbox-code"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_31(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("dist/main.js")
}

fn is_schema_node_32(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("integrity.json")
}

fn is_schema_node_34(v: &serde_json::Value) -> bool {
    is_capability_requirement(v)
}

fn is_schema_node_33(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 32 && a.iter().all(is_schema_node_34))
}

fn is_schema_node_36(v: &serde_json::Value) -> bool {
    is_command_descriptor(v)
}

fn is_schema_node_35(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_36))
}

fn is_schema_node_38(v: &serde_json::Value) -> bool {
    is_contribution_descriptor(v)
}

fn is_schema_node_37(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_38))
}

fn is_schema_node_40(v: &serde_json::Value) -> bool {
    v.is_string()
        && ["on-command", "on-view", "on-source"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_39(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 3 && a.iter().all(is_schema_node_40))
}

fn is_schema_node_41(v: &serde_json::Value) -> bool {
    v.is_string() && ["minimum", "increased"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_42(v: &serde_json::Value) -> bool {
    is_source_authentication(v)
}

fn is_schema_node_24(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "$schema",
                "manifestVersion",
                "packageFormatVersion",
                "id",
                "version",
                "name",
                "description",
                "sdk",
                "wireVersions",
                "runtimeProfileVersion",
                "contributionVersion",
                "dataSchemaVersion",
                "execution",
                "entry",
                "integrity",
                "forms",
                "capabilities",
                "commands",
                "contributions",
                "activationEvents",
                "memoryClass",
                "sourceAuthentication",
            ]
            .contains(&k.as_str())
        }) && o.get("$schema").is_none_or(is_schema_node_25)
            && o.get("manifestVersion").is_some_and(is_schema_node_17)
            && o.get("packageFormatVersion").is_some_and(is_schema_node_17)
            && o.get("id").is_some_and(is_schema_node_26)
            && o.get("version").is_some_and(is_schema_node_27)
            && o.get("name").is_some_and(is_schema_node_8)
            && o.get("description").is_some_and(is_schema_node_8)
            && o.get("sdk").is_some_and(is_schema_node_28)
            && o.get("wireVersions").is_some_and(is_schema_node_29)
            && o.get("runtimeProfileVersion").is_some_and(is_schema_node_7)
            && o.get("contributionVersion").is_some_and(is_schema_node_7)
            && o.get("dataSchemaVersion").is_some_and(is_schema_node_7)
            && o.get("execution").is_some_and(is_schema_node_30)
            && o.get("entry").is_none_or(is_schema_node_31)
            && o.get("integrity").is_some_and(is_schema_node_32)
            && o.get("forms").is_some_and(is_schema_node_14)
            && o.get("capabilities").is_some_and(is_schema_node_33)
            && o.get("commands").is_some_and(is_schema_node_35)
            && o.get("contributions").is_some_and(is_schema_node_37)
            && o.get("activationEvents").is_some_and(is_schema_node_39)
            && o.get("memoryClass").is_some_and(is_schema_node_41)
            && o.get("sourceAuthentication").is_none_or(is_schema_node_42)
    })
}

fn is_schema_node_44(v: &serde_json::Value) -> bool {
    v.is_string()
        && ["none", "declarative", "sandbox-code"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_46(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["id", "versions"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("versions").is_some_and(is_schema_node_29)
    })
}

fn is_schema_node_45(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 64 && a.iter().all(is_schema_node_46))
}

fn is_schema_node_43(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "sdkVersion",
                "manifestVersions",
                "wireVersions",
                "runtimeProfileVersions",
                "contributionVersions",
                "packageFormatVersions",
                "dataSchemaVersions",
                "form",
                "externalPlugins",
                "sandboxAvailable",
                "capabilities",
                "extensionPoints",
            ]
            .contains(&k.as_str())
        }) && o.get("sdkVersion").is_some_and(is_schema_node_27)
            && o.get("manifestVersions").is_some_and(is_schema_node_29)
            && o.get("wireVersions").is_some_and(is_schema_node_29)
            && o.get("runtimeProfileVersions")
                .is_some_and(is_schema_node_29)
            && o.get("contributionVersions").is_some_and(is_schema_node_29)
            && o.get("packageFormatVersions")
                .is_some_and(is_schema_node_29)
            && o.get("dataSchemaVersions").is_some_and(is_schema_node_29)
            && o.get("form").is_some_and(is_schema_node_15)
            && o.get("externalPlugins").is_some_and(is_schema_node_44)
            && o.get("sandboxAvailable").is_some_and(is_schema_node_4)
            && o.get("capabilities").is_some_and(is_schema_node_45)
            && o.get("extensionPoints").is_some_and(is_schema_node_45)
    })
}

fn is_schema_node_50(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (0..=9007199254740991).contains(&n))
}

fn is_schema_node_49(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["id", "version"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_25)
            && o.get("version").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_48(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_49))
}

fn is_schema_node_47(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["contextRef", "scope", "objectRefs", "expiresAtMs"].contains(&k.as_str()))
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("scope").is_some_and(is_schema_node_18)
            && o.get("objectRefs").is_some_and(is_schema_node_48)
            && o.get("expiresAtMs").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_53(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("failed")
}

fn is_schema_node_54(v: &serde_json::Value) -> bool {
    is_wire_error(v)
}

fn is_schema_node_52(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "taskId",
                "contextRef",
                "deadlineMs",
                "state",
                "completed",
                "total",
                "error",
            ]
            .contains(&k.as_str())
        }) && o.get("taskId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("state").is_some_and(is_schema_node_53)
            && o.get("completed").is_some_and(is_schema_node_50)
            && o.get("total").is_none_or(is_schema_node_50)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_56(v: &serde_json::Value) -> bool {
    v.is_string()
        && ["queued", "running", "succeeded", "cancelled"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_55(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "taskId",
                "contextRef",
                "deadlineMs",
                "state",
                "completed",
                "total",
            ]
            .contains(&k.as_str())
        }) && o.get("taskId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("state").is_some_and(is_schema_node_56)
            && o.get("completed").is_some_and(is_schema_node_50)
            && o.get("total").is_none_or(is_schema_node_50)
    })
}

fn is_schema_node_51(v: &serde_json::Value) -> bool {
    [is_schema_node_52(v), is_schema_node_55(v)]
        .into_iter()
        .filter(|accepted| *accepted)
        .count()
        == 1
}

fn is_schema_node_59(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-9007199254740991..=9007199254740991).contains(&n))
        && v == &serde_json::json!(1)
}

fn is_schema_node_60(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("player.track-changed")
}

fn is_schema_node_62(v: &serde_json::Value) -> bool {
    v.is_null()
}

fn is_schema_node_61(v: &serde_json::Value) -> bool {
    [is_schema_node_25(v), is_schema_node_62(v)]
        .into_iter()
        .filter(|accepted| *accepted)
        .count()
        == 1
}

fn is_schema_node_58(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "eventId",
                "eventVersion",
                "contextRef",
                "event",
                "sequence",
                "trackRef",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("eventId").is_some_and(is_schema_node_26)
            && o.get("eventVersion").is_some_and(is_schema_node_59)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("event").is_some_and(is_schema_node_60)
            && o.get("sequence").is_some_and(is_schema_node_50)
            && o.get("trackRef").is_some_and(is_schema_node_61)
    })
}

fn is_schema_node_64(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("player.ended")
}

fn is_schema_node_63(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "eventId",
                "eventVersion",
                "contextRef",
                "event",
                "sequence",
                "trackRef",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("eventId").is_some_and(is_schema_node_26)
            && o.get("eventVersion").is_some_and(is_schema_node_59)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("event").is_some_and(is_schema_node_64)
            && o.get("sequence").is_some_and(is_schema_node_50)
            && o.get("trackRef").is_some_and(is_schema_node_25)
    })
}

fn is_schema_node_66(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("task.changed")
}

fn is_schema_node_67(v: &serde_json::Value) -> bool {
    is_plugin_task(v)
}

fn is_schema_node_65(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "eventId",
                "eventVersion",
                "contextRef",
                "event",
                "sequence",
                "task",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("eventId").is_some_and(is_schema_node_26)
            && o.get("eventVersion").is_some_and(is_schema_node_59)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("event").is_some_and(is_schema_node_66)
            && o.get("sequence").is_some_and(is_schema_node_50)
            && o.get("task").is_some_and(is_schema_node_67)
    })
}

fn is_schema_node_57(v: &serde_json::Value) -> bool {
    [
        is_schema_node_58(v),
        is_schema_node_63(v),
        is_schema_node_65(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_70(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("text")
}

fn is_schema_node_71(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 4096)
}

fn is_schema_node_69(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "type", "text"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("type").is_some_and(is_schema_node_70)
            && o.get("text").is_some_and(is_schema_node_71)
    })
}

fn is_schema_node_73(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("button")
}

fn is_schema_node_72(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "type", "label", "commandId"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("type").is_some_and(is_schema_node_73)
            && o.get("label").is_some_and(is_schema_node_8)
            && o.get("commandId").is_some_and(is_schema_node_6)
    })
}

fn is_schema_node_75(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("track-list")
}

fn is_schema_node_74(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "type", "listingRef"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("type").is_some_and(is_schema_node_75)
            && o.get("listingRef").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_77(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("form")
}

fn is_schema_node_80(v: &serde_json::Value) -> bool {
    v.is_string() && ["text", "number", "checkbox"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_81(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (1..=256).contains(&n))
}

fn is_schema_node_79(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "label", "type", "maxLength"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("label").is_some_and(is_schema_node_8)
            && o.get("type").is_some_and(is_schema_node_80)
            && o.get("maxLength").is_none_or(is_schema_node_81)
    })
}

fn is_schema_node_78(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| !a.is_empty() && a.len() <= 16 && a.iter().all(is_schema_node_79))
}

fn is_schema_node_76(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "type", "label", "commandId", "fields"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("type").is_some_and(is_schema_node_77)
            && o.get("label").is_some_and(is_schema_node_8)
            && o.get("commandId").is_some_and(is_schema_node_6)
            && o.get("fields").is_some_and(is_schema_node_78)
    })
}

fn is_schema_node_68(v: &serde_json::Value) -> bool {
    [
        is_schema_node_69(v),
        is_schema_node_72(v),
        is_schema_node_74(v),
        is_schema_node_76(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_84(v: &serde_json::Value) -> bool {
    is_ui_node(v)
}

fn is_schema_node_83(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 1000 && a.iter().all(is_schema_node_84))
}

fn is_schema_node_82(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["schemaVersion", "viewId", "viewRevision", "nodes"].contains(&k.as_str()))
            && o.get("schemaVersion").is_some_and(is_schema_node_17)
            && o.get("viewId").is_some_and(is_schema_node_6)
            && o.get("viewRevision").is_some_and(is_schema_node_50)
            && o.get("nodes").is_some_and(is_schema_node_83)
    })
}

fn is_schema_node_88(v: &serde_json::Value) -> bool {
    v.as_str().is_some_and(|s| s.chars().count() <= 256)
}

fn is_schema_node_87(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["fieldId", "value"].contains(&k.as_str()))
            && o.get("fieldId").is_some_and(is_schema_node_6)
            && o.get("value").is_some_and(is_schema_node_88)
    })
}

fn is_schema_node_86(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 16 && a.iter().all(is_schema_node_87))
}

fn is_schema_node_85(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "schemaVersion",
                "viewId",
                "viewRevision",
                "nodeId",
                "commandId",
                "contextRef",
                "values",
            ]
            .contains(&k.as_str())
        }) && o.get("schemaVersion").is_some_and(is_schema_node_17)
            && o.get("viewId").is_some_and(is_schema_node_6)
            && o.get("viewRevision").is_some_and(is_schema_node_50)
            && o.get("nodeId").is_some_and(is_schema_node_6)
            && o.get("commandId").is_some_and(is_schema_node_6)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("values").is_none_or(is_schema_node_86)
    })
}

fn is_schema_node_91(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["id", "name"].contains(&k.as_str()))
            && o.get("id").is_none_or(is_schema_node_25)
            && o.get("name").is_some_and(is_schema_node_1)
    })
}

fn is_schema_node_90(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_91))
}

fn is_schema_node_92(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 8192)
}

fn is_schema_node_93(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 16384)
}

fn is_schema_node_94(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_25))
}

fn is_schema_node_95(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "playCount",
                "danmakuCount",
                "favoriteCount",
                "commentCount",
                "likeCount",
            ]
            .contains(&k.as_str())
        }) && o.get("playCount").is_none_or(is_schema_node_50)
            && o.get("danmakuCount").is_none_or(is_schema_node_50)
            && o.get("favoriteCount").is_none_or(is_schema_node_50)
            && o.get("commentCount").is_none_or(is_schema_node_50)
            && o.get("likeCount").is_none_or(is_schema_node_50)
    })
}

fn is_schema_node_97(v: &serde_json::Value) -> bool {
    v.is_string() && ["audio", "video", "custom"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_96(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["pluginId", "mediaKind", "resourceId", "partId", "pageUrl"].contains(&k.as_str())
        }) && o.get("pluginId").is_some_and(is_schema_node_26)
            && o.get("mediaKind").is_some_and(is_schema_node_97)
            && o.get("resourceId").is_some_and(is_schema_node_25)
            && o.get("partId").is_none_or(is_schema_node_25)
            && o.get("pageUrl").is_none_or(is_schema_node_92)
    })
}

fn is_schema_node_89(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "id",
                "title",
                "artists",
                "artworkUrl",
                "durationMs",
                "publishedAtMs",
                "description",
                "sourceTags",
                "statistics",
                "source",
            ]
            .contains(&k.as_str())
        }) && o.get("id").is_some_and(is_schema_node_25)
            && o.get("title").is_some_and(is_schema_node_71)
            && o.get("artists").is_some_and(is_schema_node_90)
            && o.get("artworkUrl").is_none_or(is_schema_node_92)
            && o.get("durationMs").is_none_or(is_schema_node_50)
            && o.get("publishedAtMs").is_none_or(is_schema_node_50)
            && o.get("description").is_none_or(is_schema_node_93)
            && o.get("sourceTags").is_none_or(is_schema_node_94)
            && o.get("statistics").is_none_or(is_schema_node_95)
            && o.get("source").is_some_and(is_schema_node_96)
    })
}

fn is_schema_node_100(v: &serde_json::Value) -> bool {
    is_wire_track(v)
}

fn is_schema_node_99(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 100 && a.iter().all(is_schema_node_100))
}

fn is_schema_node_101(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (1..=9007199254740991).contains(&n))
}

fn is_schema_node_102(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (1..=100).contains(&n))
}

fn is_schema_node_98(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["items", "pageNumber", "pageSize", "total", "hasMore"].contains(&k.as_str()))
            && o.get("items").is_some_and(is_schema_node_99)
            && o.get("pageNumber").is_some_and(is_schema_node_101)
            && o.get("pageSize").is_some_and(is_schema_node_102)
            && o.get("total").is_none_or(is_schema_node_50)
            && o.get("hasMore").is_some_and(is_schema_node_4)
    })
}

fn is_schema_node_103(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "listingRef",
                "id",
                "title",
                "sourceUrl",
                "estimatedTotal",
                "expiresAtMs",
            ]
            .contains(&k.as_str())
        }) && o.get("listingRef").is_some_and(is_schema_node_26)
            && o.get("id").is_some_and(is_schema_node_25)
            && o.get("title").is_some_and(is_schema_node_1)
            && o.get("sourceUrl").is_none_or(is_schema_node_92)
            && o.get("estimatedTotal").is_none_or(is_schema_node_50)
            && o.get("expiresAtMs").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_105(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-1000000..=1000000).contains(&n))
}

fn is_schema_node_104(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "label", "rank", "bitrate"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_6)
            && o.get("label").is_some_and(is_schema_node_25)
            && o.get("rank").is_some_and(is_schema_node_105)
            && o.get("bitrate").is_none_or(is_schema_node_50)
    })
}

fn is_schema_node_107(v: &serde_json::Value) -> bool {
    is_wire_media_quality(v)
}

fn is_schema_node_108(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| !a.is_empty() && a.len() <= 32 && a.iter().all(is_schema_node_107))
}

fn is_schema_node_109(v: &serde_json::Value) -> bool {
    v.is_string() && ["range", "eager"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_106(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "mediaRef",
                "quality",
                "availableQualities",
                "mimeType",
                "codecs",
                "durationMs",
                "loadingStrategy",
                "expiresAtMs",
            ]
            .contains(&k.as_str())
        }) && o.get("mediaRef").is_some_and(is_schema_node_26)
            && o.get("quality").is_some_and(is_schema_node_107)
            && o.get("availableQualities").is_some_and(is_schema_node_108)
            && o.get("mimeType").is_none_or(is_schema_node_25)
            && o.get("codecs").is_none_or(is_schema_node_25)
            && o.get("durationMs").is_none_or(is_schema_node_50)
            && o.get("loadingStrategy").is_some_and(is_schema_node_109)
            && o.get("expiresAtMs").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_110(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["providerId", "query", "pageSize"].contains(&k.as_str()))
            && o.get("providerId").is_some_and(is_schema_node_26)
            && o.get("query").is_some_and(is_schema_node_71)
            && o.get("pageSize").is_none_or(is_schema_node_102)
    })
}

fn is_schema_node_111(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["providerId", "url", "pageSize"].contains(&k.as_str()))
            && o.get("providerId").is_some_and(is_schema_node_26)
            && o.get("url").is_some_and(is_schema_node_92)
            && o.get("pageSize").is_none_or(is_schema_node_102)
    })
}

fn is_schema_node_112(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["listingRef"].contains(&k.as_str()))
            && o.get("listingRef").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_113(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["providerId", "track", "qualityId", "taskId"].contains(&k.as_str()))
            && o.get("providerId").is_some_and(is_schema_node_26)
            && o.get("track").is_some_and(is_schema_node_100)
            && o.get("qualityId").is_none_or(is_schema_node_6)
            && o.get("taskId").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_114(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["mediaRef"].contains(&k.as_str()))
            && o.get("mediaRef").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_116(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["listingRef"].contains(&k.as_str()))
            && o.get("listingRef").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_117(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["taskId"].contains(&k.as_str()))
            && o.get("taskId").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_115(v: &serde_json::Value) -> bool {
    [is_schema_node_116(v), is_schema_node_117(v)]
        .into_iter()
        .filter(|accepted| *accepted)
        .count()
        == 1
}

fn is_schema_node_118(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| o.is_empty())
}

fn is_schema_node_119(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["key"].contains(&k.as_str()))
            && o.get("key").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_121(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 65536)
}

fn is_schema_node_120(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "key",
                "schemaVersion",
                "value",
                "expectedVersion",
                "operationId",
            ]
            .contains(&k.as_str())
        }) && o.get("key").is_some_and(is_schema_node_26)
            && o.get("schemaVersion").is_some_and(is_schema_node_7)
            && o.get("value").is_some_and(is_schema_node_121)
            && o.get("expectedVersion").is_some_and(is_schema_node_50)
            && o.get("operationId").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_123(v: &serde_json::Value) -> bool {
    [is_schema_node_121(v), is_schema_node_62(v)]
        .into_iter()
        .filter(|accepted| *accepted)
        .count()
        == 1
}

fn is_schema_node_122(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["value", "version"].contains(&k.as_str()))
            && o.get("value").is_some_and(is_schema_node_123)
            && o.get("version").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_125(v: &serde_json::Value) -> bool {
    v.is_string() && ["GET", "HEAD", "POST"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_126(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 131072)
}

fn is_schema_node_124(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["url", "method", "body"].contains(&k.as_str()))
            && o.get("url").is_some_and(is_schema_node_92)
            && o.get("method").is_some_and(is_schema_node_125)
            && o.get("body").is_none_or(is_schema_node_126)
    })
}

fn is_schema_node_128(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (100..=599).contains(&n))
}

fn is_schema_node_129(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (0..=4194304).contains(&n))
}

fn is_schema_node_127(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["responseRef", "status", "sizeBytes", "expiresAtMs"].contains(&k.as_str()))
            && o.get("responseRef").is_some_and(is_schema_node_26)
            && o.get("status").is_some_and(is_schema_node_128)
            && o.get("sizeBytes").is_some_and(is_schema_node_129)
            && o.get("expiresAtMs").is_some_and(is_schema_node_50)
    })
}

fn is_schema_node_131(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (1..=65536).contains(&n))
}

fn is_schema_node_130(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["responseRef", "offset", "length"].contains(&k.as_str()))
            && o.get("responseRef").is_some_and(is_schema_node_26)
            && o.get("offset").is_some_and(is_schema_node_129)
            && o.get("length").is_some_and(is_schema_node_131)
    })
}

fn is_schema_node_133(v: &serde_json::Value) -> bool {
    v.as_str().is_some_and(|s| s.chars().count() <= 65536)
}

fn is_schema_node_132(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["text", "nextOffset", "done"].contains(&k.as_str()))
            && o.get("text").is_some_and(is_schema_node_133)
            && o.get("nextOffset").is_some_and(is_schema_node_129)
            && o.get("done").is_some_and(is_schema_node_4)
    })
}

fn is_schema_node_134(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["responseRef"].contains(&k.as_str()))
            && o.get("responseRef").is_some_and(is_schema_node_26)
    })
}

fn is_schema_node_135(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["text"].contains(&k.as_str()))
            && o.get("text").is_some_and(is_schema_node_121)
    })
}

fn is_schema_node_136(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["hex"].contains(&k.as_str()))
            && o.get("hex").is_some_and(is_schema_node_27)
    })
}

fn is_schema_node_139(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("state.get")
}

fn is_schema_node_140(v: &serde_json::Value) -> bool {
    is_state_get_input(v)
}

fn is_schema_node_138(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_139)
            && o.get("input").is_some_and(is_schema_node_140)
    })
}

fn is_schema_node_142(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("state.set")
}

fn is_schema_node_143(v: &serde_json::Value) -> bool {
    is_state_set_input(v)
}

fn is_schema_node_141(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_142)
            && o.get("input").is_some_and(is_schema_node_143)
    })
}

fn is_schema_node_145(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("network.request")
}

fn is_schema_node_146(v: &serde_json::Value) -> bool {
    is_network_input(v)
}

fn is_schema_node_144(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_145)
            && o.get("input").is_some_and(is_schema_node_146)
    })
}

fn is_schema_node_148(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("network.readResponse")
}

fn is_schema_node_149(v: &serde_json::Value) -> bool {
    is_response_read_input(v)
}

fn is_schema_node_147(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_148)
            && o.get("input").is_some_and(is_schema_node_149)
    })
}

fn is_schema_node_151(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("network.releaseResponse")
}

fn is_schema_node_152(v: &serde_json::Value) -> bool {
    is_response_release_input(v)
}

fn is_schema_node_150(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_151)
            && o.get("input").is_some_and(is_schema_node_152)
    })
}

fn is_schema_node_154(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("crypto.sha256")
}

fn is_schema_node_155(v: &serde_json::Value) -> bool {
    is_digest_input(v)
}

fn is_schema_node_153(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_154)
            && o.get("input").is_some_and(is_schema_node_155)
    })
}

fn is_schema_node_137(v: &serde_json::Value) -> bool {
    [
        is_schema_node_138(v),
        is_schema_node_141(v),
        is_schema_node_144(v),
        is_schema_node_147(v),
        is_schema_node_150(v),
        is_schema_node_153(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_158(v: &serde_json::Value) -> bool {
    v.is_boolean() && v == &serde_json::json!(true)
}

fn is_schema_node_159(v: &serde_json::Value) -> bool {
    is_state_value(v)
}

fn is_schema_node_157(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_139)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_159)
    })
}

fn is_schema_node_161(v: &serde_json::Value) -> bool {
    v.is_boolean() && v == &serde_json::json!(false)
}

fn is_schema_node_160(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_139)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_162(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_142)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_159)
    })
}

fn is_schema_node_163(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_142)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_165(v: &serde_json::Value) -> bool {
    is_network_result(v)
}

fn is_schema_node_164(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_145)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_165)
    })
}

fn is_schema_node_166(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_145)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_168(v: &serde_json::Value) -> bool {
    is_response_chunk(v)
}

fn is_schema_node_167(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_148)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_168)
    })
}

fn is_schema_node_169(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_148)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_171(v: &serde_json::Value) -> bool {
    is_empty_result(v)
}

fn is_schema_node_170(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_151)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_171)
    })
}

fn is_schema_node_172(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_151)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_174(v: &serde_json::Value) -> bool {
    is_digest_result(v)
}

fn is_schema_node_173(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_154)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_174)
    })
}

fn is_schema_node_175(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_154)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_156(v: &serde_json::Value) -> bool {
    [
        is_schema_node_157(v),
        is_schema_node_160(v),
        is_schema_node_162(v),
        is_schema_node_163(v),
        is_schema_node_164(v),
        is_schema_node_166(v),
        is_schema_node_167(v),
        is_schema_node_169(v),
        is_schema_node_170(v),
        is_schema_node_172(v),
        is_schema_node_173(v),
        is_schema_node_175(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_178(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.search")
}

fn is_schema_node_179(v: &serde_json::Value) -> bool {
    is_music_search_input(v)
}

fn is_schema_node_177(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_178)
            && o.get("input").is_some_and(is_schema_node_179)
    })
}

fn is_schema_node_181(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.importUrl")
}

fn is_schema_node_182(v: &serde_json::Value) -> bool {
    is_music_import_input(v)
}

fn is_schema_node_180(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_181)
            && o.get("input").is_some_and(is_schema_node_182)
    })
}

fn is_schema_node_184(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.nextPage")
}

fn is_schema_node_185(v: &serde_json::Value) -> bool {
    is_music_listing_input(v)
}

fn is_schema_node_183(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_184)
            && o.get("input").is_some_and(is_schema_node_185)
    })
}

fn is_schema_node_187(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.close")
}

fn is_schema_node_186(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_187)
            && o.get("input").is_some_and(is_schema_node_185)
    })
}

fn is_schema_node_189(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.cancel")
}

fn is_schema_node_190(v: &serde_json::Value) -> bool {
    is_music_cancel_input(v)
}

fn is_schema_node_188(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_189)
            && o.get("input").is_some_and(is_schema_node_190)
    })
}

fn is_schema_node_192(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.resolveMedia")
}

fn is_schema_node_193(v: &serde_json::Value) -> bool {
    is_music_resolve_input(v)
}

fn is_schema_node_191(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_192)
            && o.get("input").is_some_and(is_schema_node_193)
    })
}

fn is_schema_node_195(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("music.releaseMedia")
}

fn is_schema_node_196(v: &serde_json::Value) -> bool {
    is_music_release_input(v)
}

fn is_schema_node_194(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "wireVersion",
                "requestId",
                "contextRef",
                "deadlineMs",
                "operation",
                "input",
            ]
            .contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("operation").is_some_and(is_schema_node_195)
            && o.get("input").is_some_and(is_schema_node_196)
    })
}

fn is_schema_node_176(v: &serde_json::Value) -> bool {
    [
        is_schema_node_177(v),
        is_schema_node_180(v),
        is_schema_node_183(v),
        is_schema_node_186(v),
        is_schema_node_188(v),
        is_schema_node_191(v),
        is_schema_node_194(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_199(v: &serde_json::Value) -> bool {
    is_wire_listing(v)
}

fn is_schema_node_198(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_178)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_199)
    })
}

fn is_schema_node_200(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_178)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_201(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_181)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_199)
    })
}

fn is_schema_node_202(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_181)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_204(v: &serde_json::Value) -> bool {
    is_wire_track_page(v)
}

fn is_schema_node_203(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_184)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_204)
    })
}

fn is_schema_node_205(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_184)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_206(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_187)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_171)
    })
}

fn is_schema_node_207(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_187)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_208(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_189)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_171)
    })
}

fn is_schema_node_209(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_189)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_211(v: &serde_json::Value) -> bool {
    is_wire_media(v)
}

fn is_schema_node_210(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_192)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_211)
    })
}

fn is_schema_node_212(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_192)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_213(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            ["wireVersion", "requestId", "operation", "ok", "result"].contains(&k.as_str())
        }) && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_195)
            && o.get("ok").is_some_and(is_schema_node_158)
            && o.get("result").is_some_and(is_schema_node_171)
    })
}

fn is_schema_node_214(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["wireVersion", "requestId", "operation", "ok", "error"].contains(&k.as_str()))
            && o.get("wireVersion").is_some_and(is_schema_node_59)
            && o.get("requestId").is_some_and(is_schema_node_26)
            && o.get("operation").is_some_and(is_schema_node_195)
            && o.get("ok").is_some_and(is_schema_node_161)
            && o.get("error").is_some_and(is_schema_node_54)
    })
}

fn is_schema_node_197(v: &serde_json::Value) -> bool {
    [
        is_schema_node_198(v),
        is_schema_node_200(v),
        is_schema_node_201(v),
        is_schema_node_202(v),
        is_schema_node_203(v),
        is_schema_node_205(v),
        is_schema_node_206(v),
        is_schema_node_207(v),
        is_schema_node_208(v),
        is_schema_node_209(v),
        is_schema_node_210(v),
        is_schema_node_212(v),
        is_schema_node_213(v),
        is_schema_node_214(v),
    ]
    .into_iter()
    .filter(|accepted| *accepted)
    .count()
        == 1
}

fn is_schema_node_216(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 240)
}

fn is_schema_node_217(v: &serde_json::Value) -> bool {
    v.as_i64().is_some_and(|n| (0..=8388608).contains(&n))
}

fn is_schema_node_218(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 64 && s.chars().count() <= 64)
}

fn is_schema_node_215(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["path", "size", "sha256"].contains(&k.as_str()))
            && o.get("path").is_some_and(is_schema_node_216)
            && o.get("size").is_some_and(is_schema_node_217)
            && o.get("sha256").is_some_and(is_schema_node_218)
    })
}

fn is_schema_node_221(v: &serde_json::Value) -> bool {
    is_package_integrity_entry(v)
}

fn is_schema_node_220(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 1024 && a.iter().all(is_schema_node_221))
}

fn is_schema_node_219(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| ["version", "files"].contains(&k.as_str()))
            && o.get("version").is_some_and(is_schema_node_17)
            && o.get("files").is_some_and(is_schema_node_220)
    })
}

fn is_schema_node_223(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("Ed25519")
}

fn is_schema_node_224(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 128 && s.chars().count() <= 128)
}

fn is_schema_node_222(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "version",
                "algorithm",
                "keyId",
                "publicKey",
                "fingerprint",
                "signature",
            ]
            .contains(&k.as_str())
        }) && o.get("version").is_some_and(is_schema_node_17)
            && o.get("algorithm").is_some_and(is_schema_node_223)
            && o.get("keyId").is_some_and(is_schema_node_26)
            && o.get("publicKey").is_some_and(is_schema_node_218)
            && o.get("fingerprint").is_some_and(is_schema_node_218)
            && o.get("signature").is_some_and(is_schema_node_224)
    })
}

fn is_schema_node_227(v: &serde_json::Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.chars().count() >= 1 && s.chars().count() <= 200)
}

fn is_schema_node_226(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 1024 && a.iter().all(is_schema_node_227))
}

fn is_schema_node_228(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 1024 && a.iter().all(is_schema_node_218))
}

fn is_schema_node_225(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "version",
                "sequence",
                "issuedAtMs",
                "expiresAtMs",
                "pluginIds",
                "packageHashes",
                "publisherKeys",
            ]
            .contains(&k.as_str())
        }) && o.get("version").is_some_and(is_schema_node_17)
            && o.get("sequence").is_some_and(is_schema_node_101)
            && o.get("issuedAtMs").is_some_and(is_schema_node_50)
            && o.get("expiresAtMs").is_some_and(is_schema_node_101)
            && o.get("pluginIds").is_some_and(is_schema_node_226)
            && o.get("packageHashes").is_some_and(is_schema_node_228)
            && o.get("publisherKeys").is_some_and(is_schema_node_228)
    })
}

fn is_schema_node_230(v: &serde_json::Value) -> bool {
    v.is_string()
        && [
            "command.run",
            "music.search",
            "music.importUrl",
            "music.nextPage",
            "music.close",
            "music.cancel",
            "music.resolveMedia",
            "music.releaseMedia",
            "migrate",
        ]
        .contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_231(v: &serde_json::Value) -> bool {
    is_host_response(v)
}

fn is_schema_node_229(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "commandId",
                "operation",
                "inputJson",
                "contextRef",
                "sequence",
                "deadlineMs",
                "checkpointJson",
                "response",
            ]
            .contains(&k.as_str())
        }) && o.get("commandId").is_none_or(is_schema_node_6)
            && o.get("operation").is_some_and(is_schema_node_230)
            && o.get("inputJson").is_some_and(is_schema_node_133)
            && o.get("contextRef").is_some_and(is_schema_node_26)
            && o.get("sequence").is_some_and(is_schema_node_50)
            && o.get("deadlineMs").is_some_and(is_schema_node_50)
            && o.get("checkpointJson").is_none_or(is_schema_node_133)
            && o.get("response").is_none_or(is_schema_node_231)
    })
}

fn is_schema_node_234(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("complete")
}

fn is_schema_node_233(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["kind", "outputJson"].contains(&k.as_str()))
            && o.get("kind").is_some_and(is_schema_node_234)
            && o.get("outputJson").is_some_and(is_schema_node_133)
    })
}

fn is_schema_node_236(v: &serde_json::Value) -> bool {
    v.is_string() && v == &serde_json::json!("host")
}

fn is_schema_node_237(v: &serde_json::Value) -> bool {
    is_host_request(v)
}

fn is_schema_node_235(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["kind", "request", "checkpointJson"].contains(&k.as_str()))
            && o.get("kind").is_some_and(is_schema_node_236)
            && o.get("request").is_some_and(is_schema_node_237)
            && o.get("checkpointJson").is_some_and(is_schema_node_133)
    })
}

fn is_schema_node_232(v: &serde_json::Value) -> bool {
    [is_schema_node_233(v), is_schema_node_235(v)]
        .into_iter()
        .filter(|accepted| *accepted)
        .count()
        == 1
}

fn is_schema_node_238(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys()
            .all(|k| ["id", "label", "secret"].contains(&k.as_str()))
            && o.get("id").is_some_and(is_schema_node_27)
            && o.get("label").is_some_and(is_schema_node_8)
            && o.get("secret").is_some_and(is_schema_node_4)
    })
}

fn is_schema_node_240(v: &serde_json::Value) -> bool {
    v.as_i64()
        .is_some_and(|n| (-9007199254740991..=9007199254740991).contains(&n))
        && v == &serde_json::json!(1)
}

fn is_schema_node_242(v: &serde_json::Value) -> bool {
    v.is_string() && ["qr", "credentials", "phone"].contains(&v.as_str().unwrap_or_default())
}

fn is_schema_node_241(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 3 && a.iter().all(is_schema_node_242))
}

fn is_schema_node_244(v: &serde_json::Value) -> bool {
    is_source_credential_field(v)
}

fn is_schema_node_243(v: &serde_json::Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= 8 && a.iter().all(is_schema_node_244))
}

fn is_schema_node_239(v: &serde_json::Value) -> bool {
    v.as_object().is_some_and(|o| {
        o.keys().all(|k| {
            [
                "protocolVersion",
                "apiBaseUrl",
                "allowUnauthenticated",
                "methods",
                "credentialFields",
            ]
            .contains(&k.as_str())
        }) && o.get("protocolVersion").is_some_and(is_schema_node_240)
            && o.get("apiBaseUrl").is_some_and(is_schema_node_1)
            && o.get("allowUnauthenticated").is_some_and(is_schema_node_4)
            && o.get("methods").is_some_and(is_schema_node_241)
            && o.get("credentialFields").is_some_and(is_schema_node_243)
    })
}
