import {
  getCurrentInstance,
  hasInjectionContext,
  inject,
  onActivated,
  onDeactivated,
  provide,
  readonly,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

const BACK_LAYERS = { navigation: 0, content: 10, player: 20, panel: 30, drawer: 40, modal: 50 }
type BackLayer = keyof typeof BACK_LAYERS

/** Ephemeral UI navigation only. The runtime decides what an unhandled Back means. */
export function createBackNavigation(onChange?: () => void) {
  const revision = shallowRef(0)
  const handlers = new Map<symbol, { layer: BackLayer; handle: () => void }>()

  function invalidate(): void {
    revision.value++
    onChange?.()
  }

  function register(layer: BackLayer, handle: () => void): () => void {
    const id = Symbol()
    handlers.set(id, { layer, handle })
    invalidate()
    return () => {
      if (handlers.delete(id)) invalidate()
    }
  }

  function back(): boolean {
    let selected: { layer: BackLayer; handle: () => void } | undefined
    // Later activation wins within a layer; each Back consumes exactly one handler.
    for (const handler of handlers.values()) {
      if (!selected || BACK_LAYERS[handler.layer] >= BACK_LAYERS[selected.layer]) selected = handler
    }
    if (!selected) return false
    selected.handle()
    return true
  }

  return { revision: readonly(revision), register, back, invalidate }
}

export type BackNavigation = ReturnType<typeof createBackNavigation>
const rootKey: InjectionKey<BackNavigation> = Symbol('root-back-navigation')
const scopeKey: InjectionKey<BackNavigation> = Symbol('back-navigation-scope')

/** Hosts opt in explicitly; desktop and Userscript consumers keep their existing behavior. */
export function provideBackNavigation(): BackNavigation {
  const navigation = createBackNavigation()
  provide(rootKey, navigation)
  provide(scopeKey, navigation)
  return navigation
}

export function useBackNavigation(): BackNavigation | undefined {
  return hasInjectionContext() ? inject(scopeKey, undefined) : undefined
}

interface BackHandlerOptions {
  active: MaybeRefOrGetter<boolean>
  handle: () => void
  layer?: BackLayer
}

function registerBackHandler(navigation: BackNavigation | undefined, options: BackHandlerOptions) {
  if (!navigation) return
  const isActive = shallowRef(true)
  if (getCurrentInstance()) {
    onActivated(() => (isActive.value = true))
    onDeactivated(() => (isActive.value = false))
  }
  watch(
    () => isActive.value && toValue(options.active),
    (active, _, onCleanup) => {
      if (active) onCleanup(navigation.register(options.layer ?? 'content', options.handle))
    },
    { immediate: true, flush: 'sync' },
  )
}

export function useBackHandler(options: BackHandlerOptions): void {
  registerBackHandler(useBackNavigation(), options)
}

/** A modal first returns through its own pages. Separate overlays still compete at the root. */
export function useBackNavigationScope(options: BackHandlerOptions): void {
  const root = hasInjectionContext() ? inject(rootKey, undefined) : undefined
  if (!root) return
  const scope = createBackNavigation(root.invalidate)
  provide(scopeKey, scope)
  registerBackHandler(root, {
    ...options,
    handle: () => {
      if (!scope.back()) options.handle()
    },
  })
}
