/** Metadata and ports only: schema validators remain behind the explicit /schema entry. */
export { PROTOCOL_REGISTRY } from './generated/registry.ts'
export { negotiatePluginContract } from './negotiate.ts'
export { PluginCallError } from './plugin-call-error.ts'
export type { NegotiatedContract } from './negotiate.ts'
export type { ExecutorPort, ExecutorSession, HostPort, PluginStateStore } from './ports.ts'
export type {
  PluginManifest,
  SourceAuthentication,
  SourceCredentialField,
  HostCapabilities,
  CapabilityRequirement,
  ContributionDescriptor,
  ContributionScope,
  CommandContext,
  HostRequest,
  HostResponse,
  HostEvent,
  PluginTask,
  WireError,
  UiDocument,
  UiNode,
  UiEvent,
} from './generated/protocol.ts'
