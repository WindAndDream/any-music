import { afterEach, describe, expect, it, vi } from 'vitest'

import { attachGeneratedShadowStyles } from '@/platform/dom/shadow-style-registry'

const SHADOW_STYLE_STATE_KEY = '__ANY_MUSIC_SHADOW_STYLE_STATE_V1__'

afterEach(() => vi.unstubAllGlobals())

/** 只记录样式节点与 MutationObserver 生命周期，不启动产品或模拟浏览器布局。 */
function createStyleEnvironment(cssTexts: string[] = []) {
  const sources: TestStyle[] = []
  const styles: TestStyle[] = []
  const state: { cssTexts: string[]; root?: ShadowRoot } = { cssTexts }
  const head = { querySelectorAll: () => sources }
  const root = {
    append: (style: TestStyle) => {
      styles.push(style)
      style.remove = () => styles.splice(styles.indexOf(style), 1)
    },
  } as unknown as ShadowRoot
  let notifyMutation: (() => void) | undefined
  const observe = vi.fn()
  const disconnect = vi.fn()

  vi.stubGlobal(SHADOW_STYLE_STATE_KEY, state)
  vi.stubGlobal('document', { head, createElement: () => createStyle() })
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe = observe
      disconnect = disconnect

      constructor(callback: () => void) {
        notifyMutation = callback
      }
    },
  )

  return {
    sources,
    styles,
    state,
    root,
    head,
    observe,
    disconnect,
    notify: () => notifyMutation?.(),
  }
}

function createStyle(id?: string, cssText = ''): TestStyle {
  return { dataset: { viteDevId: id }, textContent: cssText, remove: () => {} }
}

interface TestStyle {
  dataset: Record<string, string | undefined>
  textContent: string
  remove: () => void
}

describe('attachGeneratedShadowStyles', () => {
  it('mirrors and removes lazy built-in tag styles within the product Shadow Root', () => {
    const environment = createStyleEnvironment()
    const detach = attachGeneratedShadowStyles(environment.root)
    environment.sources.push(
      createStyle(
        '/workspace/packages/plugin-tag-management/src/vue/tag-management.scss',
        '.tag-management{display:grid}',
      ),
    )
    environment.notify()
    expect(environment.styles.map((style) => style.textContent)).toEqual([
      '.tag-management{display:grid}',
    ])
    environment.sources.splice(0)
    environment.notify()
    expect(environment.styles).toHaveLength(0)
    detach()
  })
  it.each([
    'C:/example/any-music/packages/theme-default/src/components/player/PlayerBar.vue?vue&type=style&index=0&scoped=player&lang.css',
    'C:\\example\\any-music\\packages\\theme-default\\src\\components\\player\\PlayerBar.vue?vue&type=style&index=0&lang.css',
  ])('mirrors the shared player alongside UI and app styles for %s', (playerStyleId) => {
    const environment = createStyleEnvironment()
    const playerCss = '.player[data-v-player]{display:grid;grid-template-columns:1fr 1.5fr 1fr}'
    environment.sources.push(
      createStyle('/workspace/apps/userscript/src/App.vue?vue&type=style', '.app{display:grid}'),
      createStyle('/workspace/packages/ui/src/PlayerControlPager.vue?vue&type=style', '.pager{}'),
      createStyle(playerStyleId, playerCss),
      createStyle('/workspace/apps/tauri/src/App.vue?vue&type=style', '.desktop{}'),
      createStyle('/host/style.css', '.host{}'),
    )

    const detach = attachGeneratedShadowStyles(environment.root)

    expect(environment.styles.map((style) => style.textContent)).toEqual([
      '.app{display:grid}',
      '.pager{}',
      playerCss,
    ])
    expect(environment.styles[2]?.dataset.amDevelopmentStyle).toBe(
      playerStyleId.replaceAll('\\', '/'),
    )
    expect(environment.observe).toHaveBeenCalledWith(environment.head, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    detach()
    expect(environment.styles).toHaveLength(0)
    expect(environment.disconnect).toHaveBeenCalledOnce()
    expect(environment.state.root).toBeUndefined()
  })

  it('updates and replaces lazy component styles without retaining removed HMR rules', () => {
    const environment = createStyleEnvironment()
    const detach = attachGeneratedShadowStyles(environment.root)
    const id =
      '/workspace/packages/theme-default/src/components/player/PlayerBar.vue?vue&type=style'
    const source = createStyle(id, '.player{display:grid}')
    environment.sources.push(source)
    environment.notify()
    const mirror = environment.styles[0]
    expect(mirror?.textContent).toBe(source.textContent)

    source.textContent = '.player{display:flex}'
    environment.notify()
    expect(environment.styles).toHaveLength(1)
    expect(mirror?.textContent).toBe(source.textContent)

    environment.sources.splice(0, 1, createStyle(id, '.player{display:contents}'))
    environment.notify()
    expect(environment.styles.map((style) => style.textContent)).toEqual([
      '.player{display:contents}',
    ])

    environment.sources.splice(0)
    environment.notify()
    expect(environment.styles).toHaveLength(0)
    detach()
  })

  it('replays production CSS queued before mount and preserves it for remount', () => {
    const playerCss = '.player[data-v-player]{display:grid}'
    const environment = createStyleEnvironment([playerCss])
    const detach = attachGeneratedShadowStyles(environment.root)
    expect(environment.state.root).toBe(environment.root)
    expect(environment.styles[0]?.textContent).toBe(playerCss)
    expect(environment.styles[0]?.dataset.amGeneratedStyle).toBe('')

    detach()
    expect(environment.state.cssTexts).toEqual([playerCss])
    environment.styles.splice(0)
    const detachRemounted = attachGeneratedShadowStyles(environment.root)
    expect(environment.styles.map((style) => style.textContent)).toEqual([playerCss])
    detachRemounted()
  })
})
