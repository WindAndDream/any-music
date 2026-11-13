import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import { useCollectionNavigation } from '../../src/composables/use-collection-navigation'
import {
  createEditingSession,
  type EditingSession,
} from '../../src/composables/use-editing-session'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'

function setupNavigation(
  focusEntry?: (id: string, signal: AbortSignal) => Promise<boolean>,
  continuity: Pick<
    Parameters<typeof useCollectionNavigation>[0],
    'captureOverview' | 'restoreOverview'
  > = {},
  editing?: EditingSession,
) {
  const enabled = shallowRef(true)
  const ids = shallowRef<readonly string[]>(['a', 'b'])
  const container = Object.assign(new EventTarget(), { scrollTop: 480 })
  let navigation!: ReturnType<typeof useCollectionNavigation>
  const mounted = mountCatalogComponent(
    defineComponent({
      setup() {
        navigation = useCollectionNavigation({
          editing,
          enabled,
          entryIds: ids,
          scrollContainer: container as HTMLElement,
          focusEntry,
          ...continuity,
        })
        return () => h('div')
      },
    }),
    {},
  )
  const focus = vi.fn()
  const view = (key: string, entries: readonly string[] = ['a', 'b']) =>
    ({
      getAttribute: () => key,
      querySelector: () => ({ focus }),
      querySelectorAll: () => entries.map((id) => ({ dataset: { collectionEntry: id }, focus })),
    }) as unknown as Element
  return { ...mounted, navigation, enabled, ids, container, view, focus }
}

