import { assertUiThemeDefinition, assertUiThemeDescriptor } from '@any-music/ui/theme'
import type { UiThemeDescriptor, UiThemeForm, UiThemeOptionalView } from '@any-music/ui/theme'
import { shallowRef } from 'vue'

import type {
  ThemeApplicationComposition,
  LoadedRootTheme,
  ThemeResources,
  ThemeResource,
  ThemeSnapshot,
  ThemeAllocation,
} from './theme-contracts'
import { normalizeThemeSettings, THEME_ROOT_POINT } from './theme-directory'

/** One transaction engine for application-injected complete themes. */
export function createThemeController(options: {
  composition: ThemeApplicationComposition
  form: UiThemeForm
  resources: ThemeResources
  requiredOptionalViews?: () => readonly UiThemeOptionalView[]
  fallbackSettings?: () => unknown
  onFailure?(error: unknown): void
  prepareAllocation?(id: string): Promise<ThemeAllocation>
}) {
  const fallback = options.composition.fallback
  const current = shallowRef<ThemeSnapshot>({
    generation: 0,
    theme: fallback.loaded,
    settings: normalizeThemeSettings(options.fallbackSettings?.()),
  })
  const needsRecovery = shallowRef(false)
  let request = 0
  let revision = 0
  let disposed = false
  let failedRevision: number | undefined
  let rendering: number | undefined
  let currentRequest = 0
  let active: { resource: ThemeResource; release(): void } | undefined
  let restoration: AbortController | undefined
  const releases = new Set<() => void>()
  const waits = new Set<() => void>()
  const fresh = (token: number) => !disposed && request === token
  // Diagnostics cannot break release ordering or take authority over a newer transaction.
  const failure = (error: unknown) => {
    try {
      options.onFailure?.(error)
    } catch {
      /* Diagnostic callback only. */
    }
  }

  function validate(descriptor: UiThemeDescriptor, theme: LoadedRootTheme) {
    assertUiThemeDescriptor(descriptor, options.form)
    assertUiThemeDefinition(
      descriptor,
      theme.definition,
      options.form,
      options.requiredOptionalViews?.(),
    )
  }

  async function commit(
    descriptor: UiThemeDescriptor,
    theme: LoadedRootTheme,
    token: number,
    settings?: unknown,
  ) {
    validate(descriptor, theme)
    const allocation = await options.prepareAllocation?.(descriptor.id)
    if (!fresh(token)) return false
    validate(descriptor, theme)
    if (
      allocation &&
      (allocation.slots[THEME_ROOT_POINT]?.length !== 1 ||
        allocation.slots[THEME_ROOT_POINT]?.[0] !== `theme.${descriptor.id}/root`)
    )
      throw new Error('Incomplete theme allocation')
    const cleanup: (() => void)[] = []
    let released = false
    const release = () => {
      if (released) return
      released = true
      releases.delete(release)
      for (const dispose of cleanup.splice(0).toReversed()) {
        try {
          dispose()
        } catch (error) {
          failure(error)
        }
      }
    }
    releases.add(release)
    const previous = active
    let committed = false
    let committedRevision = 0
    try {
      const resource = options.resources.prepare(descriptor.id, theme.css)
      cleanup.push(() => resource.dispose())
      restoration?.abort()
      const restoreController = new AbortController()
      cleanup.push(() => restoreController.abort())
      restoration = restoreController
      const restore = options.resources.capture(restoreController.signal)
      theme.activate?.((dispose) => {
        if (released) dispose()
        else cleanup.push(dispose)
      })
      if (!fresh(token)) {
        release()
        return false
      }
      previous?.resource.deactivate()
      resource.activate()
      const generation = ++revision
      committedRevision = generation
      rendering = generation
      currentRequest = token
      active = { resource, release }
      needsRecovery.value = false
      committed = true
      current.value = { generation, theme, settings: normalizeThemeSettings(settings), allocation }
      // Resolve only after the root boundary had a chance to report setup/render/mount failure.
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          waits.delete(done)
          resolve()
        }
        waits.add(done)
        try {
          options.resources.afterRender(() => {
            previous?.release()
            if (
              !disposed &&
              current.value.generation === generation &&
              failedRevision !== generation
            ) {
              try {
                const restored = restore()
                if (restored) {
                  void restored.catch(failure).finally(done)
                  return
                }
              } catch (error) {
                failure(error)
              }
            }
            done()
          })
        } catch (error) {
          waits.delete(done)
          reject(error)
        }
      })
      if (rendering === generation) rendering = undefined
      if (!fresh(token)) return false
      if (failedRevision === generation) throw new Error('Theme root failed to render')
      return true
    } catch (error) {
      release()
      if (committed) {
        previous?.release()
        if (active?.release === release) active = undefined
        if (!disposed && current.value.generation === committedRevision) needsRecovery.value = true
      } else if (fresh(token)) previous?.resource.activate()
      throw error
    }
  }

  async function recover(token: number) {
    if (!fresh(token)) return
    try {
      await commit(fallback.descriptor, fallback.loaded, token, options.fallbackSettings?.())
    } catch (error) {
      if (fresh(token)) {
        failure(error)
        // A healthy current root may remain usable even if fallback preparation fails.
        if (!active || failedRevision === current.value.generation) needsRecovery.value = true
      }
    }
  }
  async function select(id: string, settings?: unknown): Promise<boolean> {
    if (disposed) return false
    restoration?.abort()
    const token = ++request
    try {
      const registration = options.composition.themes.find((entry) => entry.descriptor.id === id)
      if (!registration) throw new Error('Unknown build theme')
      assertUiThemeDescriptor(registration.descriptor, options.form)
      const theme = await registration.load()
      if (!fresh(token)) return false
      return await commit(registration.descriptor, theme, token, settings)
    } catch (error) {
      if (fresh(token)) {
        failure(error)
        await recover(token)
      }
      return false
    }
  }
  function reportRenderFailure(generation: number, error: unknown) {
    if (disposed || generation !== current.value.generation || failedRevision === generation) return
    failedRevision = generation
    restoration?.abort()
    failure(error)
    needsRecovery.value = true
    active?.release()
    active = undefined
    if (
      request === currentRequest &&
      rendering !== generation &&
      current.value.theme !== fallback.loaded
    )
      void recover(request)
  }
  return {
    current,
    needsRecovery,
    select,
    reportRenderFailure,
    dispose() {
      if (disposed) return
      disposed = true
      restoration?.abort()
      request++
      for (const release of releases) release()
      for (const done of waits) done()
    },
  }
}
