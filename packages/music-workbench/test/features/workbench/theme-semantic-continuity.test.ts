import type { Track } from '@any-music/core'
import { createThemeResources } from '@any-music/plugin-ui-vue/trusted'
import { definition as classic } from '@any-music/theme-default/vue'
import { definition as studio } from '@any-music/theme-studio/vue'
import { UI_CONTRIBUTIONS, provideConfirmationDialog } from '@any-music/ui'
import { createEditingSession, provideEditingSession } from '@any-music/ui/library'
import { getPresentationContinuity } from '@any-music/ui/theme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'

import { createThemeFeatures } from '../../fixtures/theme-features'
import { createSemanticThemeRenderer } from '../../helpers/semantic-theme-renderer'

const lazyRenderer = vi.hoisted(() => ({
  wait: undefined as Promise<void> | undefined,
  release: undefined as (() => void) | undefined,
}))

// The canary stays private and default-closed in production. This test-only injected value
// exercises the actual candidate through the themes' public complete definitions.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return {
    ...vue,
    Transition: passthrough,
    TransitionGroup: passthrough,
    Teleport: passthrough,
    defineAsyncComponent: (source: Parameters<typeof vue.defineAsyncComponent>[0]) =>
      typeof source === 'function' && source.toString().includes('VirtualQueueTrackGrid')
        ? vue.defineAsyncComponent(async () => {
            await lazyRenderer.wait
            return source()
          })
        : vue.defineAsyncComponent(source),
    inject: (...args: Parameters<typeof vue.inject>) =>
      typeof args[0] === 'symbol' && args[0].description === 'classic-virtual-favorites-canary'
        ? true
        : vue.inject(...args),
  }
})
const cleanups: (() => void)[] = []
const restorationAborts: AbortController[] = []
afterEach(async () => {
  // Cancel pending semantic restores before removing the mock HTMLElement globals.
  restorationAborts.splice(0).forEach((controller) => controller.abort())
  // A timed-out lazy-loading test must not block later tests in this file.
  lazyRenderer.release?.()
  lazyRenderer.release = undefined
  lazyRenderer.wait = undefined
  try {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    await settle()
  } finally {
    vi.unstubAllGlobals()
  }
})
async function settle() {
  await nextTick()
  await vi.dynamicImportSettled()
  await nextTick()
}

function setup(
  skin: 'default' | 'minimal',
  initial: 'classic' | 'studio' = 'classic',
  platforms = false,
) {
  const theme = shallowRef<'classic' | 'studio'>(initial)
  const env = createSemanticThemeRenderer(() => theme.value)
  for (const name of ['Element', 'HTMLElement', 'HTMLInputElement', 'Document', 'ShadowRoot'])
    vi.stubGlobal(name, env.Element)
  vi.stubGlobal('document', env.document)
  vi.stubGlobal('window', env.view)
  const tracks: Track[] = Array.from({ length: 1_000 }, (_, index) => ({
    id: `track:${index}`,
    title: `Song ${index}`,
    artists: [],
    source: {
      pluginId: platforms ? `source:${index}` : 'source',
      resourceId: String(index),
      mediaKind: 'audio',
    },
  }))
  const features = createThemeFeatures(vi.fn())
  const actions = Object.fromEntries(
    Object.keys(features.favorites.actions).map((name) => [name, vi.fn()]),
  ) as unknown as typeof features.favorites.actions
  const feature = {
    ...features.favorites,
    actions,
    state: {
      ...features.favorites.state,
      tracks,
      itemStyle: skin,
      totalCount: tracks.length,
      platformNames: new Map([['source', 'Source']]),
      arrangementMode: platforms ? ('platform' as const) : ('flat' as const),
      platformOrder: platforms ? tracks.map((track) => track.source.pluginId) : ['source'],
      platformTrackCounts: platforms
        ? new Map(tracks.map((track) => [track.source.pluginId, 1]))
        : new Map([['source', tracks.length]]),
    },
  }
  const editing = createEditingSession()
  const app = env.renderer.createApp(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        provideConfirmationDialog()
        provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
        return () =>
          h(
            'main',
            {
              key: theme.value,
              class: theme.value === 'classic' ? 'music-app-shell__content' : 'studio-content',
              'data-am-scroll-key': 'workspace',
            },
            [h((theme.value === 'classic' ? classic : studio).views.favorites!, { feature })],
          )
      },
    }),
  )
  // Teleport is a test passthrough: native Teleport's array children produce this mock-only
  // slot warning. Preserve every other Vue diagnostic as a test failure.
  app.config.warnHandler = (message) => {
    if (!message.startsWith('Non-function value encountered for default slot'))
      throw new Error(message)
  }
  app.mount(env.root)
  cleanups.push(() => {
    app.unmount()
    editing.dispose()
  })
  const region = () =>
    env.root.querySelectorAll(
      `[data-am-continuity-key="favorites:${platforms ? 'platforms' : 'tracks'}"]`,
    )[0]! as unknown as HTMLElement
  const scroll = () => env.root.children[0]! as unknown as HTMLElement
  const adapter = () => getPresentationContinuity(region())!
  const resources = createThemeResources(() => env.root as unknown as HTMLElement)
  const restoration = new AbortController()
  restorationAborts.push(restoration)
  return {
    ...env,
    theme,
    region,
    adapter,
    scroll,
    capture: () => resources.capture(restoration.signal),
    signal: restoration.signal,
    actions,
  }
}

