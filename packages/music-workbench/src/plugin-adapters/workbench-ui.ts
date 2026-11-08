import { createPluginViewReference, getProductDestination } from '@any-music/ui'
import type { PluginViewReference, ProductViewId } from '@any-music/ui'

import { WORKBENCH_VIEW_OWNERS } from './workbench-ui-directory'

/** Stable owner/local view keys; no storage writes or controller construction. */
export function getWorkbenchViewKey(id: ProductViewId): string {
  return `${WORKBENCH_VIEW_OWNERS[id]}/view-${id}`
}
export function resolveWorkbenchViews(
  allocated: readonly { id: string; implementationId: string; hasNavigation?: boolean }[],
) {
  return allocated.map((entry) => {
    if (entry.id.split('/').length !== 2) throw new Error('Invalid contribution key')
    const [ownerId, localId] = entry.id.split('/')
    const reference: ProductViewId | PluginViewReference =
      Object.hasOwn(WORKBENCH_VIEW_OWNERS, entry.implementationId) &&
      getWorkbenchViewKey(entry.implementationId as ProductViewId) === entry.id
        ? (entry.implementationId as ProductViewId)
        : createPluginViewReference(ownerId!, localId!)
    return { ...entry, reference }
  })
}
export function getAllocatedNavigation(
  order: readonly ProductViewId[],
  hidden: readonly ProductViewId[],
  views: ReturnType<typeof resolveWorkbenchViews>,
) {
  return order
    .filter(
      (id) =>
        !hidden.includes(id) &&
        views.some((view) => view.id === getWorkbenchViewKey(id) && view.hasNavigation !== false),
    )
    .map(getProductDestination)
}
