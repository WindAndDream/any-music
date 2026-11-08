import { createDefaultAppShellPreferences, PRODUCT_DESTINATIONS } from '@any-music/ui'
import type { UiThemeFeatureMap, UiThemeViews } from '@any-music/ui/theme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { definition } from '../../../src/vue'

afterEach(() => vi.unstubAllGlobals())

describe('T04 classic root assembly', () => {
  it.each(['desktop', 'mobile'] as const)(
    'assembles %s chrome with controlled future-page test doubles and a host identity slot',
    async (form) => {
      vi.stubGlobal('window', {
        matchMedia: () => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
      const shell: UiThemeFeatureMap['shell'] = {
        state: { activeViewId: 'catalog', destinations: PRODUCT_DESTINATIONS, hidden: false },
        actions: { navigate: vi.fn(), hide: vi.fn(), show: vi.fn(), openSettings: vi.fn() },
        availability: { status: 'available' },
        status: { status: 'ready' },
      }
      const navigation: UiThemeFeatureMap['navigation'] = {
        state: {
          activeViewId: 'catalog',
          destinations: PRODUCT_DESTINATIONS,
          preferences: createDefaultAppShellPreferences(),
        },
        actions: { navigate: vi.fn(), setPreferences: vi.fn() },
        availability: { status: 'available' },
        status: { status: 'ready' },
      }
      const player: UiThemeFeatureMap['player'] = {
        state: {
          track: null,
          playing: false,
          positionMs: 0,
          durationMs: 0,
          volume: 1,
          playbackRate: 1,
          mode: 'sequence',
          quality: { id: 'default', label: '默认', rank: 1 },
          qualities: [],
          canSeek: false,
          canDownload: false,
        },
        actions: {
          play: vi.fn(),
          pause: vi.fn(),
          previous: vi.fn(),
          next: vi.fn(),
          seek: vi.fn(),
          setVolume: vi.fn(),
          setPlaybackRate: vi.fn(),
          setMode: vi.fn(),
          setQuality: vi.fn(),
          download: vi.fn(),
          retry: vi.fn(),
        },
        availability: { status: 'available' },
        status: { status: 'empty' },
      }
      // Only future pages are test doubles. The exported production definition still
      // fails coverage admission; this test does not fill it with production placeholders.
      const features = {
        shell,
        navigation,
        player,
        catalog: { state: { sourceId: 'source' } },
        overlays: { state: { active: null, notice: null } },
      } as UiThemeFeatureMap
      const views = {
        ...definition.views,
        catalog: defineComponent({
          render: () => h('main', { 'data-test-page': 'catalog' }, '目录测试页'),
        }),
        overlays: defineComponent({ render: () => null }),
      } as unknown as UiThemeViews
      const html = await renderToString(
        createSSRApp({
          render: () =>
            h(
              definition.Root,
              { features, views, form },
              {
                'source-identity': ({ sourceId }: { sourceId: string }) =>
                  h('span', { 'data-host-identity': sourceId }, '宿主账号'),
              },
            ),
        }),
      )
      expect(html).toContain('am-theme-default')
      expect(html).toContain('目录测试页')
      expect(html).toContain('data-host-identity="source"')
      expect(html).toContain('精确播放进度')
      expect(html).toContain(form === 'mobile' ? '打开功能导航' : 'navigation-rail')
    },
  )
})