describe('useCollectionNavigation', () => {
  it.each(['native', 'semantic'] as const)(
    'retains the originating %s overview through presentation replacement',
    async (mode) => {
      const editing = createEditingSession()
      const snapshot = {
        anchor: { key: 'b', offset: 37 },
        focus: { itemKey: 'b', controlKey: 'platform:b:open' },
      }
      const captureOverview = vi.fn(() => snapshot)
      const restoreOverview = vi.fn(async () => true)
      const continuity = mode === 'semantic' ? { captureOverview, restoreOverview } : {}
      const first = setupNavigation(undefined, continuity, editing)
      first.navigation.open('b')
      first.navigation.finishTransition(first.view('detail:b'))
      first.unmount()
      const second = setupNavigation(undefined, continuity, editing)
      const otherFocus = vi.fn(),
        originFocus = vi.fn()
      try {
        expect(second.navigation.activeId.value).toBe('b')
        second.container.scrollTop = 920
        second.navigation.back()
        second.navigation.finishTransition({
          getAttribute: () => 'overview',
          querySelector: () => null,
          querySelectorAll: () => [
            { dataset: { collectionEntry: 'a' }, focus: otherFocus },
            { dataset: { collectionEntry: 'b' }, focus: originFocus },
          ],
        } as unknown as Element)
        expect(second.container.scrollTop).toBe(480)
        expect(otherFocus).not.toHaveBeenCalled()
        if (mode === 'semantic') {
          expect(captureOverview).toHaveBeenCalledExactlyOnceWith('b')
          expect(restoreOverview).toHaveBeenCalledExactlyOnceWith(snapshot, expect.any(AbortSignal))
          expect(originFocus).not.toHaveBeenCalled()
        } else expect(originFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
        await Promise.resolve()
      } finally {
        second.unmount()
        editing.dispose()
      }
    },
  )
  it('restores overview scroll and focus only when the intended view finishes entering', () => {
    const test = setupNavigation()
    test.navigation.open('a')
    expect(test.navigation.activeId.value).toBe('a')
    expect(test.navigation.direction.value).toBe('forward')
    test.navigation.finishTransition(test.view('overview'))
    expect(test.container.scrollTop).toBe(480)
    expect(test.focus).not.toHaveBeenCalled()
    test.navigation.prepareTransition(test.view('detail:a'))
    expect(test.container.scrollTop).toBe(0)
    expect(test.focus).not.toHaveBeenCalled()
    test.navigation.finishTransition(test.view('detail:a'))
    expect(test.container.scrollTop).toBe(0)
    expect(test.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    test.container.scrollTop = 920
    test.navigation.back()
    expect(test.navigation.direction.value).toBe('back')
    test.navigation.finishTransition(test.view('overview'))
    expect(test.container.scrollTop).toBe(480)
    expect(test.focus).toHaveBeenCalledTimes(2)
    test.unmount()
  })
  it('rejects missing entries, returns after deletion, and resets when disabled', async () => {
    const test = setupNavigation()
    test.navigation.open('missing')
    expect(test.navigation.activeId.value).toBeUndefined()
    test.navigation.open('a')
    test.ids.value = ['b']
    await nextTick()
    expect(test.navigation.activeId.value).toBeUndefined()
    test.navigation.finishTransition(test.view('overview', ['b']))
    expect(test.focus).toHaveBeenCalledTimes(1)
    test.navigation.open('b')
    test.enabled.value = false
    await nextTick()
    expect(test.navigation.activeId.value).toBeUndefined()
    test.navigation.finishTransition(test.view('overview'))
    expect(test.focus).toHaveBeenCalledTimes(1)
    test.navigation.open('b')
    expect(test.navigation.activeId.value).toBeUndefined()
    test.unmount()
  })
  it('preserves modal focus and uses the empty-state focus target when an entry disappears', async () => {
    const test = setupNavigation()
    test.navigation.open('a')
    test.navigation.finishTransition(test.view('detail:a'), { restoreFocus: false })
    expect(test.focus).not.toHaveBeenCalled()
    test.ids.value = []
    await nextTick()
    test.navigation.finishTransition(test.view('overview', []))
    expect(test.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    test.unmount()
  })
  it('does not restore abandoned focus after disposal and supports arbitrary stable IDs', async () => {
    const test = setupNavigation()
    const id = 'overview"/特殊名称'
    test.ids.value = [id]
    await nextTick()
    test.navigation.open(id)
    expect(test.navigation.viewKey.value).toBe(`detail:${id}`)
    test.navigation.finishTransition(test.view(`detail:${id}`))
    test.navigation.back()
    test.unmount()
    test.navigation.finishTransition(test.view('overview', [id]))
    expect(test.focus).toHaveBeenCalledTimes(1)
    expect(test.container.scrollTop).toBe(0)
  })

  it('awaits virtual entry mounting instead of focusing an unrelated mounted fallback', async () => {
    let resolve!: (value: boolean) => void
    const focusEntry = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done
        }),
    )
    const test = setupNavigation(focusEntry)
    try {
      test.navigation.open('b')
      test.navigation.finishTransition(test.view('detail:b'))
      test.focus.mockClear()
      test.navigation.back()
      test.navigation.finishTransition(test.view('overview', ['a']))
      expect(focusEntry).toHaveBeenCalledExactlyOnceWith('b', expect.any(AbortSignal))
      expect(test.container.scrollTop).toBe(480)
      expect(test.focus).not.toHaveBeenCalled()
      resolve(true)
      await Promise.resolve()
      expect(test.focus).not.toHaveBeenCalled()
    } finally {
      test.unmount()
    }
  })

  it.each(['navigation', 'disabled', 'replacement', 'input', 'dispose'] as const)(
    'aborts the pending virtual return and late fallback on %s',
    async (interruption) => {
      let resolve!: (value: boolean) => void
      let signal!: AbortSignal
      const test = setupNavigation((_id, value) => {
        signal = value
        return new Promise<boolean>((done) => {
          resolve = done
        })
      })
      try {
        test.navigation.open('b')
        test.navigation.finishTransition(test.view('detail:b'))
        test.focus.mockClear()
        test.navigation.back()
        test.navigation.finishTransition(test.view('overview', ['a']))
        if (interruption === 'navigation') test.navigation.open('a')
        else if (interruption === 'disabled') test.enabled.value = false
        else if (interruption === 'replacement') test.ids.value = ['a']
        else if (interruption === 'input') test.container.dispatchEvent(new Event('wheel'))
        else test.unmount()
        await nextTick()
        expect(signal.aborted).toBe(true)
        resolve(false)
        await Promise.resolve()
        expect(test.focus).not.toHaveBeenCalled()
      } finally {
        if (interruption !== 'dispose') test.unmount()
      }
    },
  )

  it('keeps focus after unavailable virtual restoration and preserves modal focus', async () => {
    const focusEntry = vi.fn(async () => false)
    const test = setupNavigation(focusEntry)
    try {
      test.navigation.open('a')
      test.navigation.finishTransition(test.view('detail:a'), { restoreFocus: false })
      test.navigation.back()
      test.navigation.finishTransition(test.view('overview'))
      await Promise.resolve()
      expect(test.focus).not.toHaveBeenCalled()
      test.navigation.open('b')
      test.navigation.back()
      test.navigation.finishTransition(test.view('overview'), { restoreFocus: false })
      expect(focusEntry).toHaveBeenCalledTimes(1)
      expect(test.focus).not.toHaveBeenCalled()
    } finally {
      test.unmount()
    }
  })

  it.each([true, false])(
    'restores the saved semantic overview while respecting focus permission=%s',
    async (restoreFocus) => {
      const snapshot = {
        anchor: { key: 'b', offset: 37 },
        focus: { itemKey: 'b', controlKey: 'platform:b:open' },
      }
      const captureOverview = vi.fn(() => snapshot)
      const restoreOverview = vi.fn(async () => true)
      const focusEntry = vi.fn(async () => true)
      const test = setupNavigation(focusEntry, { captureOverview, restoreOverview })
      try {
        test.navigation.open('b')
        expect(captureOverview).toHaveBeenCalledExactlyOnceWith('b')
        test.navigation.finishTransition(test.view('detail:b'), { restoreFocus: false })
        test.navigation.back()
        test.navigation.finishTransition(test.view('overview', ['a']), { restoreFocus })
        expect(restoreOverview).toHaveBeenCalledExactlyOnceWith(
          restoreFocus ? snapshot : { anchor: snapshot.anchor },
          expect.any(AbortSignal),
        )
        expect(focusEntry).not.toHaveBeenCalled()
        await Promise.resolve()
        expect(test.focus).not.toHaveBeenCalled()
      } finally {
        test.unmount()
      }
    },
  )
})
