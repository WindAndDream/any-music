import { onActivated, onDeactivated, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

const OVERLAY_LAYERS = { panel: 0, drawer: 1, modal: 2 }

interface OverlayKeyboardOptions {
  active: MaybeRefOrGetter<boolean>
  layer: keyof typeof OVERLAY_LAYERS
  onEscape: () => void
  onTab?: (event: KeyboardEvent) => void
}

interface OverlayKeyboardStack {
  entries: Set<OverlayKeyboardEntry>
  handleKeydown: (event: KeyboardEvent) => void
}

interface OverlayKeyboardEntry extends OverlayKeyboardOptions {
  order: number
}

// Presentation and protected host overlays can live in separate Shadow roots.
// One window listener arbitrates them before any lower layer sees the same key.
const stacks = new WeakMap<Window, OverlayKeyboardStack>()
let nextActivationOrder = 0

function registerOverlay(target: Window, options: OverlayKeyboardEntry): () => void {
  let stack = stacks.get(target)
  if (!stack) {
    const entries = new Set<OverlayKeyboardEntry>()
    const handleKeydown = (event: KeyboardEvent): void => {
      if (event.isComposing || (event.key !== 'Escape' && event.key !== 'Tab')) return
      let selected: OverlayKeyboardEntry | undefined
      for (const entry of entries) {
        // Equal visual layers follow activation order, including pre-mounted dialogs.
        if (
          !selected ||
          OVERLAY_LAYERS[entry.layer] > OVERLAY_LAYERS[selected.layer] ||
          (entry.layer === selected.layer && entry.order > selected.order)
        ) {
          selected = entry
        }
      }
      if (!selected) return
      if (event.key === 'Tab') {
        selected.onTab?.(event)
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      // Holding Escape must not dismiss the remaining stack through key repeat.
      if (!event.repeat) selected.onEscape()
    }
    stack = { entries, handleKeydown }
    stacks.set(target, stack)
    target.addEventListener('keydown', handleKeydown, { capture: true })
  }
  const activeStack = stack
  activeStack.entries.add(options)
  return () => {
    activeStack.entries.delete(options)
    if (activeStack.entries.size) return
    target.removeEventListener('keydown', activeStack.handleKeydown, { capture: true })
    stacks.delete(target)
  }
}

/** Only the top active overlay owns Escape and modal Tab containment. */
export function useOverlayKeyboard(options: OverlayKeyboardOptions): void {
  const isActive = shallowRef(true)
  let order = 0
  onActivated(() => (isActive.value = true))
  onDeactivated(() => (isActive.value = false))
  watch(
    [isActive, () => toValue(options.active)],
    ([active, open], previous, onCleanup) => {
      // KeepAlive restores child hooks before parent hooks; retain their opening order.
      if (open && !previous?.[1]) order = ++nextActivationOrder
      if (active && open && typeof window !== 'undefined') {
        onCleanup(registerOverlay(window, { ...options, order }))
      }
    },
    { immediate: true, flush: 'sync' },
  )
}
