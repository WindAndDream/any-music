import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import type { QueuePlatformGridGroup } from '../../../src/components/music-sources/queue-platform-grid-contracts'
import VirtualQueuePlatformGrid from '../../../src/components/music-sources/VirtualQueuePlatformGrid.vue'
import type { ClassicVirtualTrackGridAdapter } from '../../../src/composables/classic-virtual-favorites-canary'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  CatalogTestElement,
} from '../../helpers/test-renderer'
import { mountMeasuredThemeGrid } from '../../helpers/virtual-grid-renderer'

async function settle() {
  for (let flush = 0; flush < 6; flush++) {
    // eslint-disable-next-line no-await-in-loop -- Flush bounded render/measurement handoffs.
    await nextTick()
  }
}
afterEach(() => vi.unstubAllGlobals())

function setup(count: number, naturalHeight = 196) {
  const groups = shallowRef<readonly QueuePlatformGridGroup[]>(
    Array.from({ length: count }, (_group, index) => ({
      id: String(index),
      name: `平台 ${index}`,
      tracks: Array.from({ length: 4 }, (_, track) => ({
        id: `${index}:${track}`,
        title: `歌曲 ${index}:${track}`,
        artists: [],
        source: { pluginId: String(index), resourceId: String(track), mediaKind: 'audio' },
      })),
      totalCount: 8,
      isCustom: index % 2 === 0,
    })),
  )
  const displayMode = shallowRef<'standard' | 'compact' | 'comfortable'>('standard')
  const selectedIds = shallowRef<ReadonlySet<string>>(new Set())
  const selectable = shallowRef(true)
  const columns = shallowRef(3)
  const active = shallowRef(true)
  const open = vi.fn(),
    select = vi.fn(),
    shift = vi.fn(),
    dragStart = vi.fn(),
    releaseAdapter = vi.fn()
  let adapter: ClassicVirtualTrackGridAdapter | undefined
  const register = (value: ClassicVirtualTrackGridAdapter) => {
    adapter = value
    return () => {
      if (adapter === value) adapter = undefined
      releaseAdapter()
    }
  }
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const view = mountMeasuredThemeGrid(
    defineComponent({
      props: ['scroll'],
      setup: (props) => () =>
        active.value
          ? h(VirtualQueuePlatformGrid, {
              groups: groups.value,
              selectedIds: selectedIds.value,
              selectable: selectable.value,
              filtered: true,
              getReorderStyle: () => undefined,
              displayMode: displayMode.value,
              mobileColumns: 1,
              virtual: {
                scrollElement: props.scroll as HTMLElement,
                resetKey: 'overview',
                layoutGeneration: 'platforms',
                register,
              },
              onOpen: open,
              onSelect: select,
              onShift: shift,
              onDragStart: dragStart,
            })
          : h('section'),
    }),
    () => columns.value,
    naturalHeight,
  )
  return {
    ...view,
    groups,
    selectedIds,
    selectable,
    displayMode,
    columns,
    active,
    open,
    select,
    shift,
    dragStart,
    releaseAdapter,
    adapter: () => adapter!,
    cells: () => view.root.querySelectorAll('[data-queue-drop-kind="platform"]'),
  }
}

