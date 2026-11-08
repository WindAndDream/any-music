type ResizeCallback = (entries: readonly ResizeObserverEntry[]) => void
interface ResizePool {
  observer: ResizeObserver
  targets: Map<Element, Map<ResizeCallback, number>>
}
const pools = new WeakMap<Document, ResizePool>()

/** One observer per active document, shared by containers and later mounted measurement targets. */
export function observeVirtualElement(
  element: Element,
  callback: ResizeCallback,
): (() => void) | undefined {
  const document = element.ownerDocument
  const Observer = document.defaultView?.ResizeObserver ?? globalThis.ResizeObserver
  if (!Observer) return undefined
  let pool = pools.get(document)
  if (!pool) {
    const targets: ResizePool['targets'] = new Map()
    const observer = new Observer((entries) => {
      const notifications = new Map<ResizeCallback, ResizeObserverEntry[]>()
      for (const entry of entries) {
        for (const listener of targets.get(entry.target)?.keys() ?? []) {
          const batch = notifications.get(listener) ?? []
          batch.push(entry)
          notifications.set(listener, batch)
        }
      }
      // A context observing both its viewport and list measures once per native batch.
      for (const [listener, batch] of notifications) {
        const current = batch.filter((entry) => targets.get(entry.target)?.has(listener))
        if (current.length) listener(current)
      }
    })
    pool = { observer, targets }
    pools.set(document, pool)
  }
  let listeners = pool.targets.get(element)
  if (!listeners) {
    listeners = new Map()
    pool.targets.set(element, listeners)
    pool.observer.observe(element, { box: 'border-box' })
  }
  listeners.set(callback, (listeners.get(callback) ?? 0) + 1)
  let active = true
  return () => {
    if (!active) return
    active = false
    const count = listeners.get(callback) ?? 0
    if (count > 1) listeners.set(callback, count - 1)
    else listeners.delete(callback)
    if (!listeners.size) {
      pool.targets.delete(element)
      pool.observer.unobserve(element)
    }
    if (!pool.targets.size) {
      pool.observer.disconnect()
      pools.delete(document)
    }
  }
}
