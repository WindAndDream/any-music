import type { PluginManifest, UiDocument, UiEvent } from '@any-music/plugin-sdk'
import { assertSchema } from '@any-music/plugin-sdk/schema'
import { readonly, shallowRef } from 'vue'

/** One host-owned view binding. Data never selects Vue components, HTML, CSS or capability code. */
export function createDeclarativeSession(options: {
  manifest: PluginManifest
  installationId: string
  viewId: string
  /** Host binding for a scoped action/details/filter surface instead of a workspace page. */
  contributionId?: string
  contextRef: string
  isCurrent(): boolean
  onDispose?(): void
}) {
  assertSchema('PluginManifest', options.manifest)
  const manifest = structuredClone(options.manifest)
  const contribution = manifest.contributions.find((entry) =>
    options.contributionId
      ? entry.contributionId === options.contributionId
      : entry.pointId === 'workspace.views' && entry.viewId === options.viewId,
  )
  if (
    !contribution ||
    ![
      'workspace.views',
      'track.actions.secondary',
      'track.details',
      'trackList.operator.actions',
      'trackList.filters',
      'settings.sections',
    ].includes(contribution.pointId) ||
    (contribution.pointId === 'workspace.views' && contribution.viewId !== options.viewId)
  )
    throw new Error('Undeclared view')
  const document = shallowRef<UiDocument>()
  const commands = new Set(manifest.commands.map((entry) => entry.id))
  const lifetime = new AbortController()
  function isCurrent() {
    return !lifetime.signal.aborted && options.isCurrent()
  }
  function update(input: unknown): void {
    if (!isCurrent()) throw new Error('Inactive view')
    assertSchema('UiDocument', input)
    if (
      input.viewId !== options.viewId ||
      (document.value && input.viewRevision <= document.value.viewRevision)
    )
      throw new Error('Stale or foreign view')
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 256 * 1024)
      throw new Error('UI byte budget exceeded')
    const ids = new Set<string>()
    for (const node of input.nodes) {
      if (ids.has(node.id)) throw new Error('Duplicate UI node')
      ids.add(node.id)
      if ((node.type === 'button' || node.type === 'form') && !commands.has(node.commandId))
        throw new Error('Foreign command')
      if (
        node.type === 'form' &&
        new Set(node.fields.map((field) => field.id)).size !== node.fields.length
      )
        throw new Error('Duplicate form field')
    }
    // Clone and freeze so a caller cannot change a rendered command behind the event check.
    const copy = structuredClone(input)
    for (const node of copy.nodes) {
      if (node.type === 'form') {
        node.fields.forEach(Object.freeze)
        Object.freeze(node.fields)
      }
      Object.freeze(node)
    }
    Object.freeze(copy.nodes)
    document.value = Object.freeze(copy)
  }
  function createEvent(
    revision: number,
    nodeId: string,
    values?: readonly { fieldId: string; value: string }[],
  ): UiEvent {
    const current = document.value
    const node = current?.nodes.find((item) => item.id === nodeId)
    if (
      !isCurrent() ||
      !current ||
      revision !== current.viewRevision ||
      !node ||
      (node.type !== 'button' && node.type !== 'form')
    )
      throw new Error('Stale UI event')
    if (node.type === 'button' && values !== undefined) throw new Error('Unexpected form values')
    if (node.type === 'form') {
      if (
        !values ||
        values.length !== node.fields.length ||
        new Set(values.map((value) => value.fieldId)).size !== values.length
      )
        throw new Error('Invalid form values')
      for (const field of node.fields) {
        const value = values.find((entry) => entry.fieldId === field.id)?.value
        if (
          value === undefined ||
          value.length > (field.maxLength ?? 256) ||
          (field.type === 'checkbox' && value !== 'true' && value !== 'false') ||
          (field.type === 'number' && (!value.trim() || !Number.isFinite(Number(value))))
        )
          throw new Error('Invalid form field')
      }
    }
    const event = {
      schemaVersion: 1 as const,
      viewId: current.viewId,
      viewRevision: current.viewRevision,
      nodeId,
      commandId: node.commandId,
      contextRef: options.contextRef,
      ...(values ? { values: structuredClone(values) } : {}),
    }
    assertSchema('UiEvent', event)
    return event
  }
  return {
    identity: Object.freeze({
      ownerId: manifest.id,
      name: manifest.name['zh-CN'],
      installationId: options.installationId,
    }),
    document: readonly(document),
    signal: lifetime.signal,
    update,
    createEvent,
    dispose() {
      if (!lifetime.signal.aborted) {
        lifetime.abort()
        options.onDispose?.()
      }
    },
  }
}
export type DeclarativeSession = ReturnType<typeof createDeclarativeSession>
