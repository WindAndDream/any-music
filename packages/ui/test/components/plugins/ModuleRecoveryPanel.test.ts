import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ModuleRecoveryPanel from '../../../src/components/plugins/ModuleRecoveryPanel.vue'
import {
  dispatchCatalogEvent,
  CatalogTestElement,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

afterEach(() => vi.unstubAllGlobals())

function focusFixture(root: CatalogTestElement) {
  const document = { activeElement: null as CatalogTestElement | null }
  vi.stubGlobal('document', document)
  vi.stubGlobal('HTMLElement', CatalogTestElement)
  const visit = (node: CatalogTestElement): void => {
    Object.assign(node, {
      localName: node.tag,
      tabIndex: node.tag === 'button' ? 0 : -1,
      matches: (selector: string) => {
        if (selector === ':disabled') return Boolean(node.props.disabled)
        if (selector.startsWith('[inert]')) return false
        return node.tag === 'button'
      },
      getClientRects: () => [{}],
      ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) } },
      focus: vi.fn(() => {
        document.activeElement = node
      }),
    })
    Object.defineProperty(node, 'parentElement', { get: () => node.parent })
    for (const child of node.children) visit(child)
  }
  visit(root)
  return document
}

function tab(panel: CatalogTestElement, reverse = false) {
  const event = { key: 'Tab', shiftKey: reverse, preventDefault: vi.fn() }
  ;(panel.props.onKeydown as (event: unknown) => void)(event)
  return event
}

describe('host module recovery panel', () => {
  it('focuses the recovery region and keeps Tab endpoints on its three host actions', async () => {
    const mounted = mountCatalogComponent(ModuleRecoveryPanel, { busy: false, hasFailure: true })
    const document = focusFixture(mounted.root)
    const panel = findCatalogElement(mounted.root, (node) => node.tag === 'section')
    try {
      await nextTick()
      expect(document.activeElement).toBe(panel)
      expect(panel.props.tabindex).toBe('-1')
      expect(tab(panel).preventDefault).toHaveBeenCalledOnce()
      const first = document.activeElement!
      expect(first.textContent).toBe('重新加载')
      expect(tab(panel, true).preventDefault).toHaveBeenCalledOnce()
      expect(document.activeElement?.textContent.trim()).toBe('恢复默认主题')
      expect(tab(panel).preventDefault).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(first)
      expect(tab(panel).preventDefault).not.toHaveBeenCalled()
    } finally {
      mounted.unmount()
    }
  })

  it('keeps a busy recovery focusable when every action becomes disabled', async () => {
    const busy = shallowRef(false)
    const Parent = defineComponent({
      setup: () => () => h(ModuleRecoveryPanel, { busy: busy.value, hasFailure: false }),
    })
    const mounted = mountCatalogComponent(Parent, {})
    const document = focusFixture(mounted.root)
    const panel = findCatalogElement(mounted.root, (node) => node.tag === 'section')
    try {
      await nextTick()
      tab(panel)
      expect(document.activeElement?.tag).toBe('button')
      busy.value = true
      await nextTick()
      await nextTick()
      expect(panel.props['aria-busy']).toBe('true')
      expect(document.activeElement).toBe(panel)
      expect(tab(panel).preventDefault).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(panel)
    } finally {
      mounted.unmount()
    }
  })

  it('offers usable recovery actions independently of themes and contribution allocation', () => {
    const onRetry = vi.fn(),
      onSafeStart = vi.fn(),
      onRestoreDefaultTheme = vi.fn()
    const mounted = mountCatalogComponent(ModuleRecoveryPanel, {
      busy: false,
      hasFailure: true,
      onRetry,
      onSafeStart,
      onRestoreDefaultTheme,
    })
    expect(mounted.root.textContent).toContain('系统模块启动失败')
    for (const label of ['重新加载', '安全启动', '恢复默认主题']) {
      dispatchCatalogEvent(
        findCatalogElement(
          mounted.root,
          (node) => node.tag === 'button' && node.textContent.trim() === label,
        ),
        'onClick',
      )
    }
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onSafeStart).toHaveBeenCalledTimes(1)
    expect(onRestoreDefaultTheme).toHaveBeenCalledTimes(1)
    mounted.unmount()
  })
})
