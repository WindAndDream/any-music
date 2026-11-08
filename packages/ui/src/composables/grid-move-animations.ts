/** Shared by full and windowed FLIP: an interrupted animation keeps its render lease. */
const visibility = new WeakMap<HTMLElement, { count: number; original: string | null }>()

export function retainGridMotionVisibility(element: HTMLElement): () => void {
  let entry = visibility.get(element)
  if (!entry) {
    entry = { count: 0, original: element.getAttribute?.('data-am-grid-moving') ?? null }
    visibility.set(element, entry)
    element.setAttribute('data-am-grid-moving', '')
  }
  entry.count++
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--entry.count) return
    visibility.delete(element)
    if (entry.original === null) element.removeAttribute('data-am-grid-moving')
    else element.setAttribute('data-am-grid-moving', entry.original)
  }
}

/** No timers, dataset scans or permanent layers. Callers own geometry and lifecycle. */
export function createGridMoveAnimations() {
  const leases = new Map<HTMLElement, () => void>()
  const animations = new Map<HTMLElement, { animation: Animation; detach: () => void }>()
  function retain(slot: HTMLElement) {
    if (!leases.has(slot)) leases.set(slot, retainGridMotionVisibility(slot))
  }
  function cancelAnimation(slot: HTMLElement) {
    const current = animations.get(slot)
    if (!current) return
    animations.delete(slot)
    current.detach()
    current.animation.cancel()
  }
  function release(slot: HTMLElement) {
    cancelAnimation(slot)
    releaseVisibility(slot)
  }
  function releaseVisibility(slot: HTMLElement) {
    leases.get(slot)?.()
    leases.delete(slot)
  }
  function interrupt() {
    // Keep the same visibility/elevation through cancellation, the DOM patch and rebasing.
    for (const slot of animations.keys()) cancelAnimation(slot)
  }
  function cancel() {
    interrupt()
    for (const slot of leases.keys()) release(slot)
  }
  function animate(
    slot: HTMLElement,
    surface: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    retain(slot)
    cancelAnimation(slot)
    try {
      const animation = surface.animate(keyframes, options)
      const finish = () => {
        if (animations.get(slot)?.animation !== animation) return
        animations.delete(slot)
        detach()
        releaseVisibility(slot)
      }
      const detach = () => {
        animation.removeEventListener('finish', finish)
        animation.removeEventListener('cancel', finish)
      }
      animations.set(slot, { animation, detach })
      animation.addEventListener('finish', finish, { once: true })
      animation.addEventListener('cancel', finish, { once: true })
    } catch (error) {
      cancel()
      throw error
    }
  }
  return {
    retain,
    interrupt,
    animate,
    release,
    cancel,
    prune: (moving: ReadonlySet<HTMLElement>) => {
      for (const slot of leases.keys()) if (!moving.has(slot)) release(slot)
    },
  }
}