describe('C00 real platform overview candidate (injected layout; admission remains closed)', () => {
  it.each([120, 280])(
    'keeps overview restoration current during pending %ipx content measurements',
    async (height) => {
      vi.stubGlobal('HTMLElement', CatalogTestElement)
      const test = setup(1_000, height)
      await settle()
      try {
        expect(await test.adapter().focusEntry?.('900', new AbortController().signal)).toBe(true)
        test.scroll.scrollTop += 37
        test.scroll.dispatchEvent(new Event('scroll'))
        await settle()
        const snapshot = test.adapter().captureOverview?.('900')
        test.active.value = false
        await settle()
        test.active.value = true
        await settle()
        const pending = test.adapter().restoreOverview!(snapshot!, new AbortController().signal)
        await nextTick()
        // Preserve identities while the existing height cache returns to estimates, then
        // let natural heights arrive after restoration has already selected its window.
        test.groups.value = test.groups.value.map((group) => ({
          ...group,
          name: `${group.name} updated`,
        }))
        expect(await pending).toBe(true)
        await settle()
        expect(test.adapter().captureOverview?.('900')?.anchor).toEqual(snapshot?.anchor)
        expect(
          (test.document.activeElement as unknown as CatalogTestElement).props['data-am-focus-key'],
        ).toBe('platform:900:open')
      } finally {
        test.unmount()
      }
    },
  )

  it.each([0, 1, 80, 1_000, 10_000])(
    'bounds %i platform cards and releases its adapter',
    async (count) => {
      const test = setup(count)
      await settle()
      try {
        expect(test.cells().length).toBeLessThanOrEqual(Math.min(count, 15))
        if (count) expect(test.cells().length).toBeGreaterThan(0)
        for (const cell of test.cells()) {
          expect(cell.props.role).toBe('listitem')
          expect(cell.props['aria-setsize']).toBe(count)
          expect(cell.querySelectorAll('[data-queue-drop-kind]')).toHaveLength(0)
          expect(cell.querySelectorAll('[data-am-grid-motion]')).toHaveLength(1)
        }
        if (count > 80) {
          test.scroll.scrollTop = 15_000
          test.scroll.dispatchEvent(new Event('scroll'))
          await settle()
          expect(test.cells().length).toBeLessThanOrEqual(24)
          expect(test.cells().some((cell) => cell.dataset.queueDropId === '0')).toBe(false)
        }
        expect(test.select).not.toHaveBeenCalled()
        expect(test.open).not.toHaveBeenCalled()
      } finally {
        test.unmount()
      }
      expect(test.releaseAdapter).toHaveBeenCalledOnce()
      expect(test.adapter()).toBeUndefined()
    },
  )

  it('projects complete group selection and unchanged open/keyboard/press intents across density changes', async () => {
    const test = setup(80)
    await settle()
    try {
      const first = test.cells()[0]!
      test.selectedIds.value = new Set(['0:0'])
      await settle()
      const checkbox = findCatalogElement(first, (node) => node.tag === 'input')
      expect(checkbox.props.indeterminate).toBe(true)
      expect(checkbox.props.checked).toBe(false)
      test.selectedIds.value = new Set(test.groups.value[0]!.tracks.map(({ id }) => id))
      await settle()
      expect(checkbox.props.indeterminate).toBe(false)
      expect(checkbox.props.checked).toBe(true)
      expect(first.textContent).toContain('匹配 4 / 8 首')
      dispatchCatalogEvent(checkbox, 'onChange', false)
      expect(test.select).toHaveBeenCalledExactlyOnceWith('0')
      dispatchCatalogEvent(
        findCatalogElement(first, (node) => node.props['data-collection-entry'] === '0'),
        'onClick',
        false,
      )
      expect(test.open).toHaveBeenCalledExactlyOnceWith('0')
      const handle = findCatalogElement(first, (node) => 'data-queue-handle' in node.props)
      const event = { button: 0, stopPropagation() {} }
      ;(handle.props.onPointerdown as (event: unknown) => void)(event)
      expect(test.dragStart).toHaveBeenCalledExactlyOnceWith(event, '0')
      ;(handle.props.onKeydown as ((event: unknown) => void)[]).forEach((handler) =>
        handler({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }),
      )
      expect(test.shift).toHaveBeenCalledExactlyOnceWith('0', 1)
      for (const [mode, columns] of [
        ['compact', 4],
        ['comfortable', 2],
        ['standard', 3],
      ] as const) {
        test.displayMode.value = mode
        test.columns.value = columns
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Check each committed layout.
        await settle()
        expect(test.cells().find((cell) => cell.dataset.queueDropId === '0')).toBe(first)
        expect(first.querySelectorAll('[data-am-grid-motion]')).toHaveLength(1)
      }
      test.selectable.value = false
      await settle()
      expect(first.querySelectorAll('[type="checkbox"]')).toHaveLength(0)
    } finally {
      test.unmount()
    }
  })

  it('uses complete offscreen destinations with bounded leases and keyboard mounting before focus', async () => {
    const test = setup(1_000)
    await settle()
    try {
      const ids = test.groups.value.map(({ id }) => id)
      const session = test.adapter().createGeometry({
        kind: 'platform',
        sourceId: '0',
        ids,
        eligibleIds: new Set(ids),
        container: test.root as unknown as HTMLElement,
        bounds: { top: 0, left: 0, width: 1000, height: 300 } as DOMRect,
        initialScrollTop: 0,
      })!
      expect(session.findSlot(500, 500_000)?.id).toBe('999')
      expect(session.getOffsets('998').size).toBeLessThan(24)
      const release = test.adapter().retainItem('platform', '0')!
      test.scroll.scrollTop = 15_000
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.cells()).toContain(session.sourceElement as unknown as CatalogTestElement)
      expect(session.isValid?.()).toBe(true)
      release()
      await settle()
      expect(test.cells()).not.toContain(session.sourceElement as unknown as CatalogTestElement)
      const controller = new AbortController()
      expect(await test.adapter().focusItem('platform', '900', controller.signal)).toBe(true)
      const focused = test.document.activeElement as unknown as CatalogTestElement
      expect(focused.props['data-queue-handle']).toBeDefined()
      expect(
        test
          .cells()
          .find((cell) => cell.dataset.queueDropId === '900')
          ?.querySelectorAll('[data-queue-handle]'),
      ).toContain(focused)
      expect(test.cells().length).toBeLessThan(30)
      controller.abort()
      expect(await test.adapter().focusItem('platform', '1', controller.signal)).toBe(false)
      expect(await test.adapter().focusItem('track', '900', new AbortController().signal)).toBe(
        false,
      )
    } finally {
      test.unmount()
    }
  })

  it('keeps the established collection CSS contract for density and container-based mobile columns', () => {
    const original = readFileSync(
      new URL('../../../src/styles/_library.scss', import.meta.url),
      'utf8',
    )
    const candidate = readFileSync(
      new URL(
        '../../../src/components/music-sources/VirtualQueuePlatformGrid.vue',
        import.meta.url,
      ),
      'utf8',
    )
    const collection = readFileSync(
      new URL('../../../../ui/src/components/CollectionGrid.vue', import.meta.url),
      'utf8',
    )
    const primitive = readFileSync(
      new URL(
        '../../../../ui/src/components/virtual-scroll/VirtualTrackCardGrid.vue',
        import.meta.url,
      ),
      'utf8',
    )
    for (const width of [480, 240]) {
      expect(original).toContain(`--am-collection-card-width: ${width}px`)
      expect(candidate).toContain(`--am-collection-card-width: ${width}px`)
    }
    expect(collection).toContain('--am-collection-card-width: 320px')
    expect(primitive).toContain('var(--am-collection-card-width, 320px)')
    for (const rule of [
      '@container am-listen-queue (max-width: 600px)',
      'gap: var(--am-space-2)',
      'grid-template-columns: minmax(0, 1fr)',
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    ]) {
      expect(original).toContain(rule)
      expect(candidate).toContain(rule)
    }
    expect(primitive).toContain('gap: var(--am-space-4)')
    expect(candidate).toContain('layout="collection"')
  })

  it.each([120, 280])(
    'restores a distant overview occurrence/offset after remount with %ipx natural cards',
    async (height) => {
      vi.stubGlobal('HTMLElement', CatalogTestElement)
      const test = setup(1_000, height)
      await settle()
      try {
        expect(await test.adapter().focusEntry?.('900', new AbortController().signal)).toBe(true)
        test.scroll.scrollTop += 37
        test.scroll.dispatchEvent(new Event('scroll'))
        await settle()
        const snapshot = test.adapter().captureOverview?.('900')
        expect(snapshot?.anchor).toBeDefined()
        expect(snapshot?.focus).toEqual({ itemKey: '900', controlKey: 'platform:900:open' })
        const oldSource = test.cells().find((cell) => cell.dataset.queueDropId === '900')
        test.active.value = false
        await settle()
        expect(test.adapter()).toBeUndefined()
        test.active.value = true
        await settle()
        expect(
          await test.adapter().restoreOverview?.(snapshot!, new AbortController().signal),
        ).toBe(true)
        expect(test.adapter().captureOverview?.('900')?.anchor).toEqual(snapshot?.anchor)
        const focused = test.document.activeElement as unknown as CatalogTestElement
        expect(focused.props['data-am-focus-key']).toBe('platform:900:open')
        expect(test.cells().find((cell) => cell.dataset.queueDropId === '900')).not.toBe(oldSource)
        expect(test.cells().length).toBeLessThan(30)
      } finally {
        test.unmount()
      }
    },
  )
})
