import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  containModalTab,
  getDeepActiveElement,
  getModalFocusableElements,
  getModalReturnFocus,
} from '../../src/components/modal-focus'

/** These fixtures exercise DOM decisions; actual browser layout/focus remains a live acceptance check. */
class FocusElement {
  readonly localName: string
  constructor(localName = 'button') {
    this.localName = localName
  }
  tabIndex = 0
  disabled = false
  excludedAncestor = false
  hasLayout = true
  visibility = 'visible'
  isConnected = true
  parentElement: FocusElement | null = null
  assignedSlot: FocusElement | null = null
  children: FocusElement[] = []
  assignedContent: FocusElement[] = []
  shadowRoot: {
    activeElement: FocusElement | null
    host: FocusElement
    children: FocusElement[]
  } | null = null
  shadowParent: FocusElement['shadowRoot'] = null
  set candidates(children: FocusElement[]) {
    this.children = children
    for (const child of children) child.parentElement = this
  }
  attachShadow(children: FocusElement[], activeElement: FocusElement | null = null): void {
    this.shadowRoot = { children, activeElement, host: this }
    for (const child of children) child.shadowParent = this.shadowRoot
  }
  getRootNode(): unknown {
    return this.parentElement?.getRootNode() ?? this.shadowParent ?? documentFixture
  }
  assignedElements = () => this.assignedContent
  focus = vi.fn()
  ownerDocument = {
    defaultView: {
      getComputedStyle: (element: FocusElement) => ({ visibility: element.visibility }),
    },
  }
  matches = (selector: string) => {
    if (selector === ':disabled') return this.disabled
    if (selector.startsWith('[inert]')) return this.excludedAncestor
    return !['div', 'slot'].includes(this.localName)
  }
  getClientRects = () => (this.hasLayout ? [{}] : [])
}

const documentFixture = { activeElement: null as FocusElement | null }

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FocusElement)
  vi.stubGlobal('document', documentFixture)
  documentFixture.activeElement = null
})
afterEach(() => vi.unstubAllGlobals())

