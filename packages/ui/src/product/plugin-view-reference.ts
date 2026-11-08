/** Plugin view identity never widens the core ProductViewId union to an arbitrary string. */
export interface PluginViewReference {
  readonly kind: 'plugin-view'
  readonly ownerId: string
  readonly localId: string
}
export function createPluginViewReference(ownerId: string, localId: string): PluginViewReference {
  if (
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(ownerId) ||
    ownerId.length > 128 ||
    !/^[a-z][a-z0-9-]*$/.test(localId) ||
    localId.length > 80
  )
    throw new Error('Invalid plugin view reference')
  return Object.freeze({ kind: 'plugin-view', ownerId, localId })
}
