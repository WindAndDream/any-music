import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

class PageElement {
  textContent = ''
  parentElement: PageElement | undefined
  children: PageElement[] = []
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  style = { setProperty() {}, removeProperty() {} }
  shadow: PageElement | undefined
  click: ((event: { isTrusted: boolean }) => void) | undefined

  readonly tag: string

  constructor(tag: string) {
    this.tag = tag
  }

  append(...elements: PageElement[]) {
    for (const element of elements) {
      element.parentElement = this
      this.children.push(element)
    }
  }

  replaceChildren(...elements: PageElement[]) {
    this.children = []
    this.append(...elements)
  }

  attachShadow({ mode }: { mode: string }) {
    expect(mode).toBe('closed')
    this.shadow = new PageElement('shadow')
    return this.shadow
  }

  closest() {
    return undefined
  }

  contains(element: PageElement): boolean {
    return element === this || this.children.some((child) => child.contains(element))
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 }
  }

  checkVisibility() {
    return !this.attributes.has('data-am-catalog-hidden')
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  toggleAttribute(name: string, value: boolean) {
    if (value) this.setAttribute(name, '')
    else this.removeAttribute(name)
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this)
    this.parentElement = undefined
  }

  addEventListener(_event: string, click: PageElement['click']) {
    this.click = click
  }
}

function createPage() {
  const source = readFileSync(
    new URL('../../src-tauri/src/browser/douyin_browser/presentation-page.js', import.meta.url),
    'utf8',
  )
  const original = new PageElement('official')
  const body = new PageElement('body')
  body.append(original)
  const matches: PageElement[] = []
  const document = {
    body,
    documentElement: new PageElement('html'),
    adoptedStyleSheets: [],
    createElement: (tag: string) => new PageElement(tag),
    querySelectorAll: () => matches,
  }
  const realm: {
    anyMusicSearch?: {
      update(
        content: unknown,
        verification?: boolean,
      ): { action?: unknown; challengeVisible: boolean }
      consume(): { action?: unknown; needsContent: boolean; challengeVisible: boolean }
      suspend(): void
    }
  } = {}
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    get top() {
      return this
    },
  }
  const install = new Function(
    'window',
    'location',
    'document',
    'globalThis',
    'CSSStyleSheet',
    'CSS',
    `return ${source.trimStart().replace(/^;/, '')}`,
  )
  const location = { origin: 'https://www.douyin.com', href: 'https://www.douyin.com/jingxuan' }
  class Sheet {
    replaceSync() {}
  }
  expect(install(window, location, document, realm, Sheet, { supports: () => false })).toBe(true)
  return { catalog: realm.anyMusicSearch!, document, original, body, matches }
}

it('projects text into the browser Shadow DOM and honors only user clicks', () => {
  const { catalog, body, original } = createPage()
  catalog.update({
    rows: [{ id: 'track', title: '<b>歌曲</b>', artwork: 'https://example.test/cover.png' }],
    palette: {},
  })
  expect(body.attributes.has('data-am-catalog-results')).toBe(true)
  expect(body.children[0]).toBe(original)
  const title = body.children[1]!.shadow!.children[0]!.children[0]!.children[1]!
  expect(title.children[0]?.textContent).toBe('<b>歌曲</b>')
  title.click?.({ isTrusted: false })
  expect(catalog.consume().action).toBeUndefined()
  title.click?.({ isTrusted: true })
  expect(catalog.consume().action).toEqual({ type: 'play', id: 'track' })

  catalog.suspend()
  expect(body.attributes.has('data-am-catalog-results')).toBe(false)
  expect(body.children).toEqual([original])
})

it('waits for a single official verification region and hides sibling page content', () => {
  const { catalog, document, body, original, matches } = createPage()
  expect(catalog.update({ palette: {} }, true).challengeVisible).toBe(false)
  expect(document.documentElement.attributes.has('data-am-catalog-challenge-pending')).toBe(true)
  expect(original.attributes.has('data-am-catalog-hidden')).toBe(false)

  const dialog = new PageElement('div')
  const iframe = new PageElement('iframe')
  body.append(dialog)
  dialog.append(iframe)
  matches.push(dialog, iframe)
  expect(catalog.consume().challengeVisible).toBe(true)
  expect(original.attributes.has('data-am-catalog-hidden')).toBe(true)
  expect(iframe.attributes.has('data-am-catalog-hidden')).toBe(false)

  dialog.remove()
  expect(catalog.consume().challengeVisible).toBe(false)
  expect(original.attributes.has('data-am-catalog-hidden')).toBe(false)
  catalog.update({ rows: [], palette: {} }, false)
  expect(document.documentElement.attributes.has('data-am-catalog-challenge-pending')).toBe(false)
  expect(body.children[1]?.shadow).toBeDefined()
})
