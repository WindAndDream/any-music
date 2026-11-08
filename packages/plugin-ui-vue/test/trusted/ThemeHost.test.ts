import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import type { ThemeResources } from '../../src/trusted/theme-contracts'
import { createThemeController } from '../../src/trusted/theme-controller'
import ThemeHost from '../../src/trusted/ThemeHost.vue'
import {
  CatalogTestElement,
  mountCatalogComponent,
  findCatalogElement,
  dispatchCatalogEvent,
} from '../helpers/test-renderer'
import { rootComposition, rootTheme, rootProps } from './root-theme-fixture'

afterEach(() => {
  delete (CatalogTestElement.prototype as unknown as { attachShadow?: unknown }).attachShadow
  vi.unstubAllGlobals()
})

function recoveryFixture(mode: 'overlay' | 'embedded') {
  const shadows: CatalogTestElement[] = []
  Object.assign(CatalogTestElement.prototype, {
    attachShadow() {
      const root = new CatalogTestElement('shadow-root')
      shadows.push(root)
      return root
    },
  })
  const needsRecovery = shallowRef(false)
  const features = {
    shell: { state: { resolvedTheme: 'light', presentation: mode } },
    catalog: { actions: { submit: vi.fn() } },
  } as unknown as UiThemeFeatureMap
  const controller = createThemeController({
    composition: rootComposition(),
    form: 'desktop',
    resources: {
      prepare: () => ({ activate() {}, deactivate() {}, dispose() {} }),
      capture: () => () => {},
      afterRender: (callback) => void nextTick(callback),
    },
  })
  const Parent = defineComponent({
    setup: () => () =>
      h(
        ThemeHost,
        {
          snapshot: controller.current.value,
          features,
          form: 'desktop',
          needsRecovery: needsRecovery.value,
        },
        { protected: () => null, recovery: () => h('button', 'Recover') },
      ),
  })
  const mounted = mountCatalogComponent(Parent, {})
  return {
    ...mounted,
    shadows,
    needsRecovery,
    controller,
    dispose: () => {
      controller.dispose()
      mounted.unmount()
    },
  }
}

it.each(['overlay', 'embedded'] as const)(
  'keeps recovery in the %s host layout without replacing its Shadow container',
  async (mode) => {
    const view = recoveryFixture(mode)
    try {
      await nextTick()
      await view.controller.select('default')
      const host = findCatalogElement(view.root, (node) => 'data-am-theme-host' in node.props)
      const container = host.children.find((node) => node.tag === 'div')!
      view.needsRecovery.value = true
      await nextTick()
      expect(container.style.display).toBe('none')
      expect(container.props.inert).toBe(true)
      expect(view.shadows).toHaveLength(1)
      const recovery = findCatalogElement(
        view.root,
        (node) => node.props['data-am-host-surface'] === 'theme-recovery',
      )
      expect(recovery.props.style).toMatchObject({
        position: mode === 'overlay' ? 'fixed' : 'relative',
        inlineSize: '100%',
        blockSize: '100%',
        overflow: 'auto',
        pointerEvents: 'auto',
      })
      expect((recovery.props.style as Record<string, unknown>).inset).toBe(
        mode === 'overlay' ? '0' : undefined,
      )
      view.needsRecovery.value = false
      await nextTick()
      await nextTick()
      await nextTick()
      expect(host.children.find((node) => node.tag === 'div')).toBe(container)
      expect(container.style.display).not.toBe('none')
      expect(view.shadows).toHaveLength(1)
      expect(
        findCatalogElement(view.shadows[0]!, (node) => 'data-am-focus-fallback' in node.props)
          .isFocused,
      ).toBe(true)
    } finally {
      view.dispose()
    }
  },
)

it.each(['visible', 'hidden', 'inert'] as const)(
  'preserves only a visible presentation focus after recovery (%s)',
  async (state) => {
    const view = recoveryFixture('overlay')
    vi.stubGlobal('HTMLElement', CatalogTestElement)
    try {
      await nextTick()
      await view.controller.select('default')
      view.needsRecovery.value = true
      await nextTick()
      view.needsRecovery.value = false
      await nextTick()
      const root = findCatalogElement(
        view.shadows[0]!,
        (node) => 'data-am-focus-fallback' in node.props,
      )
      const control = findCatalogElement(root, (node) => node.tag === 'button')
      Object.assign(root, { contains: (element: unknown) => element === control })
      Object.assign(control, {
        closest: () => (state === 'inert' ? root : null),
        getClientRects: () => [{}],
        ownerDocument: {
          defaultView: {
            getComputedStyle: () => ({ visibility: state === 'hidden' ? 'hidden' : 'visible' }),
          },
        },
      })
      Object.assign(view.shadows[0]!, { activeElement: control })
      await nextTick()
      await nextTick()
      expect(root.isFocused).toBe(state !== 'visible')
    } finally {
      view.dispose()
    }
  },
)

