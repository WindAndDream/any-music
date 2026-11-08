import { AppDialog, BottomSheet, provideBackNavigation } from '@any-music/ui'
import type { BackNavigation } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'

import SettingsNavigation from '../../../src/components/settings/SettingsNavigation.vue'
import {
  CatalogTestElement,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

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
describe('classic settings Back integration', () => {
  it('returns through settings before closing, while a newer dialog takes priority', async () => {
    const state = reactive({ open: true, confirmation: false })
    let navigation!: BackNavigation
    const settings = defineComponent({
      setup: () => () =>
        h(SettingsNavigation, {
          isMobileLayout: true,
          initialSection: 'accounts',
          groups: [
            {
              id: 'music',
              title: '音乐源',
              entries: [
                {
                  id: 'accounts',
                  title: '账号管理',
                  icon: 'user',
                  description: '账号与登录',
                },
              ],
            },
          ],
        }),
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          navigation = provideBackNavigation()
          return () =>
            h('div', [
              h(
                BottomSheet,
                {
                  open: state.open,
                  title: '设置',
                  onClose: () => (state.open = false),
                },
                { default: () => h(settings) },
              ),
              h(AppDialog, {
                open: state.confirmation,
                title: '确认操作',
                onClose: () => (state.confirmation = false),
              }),
            ])
        },
      }),
      {},
    )
    unmounts.push(view.unmount)
    state.confirmation = true
    await nextTick()
    navigation.back()
    expect(state.confirmation).toBe(false)
    await nextTick()
    const detail = () =>
      findCatalogElement(
        view.root,
        (node) =>
          node.props.class === 'settings-navigation settings-navigation--mobile' ||
          String(node.props.class).includes('settings-navigation--mobile'),
      )
    expect(detail().props['data-detail-open']).toBe(true)
    navigation.back()
    await nextTick()
    expect(detail().props['data-detail-open']).toBe(false)
    expect(state.open).toBe(true)
    navigation.back()
    await nextTick()
    expect(state.open).toBe(false)
    expect(navigation.back()).toBe(false)
  })
})