function keyEvent(shiftKey = false): KeyboardEvent {
  return { key: 'Tab', shiftKey, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('modal focus boundaries', () => {
  it('returns to the semantic replacement opener only when the original trigger left its scope', () => {
    const original = new FocusElement()
    const replacement = new FocusElement()
    const externalHost = new FocusElement('div')
    const replacements = [replacement]
    const scope = {
      contains: (element: unknown) => element === original || element === replacement,
      querySelectorAll: () => replacements,
    } as unknown as ShadowRoot
    expect(getModalReturnFocus(original as unknown as HTMLElement, scope, 'settings')).toBe(
      original,
    )
    original.isConnected = false
    expect(getModalReturnFocus(original as unknown as HTMLElement, scope, 'settings')).toBe(
      replacement,
    )
    expect(getModalReturnFocus(externalHost as unknown as HTMLElement, scope, 'settings')).toBe(
      replacement,
    )
    expect(getModalReturnFocus(externalHost as unknown as HTMLElement, scope)).toBe(externalHost)
    replacements.length = 0
    expect(getModalReturnFocus(externalHost as unknown as HTMLElement, scope, 'settings')).toBe(
      externalHost,
    )
  })

  it.each([
    { hasLayout: false },
    { visibility: 'hidden' },
    { visibility: 'collapse' },
    { excludedAncestor: true },
    { disabled: true },
  ])(
    'returns to visible mobile navigation when the connected settings opener is unavailable (%j)',
    (hidden) => {
      const original = Object.assign(new FocusElement(), hidden)
      const navigation = new FocusElement()
      const scope = {
        contains: () => true,
        querySelectorAll: () => [original, navigation],
      } as unknown as ShadowRoot
      expect(
        getModalReturnFocus(
          original as unknown as HTMLElement,
          scope,
          '[data-am-focus-key="settings:open"], [data-am-focus-key="navigation:open"]',
        ),
      ).toBe(navigation)
    },
  )

  it('skips an unavailable first semantic replacement while preserving a visible original', () => {
    const original = new FocusElement()
    const sidebar = Object.assign(new FocusElement(), { excludedAncestor: true })
    const navigation = new FocusElement()
    const scope = {
      contains: (element: unknown) => element === original,
      querySelectorAll: () => [sidebar, navigation],
    } as unknown as ShadowRoot
    expect(getModalReturnFocus(original as unknown as HTMLElement, scope, 'openers')).toBe(original)
    original.isConnected = false
    expect(getModalReturnFocus(original as unknown as HTMLElement, scope, 'openers')).toBe(
      navigation,
    )
    navigation.hasLayout = false
    expect(
      getModalReturnFocus(original as unknown as HTMLElement, scope, 'openers'),
    ).toBeUndefined()
  })

  it('rejects return focus hidden by an ancestor across a protected Shadow boundary', () => {
    const host = Object.assign(new FocusElement('div'), { excludedAncestor: true })
    const original = new FocusElement()
    host.attachShadow([original])
    expect(getModalReturnFocus(original as unknown as HTMLElement, undefined)).toBeUndefined()
  })

  it('resolves the leaf control through multiple product/protected Shadow roots', () => {
    const outer = new FocusElement()
    const inner = new FocusElement()
    const control = new FocusElement()
    outer.attachShadow([inner], inner)
    inner.attachShadow([control], control)
    documentFixture.activeElement = outer
    expect(getDeepActiveElement()).toBe(control)
  })

  it('excludes hidden/transition subviews, invisible controls, disabled fieldsets and negative tabindex', () => {
    const panel = new FocusElement()
    const visible = new FocusElement()
    const hidden = Object.assign(new FocusElement(), { excludedAncestor: true })
    const displayNone = Object.assign(new FocusElement(), { hasLayout: false })
    const visibilityHidden = Object.assign(new FocusElement(), { visibility: 'hidden' })
    const collapsed = Object.assign(new FocusElement(), { visibility: 'collapse' })
    const disabledFieldset = Object.assign(new FocusElement(), { disabled: true })
    const negativeTabindex = Object.assign(new FocusElement(), { tabIndex: -2 })
    panel.candidates = [
      visible,
      hidden,
      displayNone,
      visibilityHidden,
      collapsed,
      disabledFieldset,
      negativeTabindex,
    ]
    expect(getModalFocusableElements(panel as unknown as HTMLElement)).toEqual([visible])
  })

  it.each([false, true])(
    'returns outside focus to the correct visible endpoint (reverse=%s)',
    (reverse) => {
      const panel = new FocusElement()
      const first = new FocusElement()
      const last = new FocusElement()
      const hidden = Object.assign(new FocusElement(), { hasLayout: false })
      panel.candidates = [first, last, hidden]
      documentFixture.activeElement = new FocusElement()
      const event = keyEvent(reverse)
      containModalTab(event, panel as unknown as HTMLElement)
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect((reverse ? last : first).focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(hidden.focus).not.toHaveBeenCalled()
    },
  )

  it('wraps endpoints without interfering with ordinary interior Tab navigation', () => {
    const panel = new FocusElement()
    const first = new FocusElement()
    const middle = new FocusElement()
    const last = new FocusElement()
    panel.candidates = [first, middle, last]
    documentFixture.activeElement = last
    containModalTab(keyEvent(), panel as unknown as HTMLElement)
    expect(first.focus).toHaveBeenCalledOnce()
    documentFixture.activeElement = first
    containModalTab(keyEvent(true), panel as unknown as HTMLElement)
    expect(last.focus).toHaveBeenCalledOnce()
    documentFixture.activeElement = middle
    const event = keyEvent()
    containModalTab(event, panel as unknown as HTMLElement)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps protected nested Shadow form inputs in the panel Tab order', () => {
    const panel = new FocusElement('div')
    const close = new FocusElement()
    const protectedHost = new FocusElement('div')
    const nestedHost = new FocusElement('div')
    const hostInput = new FocusElement('input')
    const usernameInput = new FocusElement('input')
    panel.candidates = [close, protectedHost]
    protectedHost.attachShadow([nestedHost], nestedHost)
    nestedHost.attachShadow([hostInput, usernameInput], hostInput)
    documentFixture.activeElement = protectedHost
    expect(getModalFocusableElements(panel as unknown as HTMLElement)).toEqual([
      close,
      hostInput,
      usernameInput,
    ])
    const interiorTab = keyEvent()
    containModalTab(interiorTab, panel as unknown as HTMLElement)
    expect(interiorTab.preventDefault).not.toHaveBeenCalled()
    expect(close.focus).not.toHaveBeenCalled()
    nestedHost.shadowRoot!.activeElement = usernameInput
    containModalTab(keyEvent(), panel as unknown as HTMLElement)
    expect(close.focus).toHaveBeenCalledWith({ preventScroll: true })
    documentFixture.activeElement = close
    containModalTab(keyEvent(true), panel as unknown as HTMLElement)
    expect(usernameInput.focus).toHaveBeenCalledWith({ preventScroll: true })
    protectedHost.excludedAncestor = true
    expect(getModalFocusableElements(panel as unknown as HTMLElement)).toEqual([close])
  })

  it('uses assigned slot order once and excludes unslotted and inert slot content', () => {
    const panel = new FocusElement('div')
    const host = new FocusElement('div')
    const slot = new FocusElement('slot')
    const first = new FocusElement()
    const last = new FocusElement()
    const unslotted = new FocusElement()
    panel.candidates = [host]
    host.candidates = [last, first, unslotted]
    host.attachShadow([slot])
    slot.assignedContent = [first, last]
    first.assignedSlot = last.assignedSlot = slot
    expect(getModalFocusableElements(panel as unknown as HTMLElement)).toEqual([first, last])
    documentFixture.activeElement = last
    containModalTab(keyEvent(), panel as unknown as HTMLElement)
    expect(first.focus).toHaveBeenCalledOnce()
    documentFixture.activeElement = first
    containModalTab(keyEvent(true), panel as unknown as HTMLElement)
    expect(last.focus).toHaveBeenCalledOnce()
    slot.excludedAncestor = true
    expect(getModalFocusableElements(panel as unknown as HTMLElement)).toEqual([])
  })

  it('keeps a temporarily empty panel focusable and ignores unrelated keys', () => {
    const panel = new FocusElement()
    const event = keyEvent()
    containModalTab(event, panel as unknown as HTMLElement)
    expect(panel.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    panel.focus.mockClear()
    containModalTab({ key: 'ArrowDown' } as KeyboardEvent, panel as unknown as HTMLElement)
    expect(panel.focus).not.toHaveBeenCalled()
  })
})
