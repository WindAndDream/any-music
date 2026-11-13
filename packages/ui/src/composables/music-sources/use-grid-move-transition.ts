import {
  onActivated,
  onBeforeUpdate,
  onDeactivated,
  onScopeDispose,
  onUpdated,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { isFocusUnavailable } from '../focus-availability'
import { createGridMoveAnimations } from '../grid-move-animations'

interface UseGridMoveTransitionOptions {
  element: MaybeRefOrGetter<HTMLElement | null>
  itemKeys: MaybeRefOrGetter<readonly string[]>
  layoutKey: MaybeRefOrGetter<string>
  enabled: MaybeRefOrGetter<boolean>
}

function readPositions(element: HTMLElement, keys: readonly string[]) {
  const bounds = element.getBoundingClientRect()
  const widthScale = element.offsetWidth ? bounds.width / element.offsetWidth : 1
  const heightScale = element.offsetHeight ? bounds.height / element.offsetHeight : 1
  const scaleX = Number.isFinite(widthScale) && widthScale > 0 ? widthScale : 1
  const scaleY = Number.isFinite(heightScale) && heightScale > 0 ? heightScale : 1
  return new Map(
    Array.from(element.children, (child, index) => {
      const rect = child.getBoundingClientRect()
      return [
        keys[index]!,
        {
          left: (rect.left - bounds.left) / scaleX,
          top: (rect.top - bounds.top) / scaleY,
        },
      ] as const
    }),
  )
}

/** Batch FLIP reads around layout/order changes, then animate transforms without per-item reflow. */
export function useGridMoveTransition(options: UseGridMoveTransitionOptions): void {
  let previousKeys = [...toValue(options.itemKeys)]
  let previousLayout = toValue(options.layoutKey)
  let positions: ReturnType<typeof readPositions> | undefined
  const animations = createGridMoveAnimations()
  let active = true

  function cancel(): void {
    positions = undefined
    animations.cancel()
  }

  watch(
    () => toValue(options.element),
    (element, _previous, onCleanup) => {
      cancel()
      const view =
        element?.ownerDocument?.defaultView ?? (typeof window === 'undefined' ? undefined : window)
      const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)')
      const changed = () => {
        if (media?.matches) cancel()
      }
      media?.addEventListener?.('change', changed)
      onCleanup(() => media?.removeEventListener?.('change', changed))
      const document = element?.ownerDocument
      const hidden = () => {
        if (document?.visibilityState === 'hidden') cancel()
      }
      document?.addEventListener?.('visibilitychange', hidden)
      onCleanup(() => document?.removeEventListener?.('visibilitychange', hidden))
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () => toValue(options.enabled),
    (enabled) => {
      if (!enabled) cancel()
    },
    { flush: 'sync' },
  )

  onBeforeUpdate(() => {
    const keys = toValue(options.itemKeys)
    const layout = toValue(options.layoutKey)
    const layoutChanged = layout !== previousLayout
    const orderChanged =
      keys.length !== previousKeys.length || keys.some((key, index) => key !== previousKeys[index])
    const oldKeys = previousKeys
    previousKeys = [...keys]
    previousLayout = layout
    if (!orderChanged && !layoutChanged && toValue(options.enabled)) return
    const element = toValue(options.element)
    if (
      (!orderChanged && !layoutChanged) ||
      !active ||
      !toValue(options.enabled) ||
      !element?.animate ||
      element.isConnected === false ||
      element.ownerDocument?.visibilityState === 'hidden' ||
      isFocusUnavailable(element) ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ) {
      cancel()
      return
    }
    // Capture the current visual positions before canceling an interrupted animation, so rapid
    // display changes continue from the on-screen frame instead of snapping to its old target.
    const currentPositions = readPositions(element, oldKeys)
    animations.interrupt()
    for (const child of Array.from(element.children)) animations.retain(child as HTMLElement)
    positions = currentPositions
  })

  onUpdated(() => {
    const element = toValue(options.element)
    const oldPositions = positions
    positions = undefined
    if (!oldPositions) return
    if (!element || !active || !toValue(options.enabled)) {
      cancel()
      return
    }
    // Complete all layout reads before starting animations, including during large reorder operations.
    const newPositions = readPositions(element, previousKeys)
    const moves = Array.from(element.children).flatMap((child, index) => {
      const oldPosition = oldPositions.get(previousKeys[index]!)
      const position = newPositions.get(previousKeys[index]!)
      if (!oldPosition || !position) return []
      const x = oldPosition.left - position.left
      const y = oldPosition.top - position.top
      return x || y ? [{ child, x, y }] : []
    })
    animations.prune(new Set(moves.map(({ child }) => child as HTMLElement)))
    if (!moves.length) return
    const style = getComputedStyle(element)
    const token = style.getPropertyValue('--am-motion-normal').trim()
    const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    const easing = style.getPropertyValue('--am-ease-emphasized').trim() || 'ease'
    for (const { child, x, y } of moves) {
      animations.animate(
        child as HTMLElement,
        child as HTMLElement,
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
        { duration: Number.isFinite(duration) ? duration : 220, easing },
      )
    }
  })
  onActivated(() => {
    active = true
  })
  onDeactivated(() => {
    active = false
    cancel()
  })
  onScopeDispose(cancel)
}
