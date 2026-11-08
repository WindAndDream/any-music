/** Resolve the real control when a product or protected surface is mounted in nested Shadow roots. */
export function getDeepActiveElement(): HTMLElement | undefined {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return undefined
  let active: Element | null = document.activeElement
  while (active instanceof HTMLElement && active.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return active instanceof HTMLElement ? active : undefined
}

/** A replaced or responsive presentation needs a visible semantic opener when its trigger is gone. */
export function getModalReturnFocus(
  previous: HTMLElement | undefined,
  scope: Document | ShadowRoot | undefined,
  selector?: string,
): HTMLElement | undefined {
  const original = previous?.isConnected && isAvailableFocusTarget(previous) ? previous : undefined
  if (!selector || (original && scope?.contains(original))) return original
  return (
    [...(scope?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
      (element) => element.isConnected && isAvailableFocusTarget(element),
    ) ?? original
  )
}

function getComposedParent(element: Element): Element | null {
  return (
    element.assignedSlot ??
    element.parentElement ??
    (element.getRootNode() as ShadowRoot).host ??
    null
  )
}

function hasExcludedAncestor(element: HTMLElement): boolean {
  for (let ancestor: Element | null = element; ancestor; ancestor = getComposedParent(ancestor)) {
    if (ancestor.matches('[inert], [hidden], [aria-hidden="true"]')) return true
  }
  return false
}

function isAvailableFocusTarget(element: HTMLElement): boolean {
  if (
    element.matches(':disabled') ||
    hasExcludedAncestor(element) ||
    element.getClientRects().length === 0
  )
    return false
  const visibility = element.ownerDocument.defaultView?.getComputedStyle(element).visibility
  return visibility !== 'hidden' && visibility !== 'collapse'
}

/** Retained subviews and leaving transitions must never become modal Tab endpoints. */
export function getModalFocusableElements(panel: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = []
  const visit = (element: Element): void => {
    if (
      element instanceof HTMLElement &&
      element.matches(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]',
      )
    )
      candidates.push(element)
    // Protected forms live in nested host Shadow roots. Walk their composed order,
    // including assigned slot content, rather than counting only theme-owned DOM.
    const assigned =
      element.localName === 'slot'
        ? (element as HTMLSlotElement).assignedElements({ flatten: true })
        : undefined
    const children =
      element.shadowRoot?.children ?? (assigned?.length ? assigned : element.children)
    for (const child of children) visit(child)
  }
  for (const child of panel.children) visit(child)
  return candidates.filter((element) => element.tabIndex >= 0 && isAvailableFocusTarget(element))
}

/** Recover focus from outside the panel as well as wrapping its first/last visible control. */
export function containModalTab(event: KeyboardEvent, panel: HTMLElement | null): void {
  if (event.key !== 'Tab' || !panel) return
  const focusable = getModalFocusableElements(panel)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) {
    event.preventDefault()
    panel.focus({ preventScroll: true })
    return
  }
  const active = getDeepActiveElement()
  const outside = !active || !focusable.includes(active)
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus({ preventScroll: true })
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault()
    first.focus({ preventScroll: true })
  }
}
