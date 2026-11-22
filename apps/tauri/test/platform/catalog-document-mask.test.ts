import { afterEach, expect, it, vi } from 'vitest'

import { createCatalogDocumentMask } from '../../src/catalog-webview/document-mask'

class ElementFixture {
  readonly tagName: string
  readonly ownerDocument?: object
  readonly attributes = new Map<string, string>()
  parentElement: ElementFixture | null = null
  readonly children: ElementFixture[] = []
  readonly dataset: Record<string, string> = {}

  constructor(tagName: string, ownerDocument?: object) {
    this.tagName = tagName
    this.ownerDocument = ownerDocument
  }
  get isConnected() {
    return Boolean(this.parentElement)
  }
  append(node: ElementFixture) {
    node.parentElement = this
    this.children.push(node)
  }
  remove() {
    const parent = this.parentElement
    if (parent) parent.children.splice(parent.children.indexOf(this), 1)
    this.parentElement = null
  }
  getAttribute(name: string) {
    return this.attributes.get(name)
  }
  hasAttribute(name: string) {
    return this.attributes.has(name)
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}

afterEach(() => vi.unstubAllGlobals())

it('masks original containers without detaching them and restores their own state on cleanup', () => {
  type Change = { addedNodes: ElementFixture[]; removedNodes: ElementFixture[] }
  let update!: (changes: Change[]) => void
  const disconnect = vi.fn()
  const replaceSync = vi.fn()
  vi.stubGlobal('Element', ElementFixture)
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: (changes: Change[]) => void) {
        update = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  vi.stubGlobal(
    'CSSStyleSheet',
    class {
      replaceSync = replaceSync
    },
  )
  const body = new ElementFixture('BODY')
  const originalSheet = {}
  const document = {
    body,
    documentElement: new ElementFixture('HTML'),
    adoptedStyleSheets: [originalSheet],
  }
  const original = new ElementFixture('MAIN')
  const existingInert = new ElementFixture('DIV')
  existingInert.setAttribute('inert', '')
  body.append(original)
  body.append(existingInert)
  const host = new ElementFixture('DIV', document)
  host.setAttribute('data-am-catalog-host', 'one')

  const mask = createCatalogDocumentMask(host as unknown as HTMLElement, 'one')
  mask.show()
  mask.show()
  expect(body.children).toEqual([original, existingInert, host])
  expect(original.hasAttribute('inert')).toBe(true)
  expect(host.hasAttribute('inert')).toBe(false)
  expect(document.adoptedStyleSheets).toHaveLength(2)
  const style = replaceSync.mock.calls[0]?.[0] as string
  expect(style).toMatch(/:is\(img, video, canvas\)\s*\{[^}]*visibility: hidden/)
  expect(style).not.toMatch(/display: none|content-visibility: hidden/)

  const late = new ElementFixture('ASIDE')
  const originalAttributes = vi.spyOn(original, 'setAttribute')
  body.append(late)
  update([{ addedNodes: [late], removedNodes: [] }])
  expect(late.hasAttribute('inert')).toBe(true)
  expect(originalAttributes).not.toHaveBeenCalled()

  late.remove()
  body.append(late)
  update([{ addedNodes: [late], removedNodes: [late] }])
  expect(late.hasAttribute('inert')).toBe(true)
  late.remove()
  update([{ addedNodes: [], removedNodes: [late] }])
  expect(late.hasAttribute('inert')).toBe(false)

  mask.close()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(body.children).toEqual([original, existingInert])
  expect(original.hasAttribute('inert')).toBe(false)
  expect(existingInert.hasAttribute('inert')).toBe(true)
  expect(late.hasAttribute('inert')).toBe(false)
  expect(document.documentElement.dataset.amCatalogDocument).toBeUndefined()
  expect(document.adoptedStyleSheets).toEqual([originalSheet])
})
