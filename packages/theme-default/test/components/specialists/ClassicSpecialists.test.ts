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
        props.open ? h('dialog', slots.default?.()) : null,
  }),
}))

describe('classic specialist availability and plugin controls', () => {
  it.each(['tags', 'composer'] as const)(
    'withdraws and restores %s without constructing a plugin or retaining its editor',
    async (id) => {
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
      } as UiThemeFeatureMap[typeof id]
      const { root, unmount } = mountCatalogComponent(
        defineComponent({ render: () => h(definition.views[id] as Component, { feature }) }),
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
    },
  )

  it('forwards only named enable and retry actions from the built-in plugin page', () => {
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
    dispatchCatalogEvent(
      findCatalogElement(
        root,
        (node) => node.tag === 'button' && node.textContent.includes('重试'),
      ),
      'onClick',
    )
    expect(setEnabled).toHaveBeenCalledWith('feature.tags', true)
    expect(retry).toHaveBeenCalledWith('feature.tags')
    expect(root.textContent).toContain('加载失败')
    unmount()
  })
})
