import type { HttpClient, MusicSourcePlugin } from '@any-music/core'
import { descriptor as classic } from '@any-music/theme-default'
import { definition as classicRoot } from '@any-music/theme-default/vue'
import { descriptor as studio } from '@any-music/theme-studio'
import { definition as studioRoot } from '@any-music/theme-studio/vue'
import { UI_THEME_SELECTION } from '@any-music/ui'
import type { UiThemeSelection } from '@any-music/ui'
import type { UiThemeDefinition } from '@any-music/ui/theme'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, inject } from 'vue'
import type { Component } from 'vue'

import MusicSourceWorkbench from '../../../src/components/music-sources/MusicSourceWorkbench.vue'
import * as libraryFactory from '../../../src/features/library/use-local-music-library'
import * as playerFactory from '../../../src/features/player/use-audio-player'
import { configureWorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import { createProductGenerationStorage } from '../../../src/storage/product-generation-store'
import { CatalogTestElement, renderer, findCatalogElement } from '../../helpers/test-renderer'
import { memory, options } from '../../storage/product-storage-fixtures'

// Node verifies feedback content and host lifetime; CSS transitions require a browser DOM.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: transition, TransitionGroup: transition }
})

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function verifyAccountCapability(hasAccountUi: boolean, blockStudio = false) {
  const shadows: CatalogTestElement[] = []
  const prototype = CatalogTestElement.prototype
  const additions = {
    attachShadow() {
      const root = new CatalogTestElement('shadow-root')
      Object.assign(root, {
        ownerDocument: {
          createElement: () => {
            const node = Object.assign(new CatalogTestElement('style'), {
              remove() {
                root.children = root.children.filter((child) => child !== node)
              },
            })
            // Style resources mutate DOMStringMap keys; this fake style owns that mutable map.
            Object.defineProperties(node, {
              textContent: { value: '', writable: true },
              dataset: { value: {}, writable: true },
            })
            return node
          },
        },
        append(node: CatalogTestElement) {
          root.children.push(node)
        },
        querySelectorAll() {
          return []
        },
        contains() {
          return false
        },
      })
      shadows.push(root)
      return root
    },
    load() {},
    pause() {},
    play() {
      return Promise.resolve()
    },
  }
  Object.assign(prototype, additions)
  cleanups.push(() => {
    for (const key of Object.keys(additions))
      delete (prototype as unknown as Record<string, unknown>)[key]
  })
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { origin: 'https://example.com' },
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  for (const key of ['HTMLElement', 'Element', 'Document', 'ShadowRoot'])
    vi.stubGlobal(key, CatalogTestElement)
  const data = memory()
  const storage = createProductGenerationStorage(data.raw, options)
  let accountCapability: boolean | undefined
  let networkCapability: boolean | undefined
  let externalCapability: boolean | undefined
  function observeCapabilities(definition: UiThemeDefinition): UiThemeDefinition {
    return {
      ...definition,
      Root: defineComponent({
        inheritAttrs: false,
        setup(_, { attrs, slots }) {
          accountCapability = Boolean(slots['account-settings'])
          networkCapability = Boolean(slots['network-settings'])
          externalCapability = Boolean(slots['external-source-settings'])
          return () => h(definition.Root as Component, attrs, slots)
        },
      }),
    }
  }
  const loadStudio = vi.fn(async () => ({
    definition: observeCapabilities(studioRoot),
    css: 'studio-resource',
  }))
  const fallback = {
    descriptor: classic,
    loaded: { definition: observeCapabilities(classicRoot), css: 'classic-resource' },
  }
  const source: MusicSourcePlugin = {
    descriptor: {
      id: 'test',
      name: 'offline',
      provenance: 'built-in',
      capabilities: { search: false, importUrl: false, session: false },
      importUrlScopes: [],
    },
    getSession: async () => ({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    validateImportUrl: () => undefined,
    checkAvailability: async () => ({ status: 'available', checkedAtMs: 1 }),
    search: () => {
      throw new Error('unexpected search')
    },
    importFromUrl: () => {
      throw new Error('unexpected import')
    },
    resolveMedia: async () => {
      throw new Error('unexpected media')
    },
  }
  configureWorkbenchRuntime({
    externalPlugins: 'none',
    storage,
    http: {} as HttpClient,
    builtInMusicSources: [source],
    configureProxy() {},
    openLogin() {},
    protectedStyles: 'host-resource',
    themes: {
      fallback,
      themes: [
        { descriptor: classic, load: async () => fallback.loaded },
        // Continuity cases admit a future Studio build; blocked cases retain production metadata.
        {
          descriptor: blockStudio ? studio : { ...studio, unavailableReason: undefined },
          load: loadStudio,
        },
      ],
    },
  })
  const factories = [
    vi.spyOn(playerFactory, 'useAudioPlayer'),
    vi.spyOn(libraryFactory, 'useLocalMusicLibrary'),
  ]
  const protectedSetup = vi.fn()
  let selection!: UiThemeSelection
  const Probe = defineComponent({
    setup() {
      protectedSetup()
      selection = inject(UI_THEME_SELECTION)!
      return () => h('aside', 'native authority')
    },
  })
  const app = renderer.createApp({
    render: () =>
      h(
        MusicSourceWorkbench,
        { presentation: 'embedded' },
        {
          'account-overlays': () => h(Probe),
          ...(hasAccountUi ? { 'account-settings': () => h('p', 'Runtime account controls') } : {}),
        },
      ),
  })
  const pinia = createPinia()
  app.use(pinia)
  const root = new CatalogTestElement('root')
  app.mount(root)
  cleanups.unshift(() => {
    app.unmount()
    disposePinia(pinia)
  })
  await vi.waitFor(() => expect(selection).toBeDefined())
  await vi.waitFor(() =>
    expect(
      shadows.some((surface) =>
        surface.children.some(
          (node) => node.tag === 'style' && node.textContent === 'classic-resource',
        ),
      ),
    ).toBe(true),
  )
  const surface = shadows.find((candidate) =>
    candidate.children.some(
      (node) => node.tag === 'style' && node.textContent === 'classic-resource',
    ),
  )!
  expect(loadStudio).not.toHaveBeenCalled()
  function expectAccountCapability() {
    expect(accountCapability).toBe(hasAccountUi)
    expect(networkCapability).toBe(true)
    expect(externalCapability).toBe(false)
  }
  expectAccountCapability()
  const saved = storage.read('ui-theme:v1')
  if (blockStudio) {
    selection.select('studio')
    await vi.waitFor(() => expect(surface.textContent).toContain(studio.unavailableReason))
    expect(loadStudio).not.toHaveBeenCalled()
    expect(selection.currentId()).toBe('default')
    expect(selection.error?.()).toBe('')
    expect(storage.read('ui-theme:v1')).toEqual(saved)
  } else {
    loadStudio.mockRejectedValueOnce(new Error('optional import failed'))
    selection.select('studio')
    await vi.waitFor(() => expect(selection.error?.()).toContain('界面主题不可用'))
    expect(selection.currentId()).toBe('default')
    expect(storage.read('ui-theme:v1')).toEqual(saved)
    selection.select('studio')
    await vi.waitFor(() =>
      expect(
        findCatalogElement(surface, (node) => node.props['data-am-ui-theme'] === 'studio'),
      ).toBeDefined(),
    )
    expectAccountCapability()
    expect(
      surface.children.filter((node) => node.tag === 'style').map((node) => node.textContent),
    ).toEqual(['studio-resource'])
    selection.select('default')
    await vi.waitFor(() =>
      expect(
        findCatalogElement(surface, (node) => node.props['data-am-ui-theme'] === 'default'),
      ).toBeDefined(),
    )
    expectAccountCapability()
    expect(
      surface.children.filter((node) => node.tag === 'style').map((node) => node.textContent),
    ).toEqual(['classic-resource'])
  }
  expect(protectedSetup).toHaveBeenCalledOnce()
  expect(root.children.filter((node) => node.tag === 'audio')).toHaveLength(1)
  factories.forEach((factory) => expect(factory).toHaveBeenCalledOnce())
}

it.each([false, true])(
  'uses one production host/controller/audio and retains the runtime account capability (account UI: %s)',
  (hasAccountUi) => verifyAccountCapability(hasAccountUi),
)
it.each([false, true])(
  'keeps developing Studio unloaded and shows its notice in the production host (account UI: %s)',
  (hasAccountUi) => verifyAccountCapability(hasAccountUi, true),
)
