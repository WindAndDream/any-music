import { computed, nextTick, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { isFocusUnavailable } from '../focus-availability'
import type { useVirtualScrollContext } from './use-virtual-scroll-context'
import type { VirtualItemKey } from './virtual-row-geometry'

export type VirtualItemRetentionReason =
  | 'focus'
  | 'editor'
  | 'popover'
  | 'composition'
  | 'navigation'
  | 'reorder'
export type VirtualItemScrollAlignment = 'auto' | 'start' | 'center' | 'end'

/** Structural subset shared by list and row-major grid geometry snapshots. */
export interface VirtualItemRetentionGeometry {
  count: number
  totalSize: number
  indexOf: (key: VirtualItemKey) => number | undefined
  getItem: (index: number) => { key: VirtualItemKey; start: number; end: number } | undefined
}

export interface VirtualItemRetentionOptions {
  context: ReturnType<typeof useVirtualScrollContext>
  geometry: MaybeRefOrGetter<VirtualItemRetentionGeometry>
  /** Distinct occurrences, including pending navigation. Excess holds are rejected, never evicted. */
  limit?: number
  /** Cancel semantic scroll anchoring before deliberate keyed navigation. */
  beforeScroll?: () => void
  /** Suspend competing semantic compensation from the first reorder hold through the last. */
  suspendReorder?: () => () => void
  onRetentionRejected?: (key: VirtualItemKey, reason: VirtualItemRetentionReason) => void
}

export interface VirtualItemFocusOptions {
  align?: VirtualItemScrollAlignment
  /** A newer gesture may revoke this navigation before its target has mounted. */
  signal?: AbortSignal
  /** Locate a control within the registered item after it has mounted. */
  target?: (itemElement: HTMLElement) => HTMLElement | null
}

interface Registration {
  key: VirtualItemKey
  element: HTMLElement
  holdFocus: () => void
  release: () => void
}

function containsTarget(element: HTMLElement, target: EventTarget | null): target is HTMLElement {
  if (!target || !('nodeType' in target)) return false
  let node = target as Node
  while (true) {
    if (node === element || element.contains(node)) return true
    const host = (node.getRootNode() as ShadowRoot).host
    if (!host || host === node) return false
    node = host
  }
}

/**
 * Keeps only live interaction occurrences mounted. Editors/popovers retain their own sessions;
 * this presentation helper owns no draft, selection or business action. Register only mounted
 * item roots and release each registration on unmount/reuse.
 */
export function useVirtualItemRetention(options: VirtualItemRetentionOptions) {
  const limit = options.limit ?? 8
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
    throw new RangeError('Virtual item retention limit must be between 1 and 32')
  const geometry = computed(() => toValue(options.geometry))
  const keys = shallowRef<readonly VirtualItemKey[]>(Object.freeze([]))
  const holds = new Map<VirtualItemKey, Map<VirtualItemRetentionReason, number>>()
  const registrations = new Map<VirtualItemKey, Registration>()
  const registeredElements = new WeakMap<HTMLElement, Registration>()
  let active = true
  let generation = 0
  let resumeReorder: (() => void) | undefined
  let pending:
    | {
        key: VirtualItemKey
        root: HTMLElement
        offset: number
        release: () => void
      }
    | undefined

  function publish() {
    syncReorder()
    keys.value = Object.freeze([...holds.keys()])
  }

  function syncReorder() {
    if ([...holds.values()].some((reasons) => reasons.has('reorder'))) {
      resumeReorder ??= options.suspendReorder?.()
    } else {
      const resume = resumeReorder
      resumeReorder = undefined
      resume?.()
    }
  }

  function retain(key: VirtualItemKey, reason: VirtualItemRetentionReason) {
    if (!active || geometry.value.indexOf(key) === undefined) return undefined
    let reasons = holds.get(key)
    let added = false
    if (!reasons) {
      if (holds.size >= limit) {
        options.onRetentionRejected?.(key, reason)
        return undefined
      }
      reasons = new Map()
      holds.set(key, reasons)
      added = true
    }
    const entry = reasons
    entry.set(reason, (entry.get(reason) ?? 0) + 1)
    syncReorder()
    if (added) publish()
    let held = true
    return () => {
      if (!held) return
      held = false
      // A late release must never remove a new hold after an occurrence was removed/reinserted.
      if (holds.get(key) !== entry) return
      const count = entry.get(reason) ?? 0
      if (count > 1) entry.set(reason, count - 1)
      else entry.delete(reason)
      syncReorder()
      if (!entry.size) {
        holds.delete(key)
        publish()
      }
    }
  }

  const retainedIndexes = computed<readonly number[]>(() =>
    Object.freeze(
      keys.value
        .map((key) => geometry.value.indexOf(key))
        .filter((index): index is number => index !== undefined)
        .toSorted((left, right) => left - right),
    ),
  )

  function cancelNavigation() {
    generation++
    const previous = pending
    pending = undefined
    previous?.release()
  }

  function registerItem(key: VirtualItemKey, element: HTMLElement) {
    if (!active || geometry.value.indexOf(key) === undefined) return () => {}
    registrations.get(key)?.release()
    registeredElements.get(element)?.release()
    let registered = true
    let focusRelease: (() => void) | undefined
    let compositionRelease: (() => void) | undefined
    let focusInside = false

    function releaseFocus() {
      focusRelease?.()
      focusRelease = undefined
    }
    function handleFocusIn() {
      if (!registered) return
      focusInside = true
      focusRelease ??= retain(key, 'focus')
    }
    function handleFocusOut(event: Event) {
      if (!registered || containsTarget(element, (event as FocusEvent).relatedTarget)) return
      focusInside = false
      // Keep the composing occurrence alive even if an input method temporarily moves focus.
      if (!compositionRelease) releaseFocus()
    }
    function handleCompositionStart() {
      if (registered) compositionRelease ??= retain(key, 'composition')
    }
    function handleCompositionEnd() {
      compositionRelease?.()
      compositionRelease = undefined
      if (!focusInside) releaseFocus()
    }
    const listeners = [
      ['focusin', handleFocusIn],
      ['focusout', handleFocusOut],
      ['compositionstart', handleCompositionStart],
      ['compositionend', handleCompositionEnd],
    ] as const
    for (const [type, listener] of listeners) element.addEventListener(type, listener)
    const registration: Registration = {
      key,
      element,
      holdFocus: handleFocusIn,
      release() {
        if (!registered) return
        registered = false
        for (const [type, listener] of listeners) element.removeEventListener(type, listener)
        compositionRelease?.()
        releaseFocus()
        if (registrations.get(key) === registration) registrations.delete(key)
        if (registeredElements.get(element) === registration) registeredElements.delete(element)
      },
    }
    registrations.set(key, registration)
    registeredElements.set(element, registration)
    const focusRoot = element.getRootNode() as Document | ShadowRoot
    if (containsTarget(element, focusRoot.activeElement)) handleFocusIn()
    return registration.release
  }

  function navigate(
    key: VirtualItemKey,
    align: VirtualItemScrollAlignment,
    navigationOptions: { isCurrent?: () => boolean; prepare?: boolean } = {},
  ) {
    const root = options.context.scrollElement.value
    if (
      !active ||
      !root ||
      !options.context.metrics.value.ready ||
      geometry.value.indexOf(key) === undefined
    )
      return undefined
    if (navigationOptions.prepare !== false) options.beforeScroll?.()
    if (
      !active ||
      navigationOptions.isCurrent?.() === false ||
      root !== options.context.scrollElement.value ||
      !options.context.metrics.value.ready
    )
      return undefined
    const metrics = options.context.metrics.value
    const index = geometry.value.indexOf(key)
    const item = index === undefined ? undefined : geometry.value.getItem(index)
    if (!item || item.key !== key) return undefined
    const start = metrics.listOffset + item.start,
      end = metrics.listOffset + item.end,
      current = root.scrollTop,
      height = metrics.viewportHeight
    let offset = current
    if (align === 'start') offset = start
    else if (align === 'center') offset = (start + end - height) / 2
    else if (align === 'end') offset = end - height
    else if (start < current || end - start > height) offset = start
    else if (end > current + height) offset = end - height
    offset = Math.max(
      0,
      Math.min(offset, Math.max(0, metrics.listOffset + geometry.value.totalSize - height)),
    )
    root.scrollTop = offset
    if (pending?.root === root) pending.offset = root.scrollTop
    // Explicit navigation may precede the browser's scroll task. Publish the actual bounded
    // context now so nextTick can mount the destination; ordinary scrolling never calls this.
    options.context.refresh()
    return root
  }

  function scrollToKey(
    key: VirtualItemKey,
    scrollOptions: { align?: VirtualItemScrollAlignment } = {},
  ) {
    cancelNavigation()
    return Boolean(navigate(key, scrollOptions.align ?? 'auto'))
  }

  async function focusItem(key: VirtualItemKey, focusOptions: VirtualItemFocusOptions = {}) {
    cancelNavigation()
    if (focusOptions.signal?.aborted) return false
    const release = retain(key, 'navigation')
    const root = options.context.scrollElement.value
    if (!release || !root || !options.context.metrics.value.ready) {
      release?.()
      return false
    }
    const currentGeneration = generation
    const request = { key, root, offset: root.scrollTop, release }
    pending = request
    const handleAbort = () => {
      if (pending === request) cancelNavigation()
    }
    focusOptions.signal?.addEventListener('abort', handleAbort, { once: true })
    const isCurrent = () =>
      active &&
      !focusOptions.signal?.aborted &&
      pending === request &&
      generation === currentGeneration &&
      options.context.scrollElement.value === root &&
      options.context.metrics.value.ready &&
      !isFocusUnavailable(root) &&
      geometry.value.indexOf(key) !== undefined
    try {
      if (!navigate(key, focusOptions.align ?? 'auto', { isCurrent })) return false
      // One render flush plus one post-render registration/measurement flush. Missing controls
      // fail without timers or an unbounded retry loop; a later user action may retry normally.
      for (let attempt = 0; attempt < 2; attempt++) {
        // eslint-disable-next-line no-await-in-loop -- Mounting is an explicitly bounded two-flush operation.
        await nextTick()
        if (!isCurrent()) return false
        // A call made before a new reactive update can receive an already-resolved first
        // nextTick. Yield once more so same-turn hide/root changes reach the context first.
        if (attempt === 0) continue
        const registration = registrations.get(key)
        if (!registration) continue
        const target = focusOptions.target
          ? focusOptions.target(registration.element)
          : registration.element
        if (
          !target?.isConnected ||
          isFocusUnavailable(target) ||
          !containsTarget(registration.element, target) ||
          registrations.get(key) !== registration ||
          registeredElements.get(registration.element) !== registration
        )
          return false
        if (!isCurrent()) return false
        // Mounting can replace estimated rows with taller/shorter natural measurements. Align
        // once more against that current geometry before preventScroll focus, without restarting
        // the deliberate-navigation hook or scheduling an unbounded measurement retry.
        if (!navigate(key, focusOptions.align ?? 'auto', { isCurrent, prepare: false }))
          return false
        if (!isCurrent()) return false
        target.focus({ preventScroll: true })
        const focusRoot = target.getRootNode() as Document | ShadowRoot
        if (!isCurrent() || !containsTarget(target, focusRoot.activeElement)) return false
        registration.holdFocus()
        return true
      }
      return false
    } finally {
      focusOptions.signal?.removeEventListener('abort', handleAbort)
      if (pending === request) pending = undefined
      release()
    }
  }

  watch(
    geometry,
    (next) => {
      let changed = false
      for (const key of holds.keys()) {
        if (next.indexOf(key) !== undefined) continue
        holds.delete(key)
        changed = true
      }
      if (changed) publish()
      for (const registration of registrations.values())
        if (next.indexOf(registration.key) === undefined) registration.release()
      if (pending && next.indexOf(pending.key) === undefined) cancelNavigation()
    },
    { flush: 'sync' },
  )

  watch(
    [() => options.context.scrollElement.value, () => options.context.metrics.value.ready],
    ([root, ready], previous, onCleanup) => {
      cancelNavigation()
      if (previous && (root !== previous[0] || !ready))
        for (const registration of registrations.values()) registration.release()
      if (!root || !ready) return
      const handleInput = () => cancelNavigation()
      const handleScroll = () => {
        if (pending && root.scrollTop !== pending.offset) cancelNavigation()
      }
      const inputTypes = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
      for (const type of inputTypes) root.addEventListener(type, handleInput, { passive: true })
      root.addEventListener('scroll', handleScroll, { passive: true })
      onCleanup(() => {
        for (const type of inputTypes) root.removeEventListener(type, handleInput)
        root.removeEventListener('scroll', handleScroll)
      })
    },
    { immediate: true, flush: 'sync' },
  )

  onScopeDispose(() => {
    active = false
    cancelNavigation()
    for (const registration of registrations.values()) registration.release()
    holds.clear()
    publish()
  })

  return {
    retainedKeys: readonly(keys),
    retainedIndexes,
    retain,
    registerItem,
    scrollToKey,
    focusItem,
    cancelNavigation,
  }
}
