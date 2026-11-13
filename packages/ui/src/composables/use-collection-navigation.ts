import type { ShallowRef } from 'vue'
import { computed, onDeactivated, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { PresentationContinuitySnapshot } from '../product/presentation-continuity'
import { useBackHandler } from './use-back-navigation'
import { editingStateKey, useEditingSession, type EditingSession } from './use-editing-session'

interface CollectionOverviewState {
  scrollTop: number
  entryId?: string
  snapshot?: PresentationContinuitySnapshot
}
/**
 * 集合详情保持单层导航，保存概览位置并在转场后恢复键盘落点。
 * 视图根绑定 data-collection-view="viewKey"；详情标题使用 data-collection-focus，
 * 概览按钮使用 data-collection-entry="稳定 ID"。入场前/后分别调用两个转场钩子。
 */
export function useCollectionNavigation(options: {
  editing?: EditingSession
  enabled: MaybeRefOrGetter<boolean>
  entryIds: MaybeRefOrGetter<readonly string[]>
  scrollContainer: MaybeRefOrGetter<HTMLElement | null>
  /** Virtual overviews mount the originating entry before returning focus. */
  focusEntry?: (id: string, signal: AbortSignal) => Promise<boolean>
  captureOverview?: (entryId: string) => PresentationContinuitySnapshot | undefined
  restoreOverview?: (
    snapshot: PresentationContinuitySnapshot,
    signal: AbortSignal,
  ) => Promise<boolean>
}) {
  const editing = options.editing ?? useEditingSession()
  const activeId = editing.state(activeIdKey, () => shallowRef<string>())
  // Keep only neutral return metadata with the same owner as the active detail. A theme
  // replacement disposes presentation jobs, but must not forget the overview it came from.
  const overview = editing.state<CollectionOverviewState>(overviewKey, () => ({ scrollTop: 0 }))
  const direction = shallowRef<'forward' | 'back'>('forward')
  const viewKey = computed(() =>
    activeId.value === undefined ? 'overview' : `detail:${activeId.value}`,
  )
  let pending: 'detail' | 'overview' | undefined
  let focusController: AbortController | undefined
  let releaseFocusInputs: (() => void) | undefined
  function cancelFocus() {
    focusController?.abort()
    focusController = undefined
    releaseFocusInputs?.()
    releaseFocusInputs = undefined
  }

  function open(id: string): void {
    if (!toValue(options.enabled) || !toValue(options.entryIds).includes(id)) return
    if (activeId.value === id) return
    cancelFocus()
    if (activeId.value === undefined) {
      overview.scrollTop = toValue(options.scrollContainer)?.scrollTop ?? 0
      overview.snapshot = options.captureOverview?.(id)
    }
    activeId.value = id
    overview.entryId = id
    direction.value = 'forward'
    pending = 'detail'
  }

  function back(): void {
    if (activeId.value === undefined) return
    cancelFocus()
    activeId.value = undefined
    direction.value = 'back'
    pending = 'overview'
  }

  function prepareTransition(view: Element): void {
    if (!pending || view.getAttribute('data-collection-view') !== viewKey.value) return
    cancelFocus()
    const container = toValue(options.scrollContainer)
    if (container) container.scrollTop = pending === 'overview' ? overview.scrollTop : 0
  }

  function finishTransition(view: Element, behavior: { restoreFocus?: boolean } = {}): void {
    if (!pending || view.getAttribute('data-collection-view') !== viewKey.value) return
    // 入场前定位使滑动可见；旧视图占位释放后再次定位，避免不同内容高度截断返回位置。
    prepareTransition(view)
    const entries = [...view.querySelectorAll<HTMLElement>('[data-collection-entry]')]
    const focusTarget =
      pending === 'detail'
        ? view.querySelector<HTMLElement>('[data-collection-focus]')
        : (entries.find((entry) => entry.dataset.collectionEntry === overview.entryId) ??
          entries[0] ??
          view.querySelector<HTMLElement>('[data-collection-focus]'))
    const restoreEntry = options.focusEntry
    const restoreOverview = options.restoreOverview
    const returning =
      pending === 'overview' &&
      overview.entryId &&
      toValue(options.entryIds).includes(overview.entryId)
    const semantic = returning && overview.snapshot && restoreOverview
    if (semantic || (returning && behavior.restoreFocus !== false && restoreEntry)) {
      const controller = new AbortController()
      focusController = controller
      const root = toValue(options.scrollContainer)
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
      inputs.forEach((type) => root?.addEventListener?.(type, cancelFocus, { passive: true }))
      releaseFocusInputs = () =>
        inputs.forEach((type) => root?.removeEventListener?.(type, cancelFocus))
      // Once a virtual operation owns restoration, cancellation/failure never falls back
      // to an unrelated mounted entry. A new navigation/disposal aborts its remaining work.
      const operation = semantic
        ? restoreOverview!(
            behavior.restoreFocus === false
              ? { anchor: overview.snapshot!.anchor }
              : overview.snapshot!,
            controller.signal,
          )
        : restoreEntry!(overview.entryId!, controller.signal)
      const finish = () => {
        if (focusController !== controller) return
        focusController = undefined
        releaseFocusInputs?.()
        releaseFocusInputs = undefined
      }
      void operation.then(finish, finish)
    } else if (behavior.restoreFocus !== false) focusTarget?.focus({ preventScroll: true })
    pending = undefined
  }

  watch([() => toValue(options.enabled), () => toValue(options.entryIds)], ([enabled, ids]) => {
    cancelFocus()
    if (!enabled) {
      activeId.value = undefined
      direction.value = 'forward'
      pending = undefined
      overview.scrollTop = 0
      overview.snapshot = undefined
      overview.entryId = undefined
    } else if (activeId.value !== undefined && !ids.includes(activeId.value)) back()
  })
  watch(() => toValue(options.scrollContainer), cancelFocus, { flush: 'sync' })
  const cancel = () => {
    cancelFocus()
    pending = undefined
  }
  onDeactivated(cancel)
  onScopeDispose(cancel)
  useBackHandler({
    active: () => toValue(options.enabled) && activeId.value !== undefined,
    handle: back,
  })
  return {
    activeId: readonly(activeId),
    direction: readonly(direction),
    viewKey,
    open,
    back,
    prepareTransition,
    finishTransition,
  }
}

const activeIdKey = editingStateKey<ShallowRef<string | undefined>>(
  'composables/use-collection-navigation.ts:activeId',
)

const overviewKey = editingStateKey<CollectionOverviewState>(
  'composables/use-collection-navigation.ts:overview',
)
