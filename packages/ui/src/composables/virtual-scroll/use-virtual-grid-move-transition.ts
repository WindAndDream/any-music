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
import type { VirtualItemKey } from './virtual-row-geometry'

interface VirtualGridMoveTransitionOptions {
  element: MaybeRefOrGetter<HTMLElement | null>
  /** Stable across window/metadata updates; changes only with collection or spatial layout. */
  revision: MaybeRefOrGetter<unknown>
  enabled: MaybeRefOrGetter<boolean>
}

interface Registration {
  key: VirtualItemKey
  slot: HTMLElement
  surface: HTMLElement
}
interface Position {
  registration: Registration
  left: number
  top: number
}

/**
 * Keyed FLIP for the mounted intersection of two real layouts, never window ingress/egress.
 * Its surface is separate from both natural measurement and the pointer-reorder transform.
 */
export function useVirtualGridMoveTransition(options: VirtualGridMoveTransitionOptions) {
  const registrations = new Map<VirtualItemKey, Registration>()
  const animations = createGridMoveAnimations()
  let previousRevision = toValue(options.revision)
  let positions: { element: HTMLElement; items: Map<VirtualItemKey, Position> } | undefined
  let active = true
  let reducedMotion = false

  function cancel() {
    positions = undefined
    animations.cancel()
  }

  function registerItem(key: VirtualItemKey, slot: HTMLElement, surface: HTMLElement) {
    const previous = registrations.get(key)
    if (previous) animations.release(previous.slot)
    const registration = { key, slot, surface }
    registrations.set(key, registration)
    return () => {
      if (registrations.get(key) !== registration) return
      animations.release(registration.slot)
      registrations.delete(key)
    }
  }

  function blocked(element: HTMLElement | null) {
    return (
      !active ||
      !toValue(options.enabled) ||
      !element?.isConnected ||
      element.ownerDocument?.visibilityState === 'hidden' ||
      isFocusUnavailable(element) ||
      reducedMotion ||
      element.getAttribute('data-am-grid-dragging') !== null ||
      [...registrations.values()].some(
        ({ slot }) => slot.getAttribute('data-am-grid-landing') !== null,
      )
    )
  }

  function readPositions(element: HTMLElement, oldPositions?: Map<VirtualItemKey, Position>) {
    const bounds = element.getBoundingClientRect()
    const widthScale = element.offsetWidth ? bounds.width / element.offsetWidth : 1
    const heightScale = element.offsetHeight ? bounds.height / element.offsetHeight : 1
    const scaleX = Number.isFinite(widthScale) && widthScale > 0 ? widthScale : 1
    const scaleY = Number.isFinite(heightScale) && heightScale > 0 ? heightScale : 1
    const result = new Map<VirtualItemKey, Position>()
    for (const [key, registration] of registrations) {
      if (
        !registration.slot.isConnected ||
        !registration.surface.isConnected ||
        typeof registration.surface.animate !== 'function' ||
        (oldPositions && oldPositions.get(key)?.registration !== registration)
      )
        continue
      const rect = registration.surface.getBoundingClientRect()
      result.set(key, {
        registration,
        left: (rect.left - bounds.left) / scaleX,
        top: (rect.top - bounds.top) / scaleY,
      })
    }
    return result
  }

  watch(
    () => toValue(options.element),
    (element, _previous, onCleanup) => {
      cancel()
      const media = element?.ownerDocument.defaultView?.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      )
      reducedMotion = media?.matches ?? false
      const handleChange = () => {
        reducedMotion = media?.matches ?? false
        if (reducedMotion) cancel()
      }
      media?.addEventListener('change', handleChange)
      onCleanup(() => media?.removeEventListener('change', handleChange))
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
    const revision = toValue(options.revision)
    const changed = revision !== previousRevision
    previousRevision = revision
    const element = toValue(options.element)
    if (blocked(element)) {
      cancel()
      return
    }
    if (!changed || !element) return
    // Capture interrupted visual positions before cancellation; all reads precede any writes.
    const items = readPositions(element)
    animations.interrupt()
    for (const { registration } of items.values()) animations.retain(registration.slot)
    positions = { element, items }
  })

  onUpdated(() => {
    const element = toValue(options.element)
    const before = positions
    positions = undefined
    if (!before) return
    if (!element || before.element !== element || blocked(element)) {
      cancel()
      return
    }
    const after = readPositions(element, before.items)
    const moves = [...after.entries()].flatMap(([key, position]) => {
      const oldPosition = before.items.get(key)!
      const x = oldPosition.left - position.left
      const y = oldPosition.top - position.top
      return x || y ? [{ registration: position.registration, x, y }] : []
    })
    animations.prune(new Set(moves.map(({ registration }) => registration.slot)))
    if (!moves.length) return
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const token = style?.getPropertyValue('--am-motion-normal').trim() ?? ''
    const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    const easing = style?.getPropertyValue('--am-ease-emphasized').trim() || 'ease'
    for (const { registration, x, y } of moves) {
      animations.animate(
        registration.slot,
        registration.surface,
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
  onScopeDispose(() => {
    active = false
    cancel()
    registrations.clear()
  })
  return { registerItem }
}
