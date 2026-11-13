// Independent presentation owners can share one root; only the final owner restores it.
const leases = new WeakMap<HTMLElement, { count: number; value: string; priority: string }>()

export function retainNativeScrollAnchor(root: HTMLElement): () => void {
  const style = root.style
  if (!style) return () => {}
  const existing = leases.get(root)
  if (existing) existing.count++
  else {
    leases.set(root, {
      count: 1,
      value: style.getPropertyValue('overflow-anchor'),
      priority: style.getPropertyPriority('overflow-anchor'),
    })
    style.setProperty('overflow-anchor', 'none')
  }
  let held = true
  return () => {
    if (!held) return
    held = false
    const lease = leases.get(root)
    if (!lease || --lease.count) return
    leases.delete(root)
    if (
      style.getPropertyValue('overflow-anchor') !== 'none' ||
      style.getPropertyPriority('overflow-anchor')
    )
      return
    if (lease.value) style.setProperty('overflow-anchor', lease.value, lease.priority)
    else style.removeProperty('overflow-anchor')
  }
}