it('mounts one complete root in a stable style surface and keeps protected/recovery content outside it', async () => {
  const shadows: CatalogTestElement[] = []
  Object.assign(CatalogTestElement.prototype, {
    attachShadow() {
      const root = new CatalogTestElement('shadow-root')
      shadows.push(root)
      return root
    },
  })
  const submit = vi.fn(),
    setup = vi.fn(),
    disposed = vi.fn()
  const features = {
    shell: { state: { resolvedTheme: 'light' } },
    catalog: { actions: { submit } },
  } as unknown as UiThemeFeatureMap
  let broken = false,
    brokenFallback = false
  const composition = rootComposition(async (id) => {
    const theme = rootTheme(id)
    return id === 'studio' && broken
      ? {
          ...theme,
          definition: {
            ...theme.definition,
            Root: defineComponent({
              props: rootProps,
              setup() {
                throw new Error('root setup failed')
              },
            }),
          },
        }
      : theme
  })
  const fallback = composition.fallback.loaded
  const original = fallback.definition.Root
  const fallbackTheme = {
    ...fallback,
    definition: {
      ...fallback.definition,
      Root: defineComponent({
        props: rootProps,
        setup() {
          return () => {
            if (brokenFallback) throw new Error('fallback render failed')
            return h(original, { features, views: fallback.definition.views, form: 'desktop' })
          }
        },
      }),
    },
  }
  const resources: ThemeResources = {
    prepare: () => ({ activate() {}, deactivate() {}, dispose: disposed }),
    capture: () => () => {},
    afterRender: (callback) => {
      void nextTick(callback)
    },
  }
  const controller = createThemeController({
    composition: { ...composition, fallback: { ...composition.fallback, loaded: fallbackTheme } },
    form: 'desktop',
    resources,
  })
  const Parent = defineComponent({
    setup() {
      setup()
      return () =>
        h(
          ThemeHost,
          {
            snapshot: controller.current.value,
            features,
            form: 'desktop',
            needsRecovery: controller.needsRecovery.value,
            onFailure: controller.reportRenderFailure,
          },
          {
            protected: () => h('aside', 'Native consent'),
            recovery: () => h('button', { onClick: () => controller.select('default') }, 'Recover'),
          },
        )
    },
  })
  const mounted = mountCatalogComponent(Parent, {})
  await nextTick()
  try {
    expect(await controller.select('default')).toBe(true)
    expect(await controller.select('studio')).toBe(true)
    expect(shadows).toHaveLength(1)
    const shadow = shadows[0]!
    dispatchCatalogEvent(
      findCatalogElement(shadow, (node) => node.tag === 'button'),
      'onClick',
    )
    expect(submit).toHaveBeenCalledOnce()
    expect(
      findCatalogElement(shadow, (node) => node.props['data-am-theme-root'] !== undefined).props[
        'data-am-ui-theme'
      ],
    ).toBe('studio')
    expect(() => findCatalogElement(shadow, (node) => node.tag === 'aside')).toThrow()
    expect(findCatalogElement(mounted.root, (node) => node.tag === 'aside').textContent).toBe(
      'Native consent',
    )
    broken = true
    expect(await controller.select('studio')).toBe(false)
    expect(controller.current.value.theme.definition.id).toBe('default')
    expect(controller.needsRecovery.value).toBe(false)
    brokenFallback = true
    expect(await controller.select('studio')).toBe(false)
    await nextTick()
    expect(controller.needsRecovery.value).toBe(true)
    expect(shadow.textContent).not.toContain('Search')
    const recovery = findCatalogElement(
      mounted.root,
      (node) => node.props['data-am-host-surface'] === 'theme-recovery',
    )
    expect(recovery.textContent).toBe('Recover')
    broken = false
    brokenFallback = false
    dispatchCatalogEvent(
      findCatalogElement(recovery, (node) => node.tag === 'button'),
      'onClick',
    )
    await vi.waitFor(() => expect(controller.needsRecovery.value).toBe(false))
    expect(setup).toHaveBeenCalledOnce()
  } finally {
    controller.dispose()
    mounted.unmount()
  }
  expect(disposed).toHaveBeenCalled()
})
