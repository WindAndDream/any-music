import { BUILT_IN_UI_THEMES } from '@any-music/plugin-ui-vue/directory'
import type { LoadedRootTheme, ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import { descriptor as studioDescriptor } from '@any-music/theme-studio'
import { provideActionFeedback } from '@any-music/ui'
import { UI_THEME_REQUIRED_VIEWS } from '@any-music/ui/theme'
import type { UiThemeRootProps, UiThemeViews } from '@any-music/ui/theme'
import { afterEach, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, watch } from 'vue'
import type { PropType } from 'vue'

import type { WorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import { useWorkbenchRootTheme } from '../../../src/theme'

const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
})
const unmounts: (() => void)[] = []
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount())
  vi.unstubAllGlobals()
})

const Root = defineComponent({
  props: {
    features: { type: Object as PropType<UiThemeRootProps['features']>, required: true },
    views: { type: Object as PropType<UiThemeRootProps['views']>, required: true },
    form: { type: String as PropType<UiThemeRootProps['form']>, required: true },
  },
  render: () => h('main'),
})
const View = defineComponent({ render: () => h('section') })
function loaded(id: string): LoadedRootTheme {
  return {
    definition: {
      id,
      contractVersion: 1,
      Root,
      views: Object.fromEntries(
        UI_THEME_REQUIRED_VIEWS.map((key) => [key, View]),
      ) as unknown as UiThemeViews,
    },
    css: '',
  }
}
function mount(
  options: {
    load?: (id: string) => Promise<LoadedRootTheme>
    write?: () => void
    renderFailure?: boolean
    read?: () => unknown
    blockStudio?: boolean
  } = {},
) {
  vi.stubGlobal(
    'HTMLElement',
    class {
      readonly dataset = {}
    },
  )
  const styles = new Set<object>()
  const surface = {
    ownerDocument: {
      createElement: () => {
        const style = { dataset: {}, remove: () => styles.delete(style) }
        return style
      },
    },
    append: (style: object) => styles.add(style),
    getRootNode: () => ({}),
    querySelectorAll: () => [],
    contains: () => false,
  } as unknown as ShadowRoot
  const write = vi.fn(options.write ?? (() => {}))
  const runtime = {
    storage: { read: options.read ?? (() => undefined), write },
  } as unknown as WorkbenchRuntime
  const composition: ThemeApplicationComposition = {
    themes: BUILT_IN_UI_THEMES.map((descriptor) => ({
      descriptor: options.blockStudio && descriptor.id === 'studio' ? studioDescriptor : descriptor,
      load: () => options.load?.(descriptor.id) ?? Promise.resolve(loaded(descriptor.id)),
    })),
    fallback: { descriptor: BUILT_IN_UI_THEMES[0]!, loaded: loaded('default') },
  }
  let session!: ReturnType<typeof useWorkbenchRootTheme>
  let feedback!: ReturnType<typeof provideActionFeedback>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        feedback = provideActionFeedback()
        session = useWorkbenchRootTheme(runtime, () => surface, composition, {
          onUnavailable: feedback.showUnavailable,
        })
        if (options.renderFailure)
          watch(
            session.current,
            (snapshot) => {
              if (snapshot.theme.definition.id === 'studio')
                session.reportRenderFailure(snapshot.generation, new Error('render failed'))
            },
            { flush: 'sync' },
          )
        return () => h('div')
      },
    }),
  )
  app.mount({})
  const unmount = () => {
    if (unmounts.includes(unmount)) {
      unmounts.splice(unmounts.indexOf(unmount), 1)
      app.unmount()
    }
  }
  unmounts.push(unmount)
  return { session, write, styles, unmount, feedback }
}
it('rejects the developing theme before loading and shows its reason for every selection attempt', async () => {
  const load = vi.fn(async (id: string) => loaded(id))
  const value = mount({ blockStudio: true, load })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  load.mockClear()
  await value.session.select('studio')
  expect(value.session.current.value.theme.definition.id).toBe('default')
  expect(value.feedback.notice.value).toMatchObject({
    tone: 'info',
    message: studioDescriptor.unavailableReason,
  })
  const firstId = value.feedback.notice.value!.id
  await value.session.select('studio')
  expect(value.feedback.notice.value!.id).toBeGreaterThan(firstId)
  expect(load).not.toHaveBeenCalled()
  expect(value.write).toHaveBeenCalledOnce()
  expect(value.session.needsRecovery.value).toBe(false)
})
it('starts the default theme without loading a saved developing theme', async () => {
  const load = vi.fn(async (id: string) => loaded(id))
  const value = mount({
    blockStudio: true,
    load,
    read: () => ({ themeId: 'studio', settingsByTheme: {} }),
  })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  expect(load.mock.calls.map(([id]) => id)).toEqual(['default'])
  expect(value.session.current.value.theme.definition.id).toBe('default')
  expect(value.feedback.notice.value).toBeUndefined()
  expect(value.session.failure.value).toBe(false)
})
it('does not persist a root that fails its first render and preserves usable fallback without saving it', async () => {
  const value = mount({ renderFailure: true })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  await value.session.select('studio')
  expect(value.session.current.value.theme.definition.id).toBe('default')
  expect(value.session.needsRecovery.value).toBe(false)
  expect(value.write).toHaveBeenCalledOnce()
  expect(value.styles.size).toBe(1)
})
it('saves only the newest successful root, skips late imports, and releases everything on unmount', async () => {
  let resolve!: (theme: LoadedRootTheme) => void
  const value = mount({
    load: (id) =>
      id === 'studio'
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve(loaded(id)),
  })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  const old = value.session.select('studio')
  await value.session.select('default')
  resolve(loaded('studio'))
  await old
  expect(value.write).toHaveBeenCalledTimes(2)
  expect(value.session.current.value.theme.definition.id).toBe('default')
  const pending = value.session.select('studio')
  value.unmount()
  resolve(loaded('studio'))
  await pending
  expect(value.write).toHaveBeenCalledTimes(2)
  expect(value.styles.size).toBe(0)
})
it('keeps a committed complete root usable when saving its preference fails and can retry', async () => {
  let fail = false
  const value = mount({
    write() {
      if (fail) throw new Error('storage failed')
    },
  })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  fail = true
  await value.session.select('studio')
  expect(value.session.current.value.theme.definition.id).toBe('studio')
  expect(value.session.failure.value).toBe(true)
  expect(value.session.needsRecovery.value).toBe(false)
  fail = false
  await value.session.select('studio')
  expect(value.session.failure.value).toBe(false)
})
it('retains a startup read failure without overwriting unread preferences and can explicitly retry', async () => {
  const value = mount({
    read() {
      throw new Error('read failed')
    },
  })
  await vi.waitFor(() => expect(value.session.current.value.generation).toBe(1))
  expect(value.session.failure.value).toBe(true)
  expect(value.session.needsRecovery.value).toBe(false)
  expect(value.write).not.toHaveBeenCalled()
  await value.session.select('default')
  expect(value.session.failure.value).toBe(false)
  expect(value.write).toHaveBeenCalledOnce()
})
it('restores saved fallback settings when a requested theme fails without changing preferences', async () => {
  const value = mount({
    read: () => ({
      themeId: 'default',
      settingsByTheme: { default: { schemaVersion: 1, density: 'compact' } },
    }),
    load: async (id) => {
      if (id === 'studio') throw new Error('import failed')
      return loaded(id)
    },
  })
  await vi.waitFor(() => expect(value.write).toHaveBeenCalledOnce())
  await value.session.select('studio')
  expect(value.session.current.value.theme.definition.id).toBe('default')
  expect(value.session.current.value.settings.density).toBe('compact')
  expect(value.write).toHaveBeenCalledOnce()
})
