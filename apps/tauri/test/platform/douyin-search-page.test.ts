import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

const scroll = readFileSync(
  new URL('../../src-tauri/src/browser/douyin_browser/scroll-page.js', import.meta.url),
  'utf8',
)
const inspect = readFileSync(
  new URL('../../src-tauri/src/browser/douyin_browser/inspect-search-page.js', import.meta.url),
  'utf8',
)
const submit = readFileSync(
  new URL('../../src-tauri/src/browser/douyin_browser/submit-search.js', import.meta.url),
  'utf8',
)
const prepare = readFileSync(
  new URL('../../src-tauri/src/browser/douyin_browser/prepare-search.js', import.meta.url),
  'utf8',
)
const verificationRoute = readFileSync(
  new URL(
    '../../src-tauri/src/browser/douyin_browser/verification-search-page.js',
    import.meta.url,
  ),
  'utf8',
)

afterEach(() => vi.unstubAllGlobals())

describe('official search page controls', () => {
  it('reuses the loaded verification homepage and exact keyword results without navigation', () => {
    const run = new Function(`return (${verificationRoute})`)()
    const query = '音乐 / captcha? & # +'
    const location = {
      origin: 'https://www.douyin.com',
      pathname: '/jingxuan',
      href: 'https://www.douyin.com/jingxuan',
    }
    const document = { readyState: 'complete', querySelectorAll: () => [] }
    vi.stubGlobal('location', location)
    vi.stubGlobal('document', document)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    // Execute the embedded scripts together, as CDP does, including the standalone IIFE.
    const inspectArgument = inspect.replace(/^;/, '')
    const embedded = new Function(
      `return (${verificationRoute})(${JSON.stringify(query)}, ${inspectArgument})`,
    )
    expect(embedded()).toBe('ready')
    expect(run(query, null)).toBe('ready')
    for (const route of ['/jingxuan/search/', '/search/']) {
      location.pathname = `${route}${encodeURIComponent(query)}`
      expect(run(query, null)).toBe('submitted')
      expect(run(query, 'verification-required')).toBe('waiting')
      expect(run(query, 'login-required')).toBe('waiting')
    }
    location.pathname = '/user/self'
    document.readyState = 'loading'
    expect(run(query, null)).toBe('waiting')
    document.readyState = 'complete'
    expect(run(query, 'verification-required')).toBe('waiting')
    expect(run(query, null)).toBe('navigate')
    location.pathname = '/jingxuan/search/another'
    expect(run(query, null)).toBe('navigate')
    location.pathname = '/jingxuan/search/%'
    expect(run(query, null)).toBe('waiting')
    location.origin = 'https://example.com'
    expect(run(query, null)).toBe('waiting')
  })
  it('focuses and selects the unique official field for browser-native text insertion', () => {
    const events: string[] = []
    const input = {
      disabled: false,
      value: '',
      focus: () => {
        document.activeElement = input
        events.push('focus')
      },
      select: () => events.push('select'),
    }
    const document: {
      readyState: string
      activeElement: unknown
      querySelectorAll: (selector: string) => unknown[]
    } = {
      readyState: 'interactive',
      activeElement: null,
      querySelectorAll: (selector) =>
        selector.startsWith('input') ? [input] : [{ disabled: false }],
    }
    vi.stubGlobal('location', { origin: 'https://www.douyin.com', pathname: '/jingxuan' })
    vi.stubGlobal('document', document)
    const run = () => new Function(`return ${prepare.slice(1)}`)()
    expect(run()).toBe(false)
    expect(events).toEqual([])
    document.readyState = 'complete'
    expect(run()).toBe(true)
    expect(events).toEqual(['focus', 'select'])
    expect(input.value).toBe('')
    input.disabled = true
    expect(run()).toBe(false)
  })
  it('reads the native controlled input after rendering and targets the current button', async () => {
    const query = '古风 / "& # +\\n'
    let inputs = [{ value: '', disabled: false }]
    const button = {
      disabled: false,
      getBoundingClientRect: () => ({ left: 40, top: 60, width: 80, height: 40 }),
      contains: (element: unknown) => element === button,
      click: vi.fn(),
    }
    vi.stubGlobal('location', { origin: 'https://www.douyin.com', pathname: '/jingxuan' })
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('document', {
      readyState: 'complete',
      querySelectorAll: (selector: string) => (selector.startsWith('input') ? inputs : [button]),
      elementFromPoint: () => button,
    })
    const run = new Function(`return (${submit})`)()
    const pending = run(query)
    queueMicrotask(() => {
      inputs = [{ value: query, disabled: false }]
    })
    expect(await pending).toEqual({ x: 80, y: 80 })
    expect(button.click).not.toHaveBeenCalled()
    inputs[0]!.value = ''
    expect(await run(query)).toBe(false)
    inputs[0]!.value = query
    inputs.push(inputs[0]!)
    expect(await run(query)).toBe(false)
    inputs.pop()
    inputs[0]!.disabled = true
    expect(await run(query)).toBe(false)
  })
  it('rejects loading, foreign routes, disabled, occluded and offscreen search buttons', async () => {
    let bounds = { left: 40, top: 60, width: 80, height: 40 }
    let hit: unknown
    const button = {
      disabled: false,
      getBoundingClientRect: () => bounds,
      contains: (element: unknown) => element === button,
    }
    hit = button
    const document = {
      readyState: 'interactive',
      querySelectorAll: (selector: string) =>
        selector.startsWith('input') ? [{ value: '古风', disabled: false }] : [button],
      elementFromPoint: () => hit,
    }
    const location = { origin: 'https://www.douyin.com', pathname: '/jingxuan' }
    vi.stubGlobal('location', location)
    vi.stubGlobal('document', document)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    const run = new Function(`return (${submit})`)()
    expect(await run('古风')).toBe(false)
    document.readyState = 'complete'
    expect(await run('古风')).toEqual({ x: 80, y: 80 })
    hit = {}
    expect(await run('古风')).toBe(false)
    hit = button
    bounds = { left: 1200, top: 60, width: 80, height: 40 }
    expect(await run('古风')).toBe(false)
    bounds = { left: 40, top: 60, width: 0, height: 0 }
    expect(await run('古风')).toBe(false)
    button.disabled = true
    expect(await run('古风')).toBe(false)
    location.pathname = '/jingxuan/search/古风'
    expect(await run('古风')).toBe(false)
    location.pathname = '/jingxuan'
    location.origin = 'https://evil.example'
    expect(await run('古风')).toBe(false)
  })
  it.each(['/search/音乐', '/jingxuan/search/音乐'])(
    'measures only the content ancestor for native wheel input at %s',
    (pathname) => {
      const content = {
        parentElement: null,
        clientHeight: 500,
        scrollHeight: 2000,
        scrollTop: 0,
        dispatchEvent: vi.fn(),
        contains: (hit: unknown) => hit === content,
        getBoundingClientRect: () => ({ left: 100, top: 60, right: 900, bottom: 560 }),
      }
      const scrollBy = vi.fn()
      vi.stubGlobal('location', { origin: 'https://www.douyin.com', pathname })
      vi.stubGlobal('innerHeight', 800)
      vi.stubGlobal('innerWidth', 1000)
      vi.stubGlobal('document', {
        querySelector: () => ({ parentElement: content }),
        scrollingElement: { scrollTop: 0, scrollHeight: 9000 },
        elementFromPoint: () => content,
      })
      vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
      vi.stubGlobal('window', { scrollBy })
      expect(new Function(`return ${scroll.slice(1)}`)()).toEqual({
        x: 500,
        y: 381.40000000000003,
        viewportHeight: 476,
        remaining: 1500,
      })
      expect(content.scrollTop).toBe(0)
      expect(content.dispatchEvent).not.toHaveBeenCalled()
      expect(scrollBy).not.toHaveBeenCalled()
    },
  )
  it('targets result-list ancestors without video links and reports resized content without moving it', () => {
    const content = {
      parentElement: null,
      clientHeight: 809,
      scrollHeight: 1629,
      scrollTop: 0,
      dispatchEvent: vi.fn(),
      contains: (hit: unknown) => hit === content,
      getBoundingClientRect: () => ({ left: 180, top: 80, right: 1000, bottom: 889 }),
    }
    const list = { parentElement: { parentElement: content, clientHeight: 0 } }
    const sidebar = { clientHeight: 800, scrollHeight: 9000, scrollTop: 0 }
    const scrollBy = vi.fn()
    vi.stubGlobal('location', {
      origin: 'https://www.douyin.com',
      pathname: '/jingxuan/search/纯音乐',
    })
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('document', {
      querySelector: (selector: string) => (selector === '[data-e2e="scroll-list"]' ? list : null),
      scrollingElement: sidebar,
      elementFromPoint: () => content,
    })
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    vi.stubGlobal('window', { scrollBy })
    const run = () => new Function(`return ${scroll.slice(1)}`)()
    expect(run()).toMatchObject({ remaining: 820, viewportHeight: 696 })
    content.scrollTop = 819
    expect(run()).toMatchObject({ remaining: 1 })
    content.scrollTop = 820
    expect(run()).toMatchObject({ remaining: 0 })
    expect(sidebar.scrollTop).toBe(0)
    expect(content.dispatchEvent).not.toHaveBeenCalled()
    expect(scrollBy).not.toHaveBeenCalled()
  })
  it('measures the viewport fallback without scrolling the window itself', () => {
    const scrollBy = vi.fn()
    const root = {
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 800,
      contains: (hit: unknown) => hit === root,
    }
    vi.stubGlobal('location', { origin: 'https://www.douyin.com', pathname: '/search/音乐' })
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('document', {
      querySelector: () => null,
      scrollingElement: root,
      elementFromPoint: () => root,
    })
    vi.stubGlobal('window', { scrollBy })
    expect(new Function(`return ${scroll.slice(1)}`)()).toMatchObject({
      x: 500,
      viewportHeight: 776,
      remaining: 1100,
    })
    expect(root.scrollTop).toBe(100)
    expect(scrollBy).not.toHaveBeenCalled()
  })
  it('refuses covered, nested, offscreen or foreign result areas instead of targeting a sidebar', () => {
    let bounds = { left: 100, top: 60, right: 900, bottom: 560 }
    const content = {
      parentElement: null,
      scrollTop: 0,
      scrollHeight: 2000,
      clientHeight: 500,
      contains: (hit: unknown) => hit === content || hit === nested,
      getBoundingClientRect: () => bounds,
    }
    const nested = {
      parentElement: content,
      clientHeight: 100,
      scrollHeight: 500,
    }
    let hit: unknown = {}
    const location = { origin: 'https://www.douyin.com', pathname: '/jingxuan/search/音乐' }
    vi.stubGlobal('location', location)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('getComputedStyle', () => ({ overflowY: 'auto' }))
    vi.stubGlobal('document', {
      querySelector: () => ({ parentElement: content }),
      scrollingElement: {},
      elementFromPoint: () => hit,
    })
    const run = () => new Function(`return ${scroll.slice(1)}`)()
    expect(run()).toBeNull()
    hit = nested
    expect(run()).toBeNull()
    hit = content
    expect(run()).not.toBeNull()
    bounds = { left: 1200, top: 60, right: 1800, bottom: 560 }
    expect(run()).toBeNull()
    bounds = { left: 100, top: 60, right: 900, bottom: 560 }
    location.pathname = '/jingxuan'
    expect(run()).toBeNull()
    location.pathname = '/jingxuan/search/音乐'
    location.origin = 'https://evil.example'
    expect(run()).toBeNull()
  })
  it.each(['/search/captcha', '/jingxuan/search/captcha'])(
    'does not classify a search keyword or query parameter as verification at %s',
    (path) => {
      vi.stubGlobal('location', {
        origin: 'https://www.douyin.com',
        href: `https://www.douyin.com${path}?type=general&verify=1`,
      })
      vi.stubGlobal('innerWidth', 1000)
      vi.stubGlobal('innerHeight', 800)
      vi.stubGlobal('document', { querySelectorAll: () => [] })
      const run = () => new Function(`return ${inspect.slice(1)}`)()
      expect(run()).toBeNull()
      vi.stubGlobal('location', {
        origin: 'https://www.douyin.com',
        href: 'https://www.douyin.com/verify',
      })
      expect(run()).toBe('verification-required')
    },
  )
  it('recognizes visible verification while ignoring hidden and offscreen captcha nodes', () => {
    let captcha = {
      parentElement: null,
      getBoundingClientRect: () => ({
        width: 300,
        height: 200,
        left: 10,
        right: 310,
        top: 10,
        bottom: 210,
      }),
    }
    const style = { display: 'block', visibility: 'visible', opacity: '1' }
    vi.stubGlobal('location', {
      origin: 'https://www.douyin.com',
      href: 'https://www.douyin.com/search/音乐',
    })
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('getComputedStyle', () => style)
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) => (selector.includes('captcha') ? [captcha] : []),
    })
    const run = () => new Function(`return ${inspect.slice(1)}`)()
    expect(run()).toBe('verification-required')
    style.display = 'none'
    expect(run()).toBeNull()
    style.display = 'block'
    captcha = {
      ...captcha,
      getBoundingClientRect: () => ({
        width: 300,
        height: 200,
        left: 1200,
        right: 1500,
        top: 10,
        bottom: 210,
      }),
    }
    expect(run()).toBeNull()
  })
  it('reports a visible login panel as a signal requiring native credential reconciliation', () => {
    vi.stubGlobal('location', {
      origin: 'https://www.douyin.com',
      href: 'https://www.douyin.com/jingxuan',
    })
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 800)
    const style = { display: 'block', visibility: 'visible', opacity: '1' }
    const panel = {
      parentElement: null,
      getBoundingClientRect: () => ({
        width: 300,
        height: 200,
        left: 10,
        right: 310,
        top: 10,
        bottom: 210,
      }),
    }
    vi.stubGlobal('getComputedStyle', () => style)
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) => (selector.includes('login-panel') ? [panel] : []),
    })
    const run = () => new Function(`return ${inspect.slice(1)}`)()
    expect(run()).toBe('login-required')
    style.display = 'none'
    expect(run()).toBeNull()
  })
})
