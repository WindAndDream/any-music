import type { SchemaTypes } from '../generated/schema-types.ts'
import * as validators from '../generated/validators.js'
import { assertJsonValue, parseBoundedJson, ProtocolValidationError } from './json-boundary.ts'
export { ProtocolValidationError, parseBoundedJson } from './json-boundary.ts'
export type { SchemaTypes } from '../generated/schema-types.ts'
export type SchemaName = keyof SchemaTypes

export function assertSchema<N extends SchemaName>(
  name: N,
  input: unknown,
): asserts input is SchemaTypes[N] {
  assertJsonValue(input)
  const validate = validators[`validate${name}`]
  if (typeof validate !== 'function' || !validate(input))
    throw new ProtocolValidationError(`Invalid ${name}`)
  if (name === 'PluginManifest') validateManifest(input as SchemaTypes['PluginManifest'])
  if (name === 'SourceAuthentication')
    validateSourceAuthentication(input as SchemaTypes['SourceAuthentication'])
  if (name === 'PluginTask') {
    const task = input as SchemaTypes['PluginTask']
    if (task.total !== undefined && task.completed > task.total)
      throw new ProtocolValidationError('Invalid task state')
  }
  if (name === 'WireMedia') {
    const media = input as SchemaTypes['WireMedia']
    if (
      !media.availableQualities.some((quality) => quality.id === media.quality.id) ||
      new Set(media.availableQualities.map((quality) => quality.id)).size !==
        media.availableQualities.length
    )
      throw new ProtocolValidationError('Invalid media quality identity')
  }
}

export function decodeProtocolJson<N extends SchemaName>(name: N, source: string): SchemaTypes[N] {
  const value = parseBoundedJson(source)
  assertSchema(name, value)
  return value
}

function reject(message: string): never {
  throw new ProtocolValidationError(message)
}

function validateManifest(manifest: SchemaTypes['PluginManifest']): void {
  if (manifest.sourceAuthentication) {
    validateSourceAuthentication(manifest.sourceAuthentication)
    if (
      manifest.execution !== 'declarative' ||
      !manifest.commands.some((c) => c.id === 'search') ||
      !manifest.contributions.some(
        (c) => c.pointId === 'music.sources' && c.providerId === manifest.id,
      ) ||
      !['source.authentication', 'network.publicHttps'].every((id) =>
        manifest.capabilities.some((c) => c.id === id && c.required && c.version === 1),
      )
    )
      reject(
        'Source authentication requires a declarative source and explicit required capabilities',
      )
  }
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(manifest.id))
    reject('Plugin ID must be namespaced')
  if (manifest.execution === 'sandbox-code' ? !manifest.entry : !!manifest.entry)
    reject('Execution entry mismatch')
  const unique = (values: readonly string[]) => {
    if (new Set(values).size !== values.length) reject('Duplicate declaration ID')
  }
  unique(manifest.commands.map((entry) => entry.id))
  unique(manifest.contributions.map((entry) => entry.contributionId))
  unique(manifest.capabilities.map((entry) => entry.id))
  const commands = new Set(manifest.commands.map((entry) => entry.id))
  const views = new Set(
    manifest.contributions
      .filter((entry) => entry.pointId === 'workspace.views')
      .map((entry) => entry.viewId),
  )
  for (const entry of manifest.contributions) {
    if (entry.commandId && !commands.has(entry.commandId)) reject('Undeclared command')
    if (entry.pointId === 'navigation.sidebar' && (!entry.viewId || !views.has(entry.viewId)))
      reject('Undeclared navigation view')
    if (entry.pointId === 'workspace.views' && !entry.viewId) reject('Missing view ID')
    if (entry.pointId === 'music.sources' && !entry.providerId) reject('Missing provider ID')
    if (
      ['track.actions.secondary', 'trackList.operator.actions'].includes(entry.pointId) &&
      !entry.commandId
    )
      reject('Missing action command')
  }
}

function validateSourceAuthentication(auth: SchemaTypes['SourceAuthentication']): void {
  if (
    !/^https:\/\/[a-z0-9.-]+(?::443)?\/(?:[a-zA-Z0-9_-]+\/)*$/.test(auth.apiBaseUrl) ||
    (!auth.allowUnauthenticated && !auth.methods.length) ||
    new Set(auth.methods).size !== auth.methods.length ||
    new Set(auth.credentialFields.map((field) => field.id)).size !== auth.credentialFields.length ||
    auth.methods.some((method) => method === 'credentials') !== auth.credentialFields.length > 0 ||
    auth.credentialFields.some(
      (field) =>
        !/^[a-z][a-zA-Z0-9_-]*$/.test(field.id) || ['constructor', 'prototype'].includes(field.id),
    )
  )
    reject('Invalid source authentication configuration')
}
