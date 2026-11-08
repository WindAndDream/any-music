import type { Track } from '@any-music/core'
import { computed, hasInjectionContext, inject } from 'vue'
import type { InjectionKey } from 'vue'

export type UiContributionPoint =
  | 'track.actions.secondary'
  | 'track.details'
  | 'trackList.operator.actions'
  | 'trackList.filters'
export interface UiListContext {
  area: 'catalog' | 'queue' | 'favorites' | 'playlists' | 'history'
  selectionCount: number
  hasTrack: boolean
  selectedTracks?: readonly Track[]
}
export interface UiContributionItem {
  id: string
  implementationId: string
  revision: number
  viewRevision: number
  contextKey: string
  title?: string
  inputLabel?: string
  /** Host-projected choices, ordered by recency; selected means applied to the whole selection. */
  inputOptions?: readonly { value: string; selected: boolean }[]
}
export interface UiContributionHost {
  resolve(
    point: UiContributionPoint,
    context?: Partial<UiListContext>,
  ): readonly UiContributionItem[]
  /** Check again at the user event boundary; old controls cannot revive disabled contributions. */
  accepts(
    item: UiContributionItem,
    point: UiContributionPoint,
    context?: Partial<UiListContext>,
  ): boolean
  invoke?(
    item: UiContributionItem,
    point: UiContributionPoint,
    context?: Partial<UiListContext>,
    input?: string,
  ): void
}
export const UI_CONTRIBUTIONS: InjectionKey<UiContributionHost> = Symbol('ui-contributions')
export function useUiContributionAvailability(
  point: UiContributionPoint,
  context?: () => Partial<UiListContext>,
) {
  const host = hasInjectionContext() ? inject(UI_CONTRIBUTIONS, undefined) : undefined
  const items = computed(() => host?.resolve(point, context?.()) ?? [])
  function allows(implementationId: string): boolean {
    if (!host) return true // Controlled standalone UI retains its existing contract.
    const item = items.value.find((entry) => entry.implementationId === implementationId)
    return !!item && host.accepts(item, point, context?.())
  }
  return { items, allows }
}
