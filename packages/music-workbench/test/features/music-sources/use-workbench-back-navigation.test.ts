import { provideBackNavigation } from '@any-music/ui'
import type { BackNavigation, ProductViewId } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { createRenderer, defineComponent, h, shallowRef } from 'vue'

import { useWorkbenchBackNavigation } from '../../../src/features/music-sources/use-workbench-back-navigation'

// A comment-only Vue host tests provide/inject and synchronous navigation without product UI.
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

function setup() {
  const current = shallowRef<ProductViewId>('catalog')
  const available = shallowRef<readonly ProductViewId[]>([
    'catalog',
    'queue',
    'favorites',
    'plugins',
  ])
  let navigation!: BackNavigation
  const consumer = defineComponent({
    setup() {
      useWorkbenchBackNavigation({ current, available, select: (id) => (current.value = id) })
      return () => null
    },
  })
  const app = renderer.createApp({
    setup() {
      navigation = provideBackNavigation()
      return () => h(consumer)
    },
  })
  app.mount({})
  return { current, available, navigation, stop: () => app.unmount() }
}

describe('workbench destination history', () => {
  it('returns from favorites to queue and consumes previous destinations without recording Back again', () => {
    const view = setup()
    view.current.value = 'queue'
    view.current.value = 'favorites'
    expect(view.navigation.back()).toBe(true)
    expect(view.current.value).toBe('queue')
    view.navigation.back()
    expect(view.current.value).toBe('catalog')
    expect(view.navigation.back()).toBe(false)
    view.stop()
  })

  it('ignores repeated selection and skips destinations withdrawn by settings or plugins', () => {
    const view = setup()
    view.current.value = 'queue'
    view.current.value = 'queue'
    view.current.value = 'plugins'
    view.current.value = 'favorites'
    view.available.value = ['catalog', 'favorites']
    view.navigation.back()
    expect(view.current.value).toBe('catalog')
    expect(view.navigation.back()).toBe(false)
    view.stop()
  })

  it('branches after returning and keeps a bounded history in a long session', () => {
    const view = setup()
    view.current.value = 'queue'
    view.current.value = 'favorites'
    view.navigation.back()
    view.current.value = 'plugins'
    view.navigation.back()
    expect(view.current.value).toBe('queue')
    for (let index = 0; index < 150; index++) {
      view.current.value = index % 2 ? 'queue' : 'favorites'
    }
    let count = 0
    while (view.navigation.back()) count++
    expect(count).toBe(64)
    view.stop()
  })
})
