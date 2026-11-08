/** Check modal/visibility exclusion across Shadow hosts as well as ordinary ancestors. */
export function isFocusUnavailable(element: Element): boolean {
  let current: Element | null = element
  while (current) {
    if (current.closest?.('[inert], [hidden], [aria-hidden="true"]')) return true
    current = (current.getRootNode?.() as ShadowRoot | undefined)?.host ?? null
  }
  return false
}
