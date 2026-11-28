import { createAppErrorState } from '@any-music/core'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import { defineComponent, h, shallowRef, nextTick } from 'vue'

import { definition } from '../../../src/vue'
import {
  mountCatalogComponent,
  findCatalogElement,
  dispatchCatalogEvent,
} from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? h('dialog', [slots.default?.(), slots.footer?.()]) : null,
  }),
}))

describe('classic specialist availability and plugin controls', () => {
  it('withdraws and restores tag editing with plugin availability', async () => {
    const enabled = shallowRef(false)
    const setup = vi.fn()
    const retry = vi.fn()
    const Editor = defineComponent({
      setup() {
        setup()
        return () => h('p', '编辑器')
      },
    })
    const feature = {
      state: {
        get Editor() {
          return enabled.value ? Editor : null
        },
      },
      get availability() {
        return enabled.value
          ? { status: 'available' as const }
          : { status: 'disabled' as const, reason: '功能已停用，数据保留' }
      },
      status: { status: 'error' as const, error: createAppErrorState('conflict', '加载失败') },
      actions: { retry },
    } as UiThemeFeatureMap['tags']
    const { root, unmount } = mountCatalogComponent(
      defineComponent({ render: () => h(definition.views.tags as Component, { feature }) }),
      {},
    )
    expect(root.textContent).toContain('功能已停用，数据保留')
    expect(setup).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(root, (node) => node.tag === 'button'),
      'onClick',
    )
    expect(retry).toHaveBeenCalledTimes(1)
    enabled.value = true
    await nextTick()
    expect(setup).toHaveBeenCalledTimes(1)
    enabled.value = false
    await nextTick()
    expect(root.textContent).not.toContain('编辑器')
    unmount()
  })

  it('forwards enablement from the card and retry from the plugin introduction', async () => {
    const setEnabled = vi.fn(),
      retry = vi.fn()
    const feature: UiThemeFeatureMap['plugins'] = {
      state: {
        externalSupported: false,
        busy: false,
        items: [
          {
            id: 'feature.tags',
            name: '标签管理',
            description: '整理音乐标签',
            origin: 'builtin',
            category: '资料整理',
            enabled: false,
            status: { status: 'error', error: createAppErrorState('conflict', '加载失败') },
          },
        ],
      },
      actions: {
        setEnabled,
        retry,
        importPlugin: vi.fn(),
        manageExternal: vi.fn(),
        refresh: vi.fn(),
      },
      availability: { status: 'available' },
      status: { status: 'ready' },
    }
    const { root, unmount } = mountCatalogComponent(
      defineComponent({ render: () => h(definition.views.plugins, { feature }) }),
      {},
    )
    const checkbox = findCatalogElement(root, (node) => node.props.type === 'checkbox')
    ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } })
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith('feature.tags', true)
    expect(retry).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(root, (node) => node.props['aria-label'] === '查看插件介绍 标签管理'),
      'onClick',
    )
    await nextTick()
    const dialog = findCatalogElement(root, (node) => node.tag === 'dialog')
    dispatchCatalogEvent(
      findCatalogElement(
        dialog,
        (node) => node.tag === 'button' && node.textContent.includes('重试加载'),
      ),
      'onClick',
    )
    expect(retry).toHaveBeenCalledExactlyOnceWith('feature.tags')
    expect(dialog.textContent).toContain('错误信息加载失败')
    unmount()
  })
})
