import { getPresentationContinuity } from '@any-music/ui/theme'
import type { PresentationContinuitySnapshot } from '@any-music/ui/theme'
import { nextTick } from 'vue'

import type { ThemeResources } from './theme-contracts'

/** Resources live inside the product root, including when that root belongs to a Shadow tree. */
export function createThemeResources(
  getRoot: () => HTMLElement | ShadowRoot | undefined,
): ThemeResources {
  return {
    prepare(id, css) {
      const root = getRoot()
      if (!root) throw new Error('Product root is unavailable')
      const style = root.ownerDocument.createElement('style')
      style.dataset.amThemeResource = id
      style.textContent = css
      style.media = 'not all'
      root.append(style)
      return {
        activate: () => {
          style.media = 'all'
        },
        deactivate: () => {
          style.media = 'not all'
        },
        dispose: () => style.remove(),
      }
    },
    capture(signal = new AbortController().signal) {
      const root = getRoot()
      if (!root) return () => {}
      const cancellation = new AbortController()
      const sourceSignal = signal
      const abort = () => cancellation.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      signal = cancellation.signal
      const tree = root.getRootNode() as Document | ShadowRoot
      const active = tree.activeElement
      const ownedFocus = active instanceof HTMLElement && root.contains(active)
      const key = ownedFocus ? active.dataset.amFocusKey : undefined
      const semantic = new Map<string, PresentationContinuitySnapshot>()
      for (const element of root.querySelectorAll<HTMLElement>('[data-am-continuity-key]')) {
        const snapshot = getPresentationContinuity(element)?.capture()
        if (snapshot) semantic.set(element.dataset.amContinuityKey!, snapshot)
      }
      // Responsive layouts may move one semantic region's scrolling between nested elements.
      // Collect both axes by key; restoration clamps each destination to its own scroll range.
      const scroll = new Map<string, { top: number; left: number }>()
      for (const element of root.querySelectorAll<HTMLElement>('[data-am-scroll-key]')) {
        const scrollKey = element.dataset.amScrollKey!
        const saved = scroll.get(scrollKey)
        scroll.set(scrollKey, {
          top: Math.max(saved?.top ?? 0, element.scrollTop),
          left: Math.max(saved?.left ?? 0, element.scrollLeft),
        })
      }
      let restoring = false
      const manualScroll = (event: Event) => {
        if (restoring) return
        const element = event.target as HTMLElement
        const saved = scroll.get(element.dataset?.amScrollKey ?? '')
        if (saved && (element.scrollTop !== saved.top || element.scrollLeft !== saved.left)) abort()
      }
      const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
      for (const type of inputs)
        root.addEventListener?.(type, abort, { passive: true, capture: true })
      root.addEventListener?.('scroll', manualScroll, true)
      const cleanup = () => {
        sourceSignal.removeEventListener('abort', abort)
        for (const type of inputs) root.removeEventListener?.(type, abort, true)
        root.removeEventListener?.('scroll', manualScroll, true)
      }
      signal.addEventListener('abort', cleanup, { once: true })
      const canRestoreFocus = (element: HTMLElement) => {
        if (
          !element.isConnected ||
          !root.contains(element) ||
          element.closest('[inert], [aria-hidden="true"], [hidden]') ||
          element.getClientRects().length === 0
        )
          return false
        const visibility = element.ownerDocument?.defaultView?.getComputedStyle(element).visibility
        return visibility !== 'hidden' && visibility !== 'collapse'
      }
      const restoreFocus = () => {
        if (signal.aborted || getRoot() !== root) return
        if (active instanceof HTMLElement && canRestoreFocus(active))
          active.focus({ preventScroll: true })
        else if (ownedFocus) {
          const target = [...root.querySelectorAll<HTMLElement>('[data-am-focus-key]')].find(
            (element) => element.dataset.amFocusKey === key && canRestoreFocus(element),
          )
          const current = tree.activeElement
          // A newly mounted modal owns its initial focus. Keep that visible focus
          // when an outgoing control has no semantic counterpart in the new theme.
          const modalOwnsFocus =
            current instanceof HTMLElement &&
            canRestoreFocus(current) &&
            current.closest('[role="dialog"], [role="alertdialog"]')
          if (target) target.focus({ preventScroll: true })
          else if (!modalOwnsFocus)
            [...root.querySelectorAll<HTMLElement>('[data-am-focus-fallback]')]
              .find(canRestoreFocus)
              ?.focus({ preventScroll: true })
        }
      }
      return () => {
        if (signal.aborted || getRoot() !== root) {
          cleanup()
          return
        }
        restoring = true
        // Restore ordinary regions first. Semantic adapters then replace pixel equivalence
        // with occurrence/offset equivalence and mount an offscreen focus target.
        for (const element of root.querySelectorAll<HTMLElement>('[data-am-scroll-key]')) {
          const saved = scroll.get(element.dataset.amScrollKey!)
          if (!saved) continue
          element.scrollTop = Math.max(
            0,
            Math.min(saved.top, element.scrollHeight - element.clientHeight),
          )
          element.scrollLeft = Math.max(
            0,
            Math.min(saved.left, element.scrollWidth - element.clientWidth),
          )
        }
        const restores: Promise<boolean>[] = []
        const restoredSnapshots: PresentationContinuitySnapshot[] = []
        for (const element of root.querySelectorAll<HTMLElement>('[data-am-continuity-key]')) {
          const saved = semantic.get(element.dataset.amContinuityKey!)
          const adapter = getPresentationContinuity(element)
          if (saved && adapter) {
            restoredSnapshots.push(saved)
            restores.push(adapter.restore(saved, signal))
          }
        }
        if (!restores.length) {
          restoreFocus()
          cleanup()
          return
        }
        return Promise.allSettled(restores)
          .then((results) => {
            // Adapters own semantic focus. Ordinary controls still use the existing host keys.
            if (
              !signal.aborted &&
              getRoot() === root &&
              !results.some(
                (result, index) =>
                  result.status === 'fulfilled' && result.value && restoredSnapshots[index]?.focus,
              )
            )
              restoreFocus()
          })
          .finally(cleanup)
      }
    },
    afterRender(restore) {
      void nextTick(restore)
    },
  }
}
