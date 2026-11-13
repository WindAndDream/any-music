import type { HostCapabilities, PluginManifest } from './generated/protocol.ts'
import { PROTOCOL_REGISTRY } from './generated/registry.ts'
import { PluginCallError } from './plugin-call-error.ts'

export interface NegotiatedContract {
  wireVersion: number
  runtimeProfileVersion: number
  contributionVersion: number
  packageFormatVersion: number
  dataSchemaVersion: number
  capabilities: readonly string[]
  skippedCapabilities: readonly string[]
  skippedContributions: readonly string[]
}

function refuse(message: string): never {
  throw new PluginCallError({ code: 'unsupported-version', message, isRetryable: false })
}

function version(value: string): number[] {
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some((part) => !/^(0|[1-9][0-9]{0,5})$/.test(part)))
    refuse('Unsupported SDK semver')
  return parts.map(Number)
}

function compare(left: string, right: string): number {
  const a = version(left),
    b = version(right)
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!
}

/** Compatibility is an intersection, never permission or proof of executor isolation. */
export function negotiatePluginContract(
  manifest: PluginManifest,
  host: HostCapabilities,
): NegotiatedContract {
  if (!host.manifestVersions.includes(manifest.manifestVersion))
    refuse('Unsupported Manifest version')
  if (
    compare(host.sdkVersion, manifest.sdk.minimum) < 0 ||
    compare(host.sdkVersion, manifest.sdk.maximumExclusive) >= 0
  )
    refuse('Unsupported SDK range')
  const dimensions = [
    [
      manifest.runtimeProfileVersion,
      host.runtimeProfileVersions,
      'Profile',
      PROTOCOL_REGISTRY.runtimeProfileVersion,
    ],
    [
      manifest.contributionVersion,
      host.contributionVersions,
      'contribution',
      PROTOCOL_REGISTRY.contributionVersion,
    ],
    [
      manifest.packageFormatVersion,
      host.packageFormatVersions,
      'package',
      PROTOCOL_REGISTRY.packageFormatVersion,
    ],
    [
      manifest.dataSchemaVersion,
      host.dataSchemaVersions,
      'data',
      PROTOCOL_REGISTRY.dataSchemaVersion,
    ],
  ] as const
  for (const [required, supported, label, known] of dimensions)
    if (required !== known || !supported.includes(required)) refuse(`Unsupported ${label} version`)
  const wireVersion = Math.max(
    ...manifest.wireVersions.filter(
      (value) => host.wireVersions.includes(value) && value === PROTOCOL_REGISTRY.wireVersion,
    ),
  )
  if (!Number.isFinite(wireVersion)) refuse('Unsupported wire version')
  if (
    !manifest.forms.includes(host.form) ||
    host.externalPlugins === 'none' ||
    (manifest.execution === 'sandbox-code' &&
      (host.externalPlugins !== 'sandbox-code' || !host.sandboxAvailable))
  )
    refuse('Execution policy unavailable')
  const capabilities: string[] = [],
    skippedCapabilities: string[] = [],
    skippedContributions: string[] = []
  for (const requirement of manifest.capabilities) {
    const available =
      (PROTOCOL_REGISTRY.capabilities as readonly string[]).includes(requirement.id) &&
      requirement.version === 1 &&
      host.capabilities.some(
        (entry) => entry.id === requirement.id && entry.versions.includes(requirement.version),
      )
    if (available) capabilities.push(requirement.id)
    else if (requirement.required)
      throw new PluginCallError({
        code: 'capability-unavailable',
        message: `Required capability unavailable: ${requirement.id}`,
        isRetryable: false,
      })
    else skippedCapabilities.push(requirement.id)
  }
  for (const contribution of manifest.contributions) {
    if (
      host.extensionPoints.some(
        (entry) =>
          entry.id === contribution.pointId &&
          entry.versions.includes(contribution.contractVersion),
      )
    )
      continue
    if (contribution.required) refuse(`Required contribution unavailable: ${contribution.pointId}`)
    skippedContributions.push(contribution.contributionId)
  }
  return {
    wireVersion,
    runtimeProfileVersion: manifest.runtimeProfileVersion,
    contributionVersion: manifest.contributionVersion,
    packageFormatVersion: manifest.packageFormatVersion,
    dataSchemaVersion: manifest.dataSchemaVersion,
    capabilities,
    skippedCapabilities,
    skippedContributions,
  }
}
