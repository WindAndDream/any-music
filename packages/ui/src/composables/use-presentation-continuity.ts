import { getCurrentInstance, nextTick, onDeactivated, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { registerPresentationContinuity } from '../product/presentation-continuity'
import type {
  PresentationContinuityAdapter,
  PresentationContinuitySnapshot,
} from '../product/presentation-continuity'
import { isFocusUnavailable } from './focus-availability'

function items(element: HTMLElement) {
  return [...element.querySelectorAll<HTMLElement>('[data-am-continuity-item]')]
}
function itemKey(element: HTMLElement) {
  return element.dataset.amContinuityItem
}
function item(element: HTMLElement, key: string) {
  return items(element).find((entry) => itemKey(entry) === key)
}
function available(element: HTMLElement) {
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility
  return (
    element.isConnected &&
    element.getClientRects?.().length !== 0 &&
    !isFocusUnavailable(element) &&
    visibility !== 'hidden' &&
    visibility !== 'collapse'
  )
}

export interface PresentationContinuityGeometry {
  listOffset: number
  findItemAtOffset(offset: number): { key: string | number; start: number } | undefined
  indexOf(key: string): number | undefined
  getItem(index: number): { start: number } | undefined
}

export interface PresentationContinuityOptions {
  element: MaybeRefOrGetter<HTMLElement | null>
  /** Null disables this consumer without leaving a registered surface. */
  region: MaybeRefOrGetter<string | null>
  scrollElement: MaybeRefOrGetter<HTMLElement | null>
  /** Virtual renderers inject their complete geometry; native renderers use natural item boxes. */
  geometry?: () => PresentationContinuityGeometry | undefined
  refresh?: () => void
  beforeRestore?: () => void | (() => void)
  retain?: (key: string) => (() => void) | undefined
  /** Changing navigation/filter identity cancels an in-flight restoration. */
  revision?: MaybeRefOrGetter<unknown>
  /** An async renderer exposes its adapter through a synchronously registered parent. */
  delegate?: () => PresentationContinuityAdapter | undefined
  waitForDelegate?: () => boolean
  /** Nested adapters delegate to a parent bridge instead of registering duplicate regions. */
  register?: boolean
}

/** Theme-neutral semantic handoff. Only a replacement transaction calls capture/restore. */
export function usePresentationContinuity(options: PresentationContinuityOptions) {
  let generation = 0
  let disposed = false
  const delegates = new Set<AbortController>()
  const cancel = () => {
    generation++
    for (const delegate of delegates) delegate.abort()
    delegates.clear()
  }
  const adapter: PresentationContinuityAdapter = {
    capture() {
      const delegate = options.delegate?.()
      if (delegate) return delegate.capture()
      if (options.waitForDelegate?.()) return
      const element = toValue(options.element),
        root = toValue(options.scrollElement)
      if (!element || !root || !available(element) || !available(root)) return
      const geometry = options.geometry?.()
      const rootTop = root.getBoundingClientRect().top + root.clientTop
      const anchor = geometry
        ? (() => {
            const entry = geometry.findItemAtOffset(root.scrollTop - geometry.listOffset)
            return entry
              ? {
                  key: String(entry.key),
                  offset: root.scrollTop - geometry.listOffset - entry.start,
                }
              : undefined
          })()
        : (() => {
            const entries = items(element)
            const rootBottom = rootTop + root.clientHeight
            const entry = entries.find((candidate) => {
              const rect = candidate.getBoundingClientRect()
              return rect.bottom > rootTop && rect.top < rootBottom
            })
            const key = entry && itemKey(entry)
            return entry && key
              ? { key, offset: rootTop - entry.getBoundingClientRect().top }
              : undefined
          })()
      const active = (element.getRootNode() as Document | ShadowRoot).activeElement
      const control = active instanceof HTMLElement && element.contains(active) ? active : undefined
      const occurrence = control?.closest<HTMLElement>('[data-am-continuity-item]')
      const controlKey = control?.dataset.amFocusRestoreKey ?? control?.dataset.amFocusKey
      const key = occurrence && itemKey(occurrence)
      if (!anchor && !(controlKey && key)) return
      return { anchor, focus: controlKey && key ? { itemKey: key, controlKey } : undefined }
    },
    async restore(snapshot: PresentationContinuitySnapshot, signal: AbortSignal) {
      cancel()
      if (disposed || signal.aborted) return false
      if (options.waitForDelegate?.()) {
        const element = toValue(options.element),
          root = toValue(options.scrollElement)
        const revision = toValue(options.revision),
          region = toValue(options.region)
        if (!element || !root || !available(element) || !available(root)) return false
        const offset = root.scrollTop
        const left = root.scrollLeft
        const aborter = new AbortController()
        delegates.add(aborter)
        const abort = () => aborter.abort()
        signal.addEventListener('abort', abort, { once: true })
        const scrolled = () => {
          if (root.scrollTop !== offset || root.scrollLeft !== left) abort()
        }
        const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
        inputs.forEach((type) => root.addEventListener(type, abort, { passive: true }))
        root.addEventListener('scroll', scrolled, { passive: true })
        try {
          const delegate =
            options.delegate?.() ??
            (await new Promise<PresentationContinuityAdapter | undefined>((resolve) => {
              const finish = (renderer?: PresentationContinuityAdapter) => {
                stop()
                aborter.signal.removeEventListener('abort', stopped)
                resolve(renderer)
              }
              const stopped = () => finish()
              const stop = watch(
                () => options.delegate?.(),
                (renderer) => {
                  if (renderer) finish(renderer)
                },
                { flush: 'post' },
              )
              aborter.signal.addEventListener('abort', stopped, { once: true })
              if (aborter.signal.aborted) finish()
            }))
          if (
            aborter.signal.aborted ||
            !delegate ||
            toValue(options.element) !== element ||
            toValue(options.scrollElement) !== root ||
            toValue(options.revision) !== revision ||
            toValue(options.region) !== region ||
            root.scrollTop !== offset ||
            root.scrollLeft !== left ||
            !available(element) ||
            !available(root)
          )
            return false
          inputs.forEach((type) => root.removeEventListener(type, abort))
          root.removeEventListener('scroll', scrolled)
          return await delegate.restore(snapshot, aborter.signal)
        } finally {
          inputs.forEach((type) => root.removeEventListener(type, abort))
          root.removeEventListener('scroll', scrolled)
          signal.removeEventListener('abort', abort)
          delegates.delete(aborter)
        }
      }
      const element = toValue(options.element),
        root = toValue(options.scrollElement)
      if (!element || !root || !available(element) || !available(root)) return false
      const revision = toValue(options.revision),
        token = generation
      let expectedOffset = root.scrollTop
      const expectedLeft = root.scrollLeft
      const current = () =>
        !disposed &&
        !signal.aborted &&
        generation === token &&
        toValue(options.element) === element &&
        toValue(options.scrollElement) === root &&
        toValue(options.revision) === revision &&
        root.scrollTop === expectedOffset &&
        root.scrollLeft === expectedLeft &&
        available(element) &&
        available(root)
      const releases: (() => void)[] = []
      const keys = new Set(
        [snapshot.anchor?.key, snapshot.focus?.itemKey].filter((key): key is string =>
          Boolean(key),
        ),
      )
      for (const key of keys) {
        if (!options.retain) continue
        const release = options.retain(key)
        if (!release) {
          releases.forEach((dispose) => dispose())
          return false
        }
        releases.push(release)
      }
      const scroll = () => {
        if (root.scrollTop !== expectedOffset || root.scrollLeft !== expectedLeft) cancel()
      }
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
      inputs.forEach((type) => root.addEventListener(type, cancel, { passive: true }))
      root.addEventListener('scroll', scroll, { passive: true })
      try {
        const releaseRestore = options.beforeRestore?.()
        if (releaseRestore) releases.push(releaseRestore)
        function align() {
          const key = snapshot.anchor?.key ?? snapshot.focus?.itemKey
          const offset = snapshot.anchor?.offset ?? 0
          if (!key || !current()) return false
          const geometry = options.geometry?.()
          let target: number | undefined
          if (geometry) {
            const index = geometry.indexOf(key)
            const entry = index === undefined ? undefined : geometry.getItem(index)
            if (entry) target = geometry.listOffset + entry.start + offset
          } else {
            const entry = item(element!, key)
            if (entry)
              target =
                root!.scrollTop +
                entry.getBoundingClientRect().top -
                root!.getBoundingClientRect().top -
                root!.clientTop +
                offset
          }
          if (target === undefined || !Number.isFinite(target)) return false
          root!.scrollTop = Math.max(
            0,
            Math.min(target, Math.max(0, root!.scrollHeight - root!.clientHeight)),
          )
          expectedOffset = root!.scrollTop
          options.refresh?.()
          return true
        }
        let settled = false
        // A newly mounted window can differ substantially from estimates. Every alignment
        // may select another bounded window; wait for measured coordinates to converge before
        // focusing. Four render/measurement batches are a limit, never an unbounded retry.
        for (let attempt = 0; attempt < 4; attempt++) {
          if ((snapshot.anchor || snapshot.focus) && !align()) return false
          const alignedOffset = expectedOffset
          // eslint-disable-next-line no-await-in-loop -- Bounded mount/measurement convergence.
          await nextTick()
          // eslint-disable-next-line no-await-in-loop -- Post-render measurements follow mounting.
          await nextTick()
          if (!current()) return false
          if ((snapshot.anchor || snapshot.focus) && !align()) return false
          if (expectedOffset === alignedOffset) {
            settled = true
            break
          }
        }
        if (!settled) return false
        if (!snapshot.focus) return true
        const occurrence = item(element, snapshot.focus.itemKey)
        const target =
          (occurrence &&
            [occurrence, ...occurrence.querySelectorAll<HTMLElement>('[data-am-focus-key]')].find(
              (candidate) =>
                candidate.dataset.amFocusKey === snapshot.focus!.controlKey &&
                !candidate.hasAttribute('disabled') &&
                candidate.getAttribute('aria-disabled') !== 'true',
            )) ??
          (occurrence?.hasAttribute('tabindex') ? occurrence : undefined)
        if (!target || !available(target) || !current()) return false
        target.focus({ preventScroll: true })
        return (target.getRootNode() as Document | ShadowRoot).activeElement === target
      } finally {
        inputs.forEach((type) => root.removeEventListener(type, cancel))
        root.removeEventListener('scroll', scroll)
        releases.forEach((release) => release())
      }
    },
  }
  watch(
    [
      () => toValue(options.element),
      () => toValue(options.region),
      () => toValue(options.revision),
      () => toValue(options.scrollElement),
    ],
    ([element, region], _previous, onCleanup) => {
      cancel()
      if (!element || !region || options.register === false) return
      element.setAttribute('data-am-continuity-key', region)
      const unregister = registerPresentationContinuity(element, adapter)
      onCleanup(() => {
        cancel()
        unregister()
        if (element.dataset.amContinuityKey === region)
          element.removeAttribute('data-am-continuity-key')
      })
    },
    { immediate: true, flush: 'post' },
  )
  if (getCurrentInstance()) onDeactivated(cancel)
  onScopeDispose(() => {
    disposed = true
    cancel()
  })
  return { ...adapter, cancel }
}