describe('C00 cross-theme semantic handoff through real compiled consumers', () => {
  it('waits for the first delayed lazy Classic renderer before restoring the offscreen occurrence', async () => {
    let ready!: () => void
    lazyRenderer.wait = new Promise<void>((resolve) => {
      ready = resolve
    })
    lazyRenderer.release = ready
    const test = setup('default', 'studio')
    await settle()
    test.scroll().scrollTop = 54_093
    const play = test
      .region()
      .querySelectorAll<HTMLElement>('[data-am-focus-key="track:track:900:play"]')[0]!
    play.focus()
    const restore = test.capture()
    test.theme.value = 'classic'
    await nextTick()
    expect(test.region()).toBeDefined() // The parent bridge exists before its lazy child.
    const pending = restore()
    let finished = false
    const markFinished = () => {
      finished = true
    }
    void Promise.resolve(pending).then(markFinished, markFinished)
    await nextTick()
    expect(finished).toBe(false)
    expect(test.region().querySelectorAll('[data-am-continuity-item]')).toHaveLength(0)
    ready()
    await pending
    lazyRenderer.wait = undefined
    lazyRenderer.release = undefined
    expect(test.adapter().capture()!.anchor).toEqual({ key: 'track:900', offset: 13 })
    expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
      'track:track:900:play',
    )
  })
  it('preserves a distant platform overview occurrence through Studio and back without replaying actions', async () => {
    const test = setup('default', 'classic', true)
    await settle()
    const snapshot = {
      anchor: { key: 'source:900', offset: 13 },
      focus: { itemKey: 'source:900', controlKey: 'platform:source:900:open' },
    }
    expect(await test.adapter().restore(snapshot, test.signal)).toBe(true)
    const restoreStudio = test.capture()
    test.theme.value = 'studio'
    await settle()
    await restoreStudio()
    expect(test.adapter().capture()!.anchor).toEqual(snapshot.anchor)
    expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
      snapshot.focus.controlKey,
    )
    const restoreClassic = test.capture()
    test.theme.value = 'classic'
    await nextTick()
    await restoreClassic()
    expect(test.adapter().capture()!.anchor).toEqual(snapshot.anchor)
    expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
      snapshot.focus.controlKey,
    )
    expect(test.region().querySelectorAll('[data-am-continuity-item]').length).toBeLessThan(32)
    for (const action of Object.values(test.actions)) expect(action).not.toHaveBeenCalled()
  })
  it.each([0, 999])(
    'restores platform boundary %i with an available semantic focus counterpart',
    async (index) => {
      const test = setup('default', 'classic', true)
      await settle()
      const key = `source:${index}`
      expect(
        await test.adapter().restore(
          {
            anchor: { key, offset: 13 },
            focus: { itemKey: key, controlKey: `platform:${key}:reorder` },
          },
          test.signal,
        ),
      ).toBe(true)
      const restoreStudio = test.capture()
      test.theme.value = 'studio'
      await settle()
      await restoreStudio()
      const current = test.document.activeElement as HTMLElement
      expect(current.hasAttribute('disabled')).toBe(false)
      expect(current.dataset.amFocusKey).toBe(`platform:${key}:${index === 0 ? 'open' : 'reorder'}`)
      const restoreClassic = test.capture()
      test.theme.value = 'classic'
      await nextTick()
      await restoreClassic()
      expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
        `platform:${key}:${index === 0 ? 'open' : 'reorder'}`,
      )
    },
  )
  it.each(['default', 'minimal'] as const)(
    'restores distant %s occurrence and offset grid → Studio → grid before focus',
    async (skin) => {
      const test = setup(skin)
      await settle()
      expect(test.region()).toBeDefined()
      expect(
        await test.adapter().restore(
          {
            anchor: { key: 'track:900', offset: 13 },
            focus: { itemKey: 'track:900', controlKey: 'track:track:900:play' },
          },
          test.signal,
        ),
      ).toBe(true)
      await settle()
      const before = test.adapter().capture()!
      expect(before.anchor).toEqual({ key: 'track:900', offset: 13 })
      const restoreStudio = test.capture()
      const oldPixelOffset = test.scroll().scrollTop
      test.theme.value = 'studio'
      await settle()
      await restoreStudio()
      expect(test.adapter().capture()!.anchor).toEqual(before.anchor)
      expect(test.scroll().scrollTop).toBe(54_093)
      expect(test.scroll().scrollTop).not.toBe(oldPixelOffset)
      expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
        'track:track:900:play',
      )
      const restoreClassic = test.capture()
      test.theme.value = 'classic'
      await settle()
      expect(test.region().querySelectorAll('[data-am-continuity-item="track:900"]')).toHaveLength(
        0,
      )
      await restoreClassic()
      expect(test.adapter().capture()!.anchor).toEqual(before.anchor)
      expect((test.document.activeElement as HTMLElement).dataset.amFocusKey).toBe(
        'track:track:900:play',
      )
      expect(test.region().querySelectorAll('[data-am-continuity-item]').length).toBeLessThan(32)
      for (const action of Object.values(test.actions)) expect(action).not.toHaveBeenCalled()
    },
  )
})
