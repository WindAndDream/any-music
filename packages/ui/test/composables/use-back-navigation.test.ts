import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive } from 'vue'

import BottomSheet from '../../src/components/BottomSheet.vue'
import {
  createBackNavigation,
  provideBackNavigation,
  useBackHandler,
} from '../../src/composables/use-back-navigation'
import type { BackNavigation } from '../../src/composables/use-back-navigation'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../components/music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('HTMLElement', CatalogTestElement)
})
const unmounts: (() => void)[] = []
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount())
  vi.unstubAllGlobals()
})

describe('scoped Back navigation', () => {
  it('chooses one highest layer at a time and the latest activation within that layer', () => {
    const navigation = createBackNavigation()
    const view = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    navigation.register('content', view)
    const closeFirst = navigation.register('modal', first)
    const closeSecond = navigation.register('modal', second)
    expect(navigation.back()).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    expect(view).not.toHaveBeenCalled()
    closeSecond()
    navigation.back()
    expect(first).toHaveBeenCalledOnce()
    closeFirst()
    navigation.back()
    expect(view).toHaveBeenCalledOnce()
  })

  it('uses the account-style Back action but retains explicit close semantics', async () => {
    const state = reactive({ open: true, section: 'details' })
    let navigation!: BackNavigation
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          navigation = provideBackNavigation()
          return () =>
            h(BottomSheet, {
              open: state.open,
              title: '抖音 · 账号管理',
              backAction: () => (state.section = 'accounts'),
              onClose: () => (state.open = false),
            })
        },
      }),
      {},
    )
    unmounts.push(view.unmount)
    navigation.back()
    expect(state.section).toBe('accounts')
    expect(state.open).toBe(true)
    const close = findCatalogElement(view.root, (node) => node.props['aria-label'] === '关闭')
    dispatchCatalogEvent(close, 'onClick')
    await nextTick()
    expect(state.open).toBe(false)
    expect(navigation.back()).toBe(false)
  })

  it('suspends cached handlers and restores them on KeepAlive activation', async () => {
    const state = reactive({ visible: true, active: true })
    const back = vi.fn()
    let navigation!: BackNavigation
    const cached = defineComponent({
      setup() {
        useBackHandler({ active: () => state.active, handle: back })
        return () => h('div')
      },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          navigation = provideBackNavigation()
          return () => h(KeepAlive, null, { default: () => (state.visible ? h(cached) : null) })
        },
      }),
      {},
    )
    unmounts.push(view.unmount)
    navigation.back()
    expect(back).toHaveBeenCalledOnce()
    state.visible = false
    await nextTick()
    expect(navigation.back()).toBe(false)
    state.visible = true
    await nextTick()
    expect(navigation.back()).toBe(true)
    state.active = false
    expect(navigation.back()).toBe(false)
    view.unmount()
    unmounts.pop()
    expect(navigation.back()).toBe(false)
  })
})
