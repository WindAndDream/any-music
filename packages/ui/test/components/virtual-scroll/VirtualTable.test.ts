import { writeFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'
import type { Component } from 'vue'

import VirtualTable from '../../../src/components/virtual-scroll/VirtualTable.vue'
import type { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { virtualCollectionSizes } from '../../fixtures/virtual-scroll/collection-data'
import { mountVirtualGridComponent } from '../../fixtures/virtual-scroll/grid-test-renderer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'
import { findCatalogElement, type CatalogTestElement } from '../music-sources/catalog-test-renderer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}
function groups(node: CatalogTestElement): CatalogTestElement[] {
  return node.children.flatMap((child) =>
    child.tag === 'tbody' && child.props['data-occurrence'] !== undefined ? [child] : groups(child),
  )
}
function elements(node: CatalogTestElement): CatalogTestElement[] {
  return node.children.flatMap((child) =>
    child.tag.startsWith('#') ? elements(child) : [child, ...elements(child)],
  )
}
function setup(count: number, withDetails = false, interaction = false) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  const items = shallowRef(
    Array.from({ length: count }, (_, key) => ({
      key: `occurrence-${key}`,
      entity: 'repeated-song',
      rows: withDetails && key % 3 === 1 ? 2 : 1,
    })),
  )
  const retainedIndexes = shallowRef<readonly number[]>([])
  const enabled = shallowRef(true)
  const surface = shallowRef<{ retention?: ReturnType<typeof useVirtualItemRetention> }>()
  const mount = vi.fn(),
    release = vi.fn()
  const Cell = defineComponent({
    props: { name: { type: String, required: true } },
    setup(props) {
      mount()
      onScopeDispose(release)
      return () => h('td', props.name)
    },
  })
  const view = mountVirtualGridComponent(
    defineComponent({
      setup: () => () =>
        h(
          VirtualTable as unknown as Component,
          {
            id: 'library-table',
            ref: surface,
            interaction,
            'aria-label': 'Library',
            items: items.value,
            getItemKey: (item: { key: string }) => item.key,
            getContentGeneration: () => 0,
            getItemRowCount: (item: { rows: number }) => item.rows,
            getRowAttributes: (_item: unknown, _index: number, offset: number) => ({
              class: offset ? 'detail-row' : 'main-row',
            }),
            headerRowCount: 1,
            footerRowCount: 1,
            columnCount: 1,
            estimatedItemSize: 20,
            cacheLimit: 32,
            enabled: enabled.value,
            retainedIndexes: retainedIndexes.value,
            scrollElement: root.asElement(),
          },
          {
            caption: () => 'Collection',
            columns: () => h('col', { style: { width: '100%' } }),
            head: ({ firstRowIndex }: { firstRowIndex: number }) =>
              h('tr', { 'aria-rowindex': firstRowIndex }, [h('th', { scope: 'col' }, 'Title')]),
            foot: ({ firstRowIndex }: { firstRowIndex: number }) =>
              h('tr', { 'aria-rowindex': firstRowIndex }, [h('td', 'Summary')]),
            default: ({ row, rowOffset }: { row: { key: string }; rowOffset: number }) =>
              h(Cell, { name: `${row.key}/${rowOffset}` }),
          },
        ),
    }),
    env.document,
  )
  return {
    ...env,
    ...view,
    scrollRoot: root,
    items,
    retainedIndexes,
    enabled,
    mount,
    release,
    surface,
  }
}

const samples: { count: number; mounted: number; observed: number; released: number }[] = []

describe('controlled native VirtualTable (Node renderer; injected boxes)', () => {
  it('opts into bounded focus/composition leases and re-registers surviving row groups after disable', async () => {
    const test = setup(1000, false, true)
    await settle()
    try {
      const first = groups(test.root)[0]!
      const events = first as unknown as EventTarget
      events.dispatchEvent(new Event('focusin'))
      await settle()
      expect(test.surface.value?.retention?.retainedKeys.value).toEqual(['occurrence-0'])
      test.scrollRoot.scrollTop = 10_000
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      expect(groups(test.root)).toContain(first)
      events.dispatchEvent(new Event('compositionstart'))
      events.dispatchEvent(new Event('focusout'))
      await settle()
      expect(groups(test.root)).toContain(first)
      events.dispatchEvent(new Event('compositionend'))
      await settle()
      expect(groups(test.root)).not.toContain(first)
      expect(groups(test.root).length).toBeLessThan(12)
      test.enabled.value = false
      await settle()
      expect(test.surface.value?.retention?.retainedKeys.value).toEqual([])
      test.enabled.value = true
      await settle()
      const next = groups(test.root)[0]!
      ;(next as unknown as EventTarget).dispatchEvent(new Event('focusin'))
      await settle()
      expect(test.surface.value?.retention?.retainedKeys.value).toEqual([
        next.props['data-occurrence'],
      ])
    } finally {
      test.unmount()
    }
    expect(test.release.mock.calls.length).toBe(test.mount.mock.calls.length)
  })
  it.each(virtualCollectionSizes)('bounds mounted row groups for %i occurrences', async (count) => {
    const test = setup(count)
    await settle()
    const mounted = groups(test.root).length
    const observer = test.observers[0]!
    const observed = observer.observe.mock.calls.length - observer.unobserve.mock.calls.length
    try {
      expect(mounted).toBe(Math.min(count, 7))
      // One root, one persistent data origin, caption/head and the mounted natural row groups.
      expect(observed).toBe(mounted + 4)
      const table = findCatalogElement(test.root, (node) => node.tag === 'table')
      expect(table.props['aria-rowcount']).toBe(count + 2)
      expect(table.props['aria-label']).toBe('Library')
      expect(table.props['aria-colcount']).toBe(1)
      expect(table.props.id).toBe('library-table')
      expect(table.props.style).toMatchObject({
        tableLayout: 'fixed',
        borderCollapse: 'separate',
        borderSpacing: 0,
      })
      const children = table.children.filter((child) => !child.tag.startsWith('#'))
      expect(children.slice(0, 3).map((child) => child.tag)).toEqual([
        'caption',
        'colgroup',
        'thead',
      ])
      expect(children.at(-1)!.tag).toBe('tfoot')
      expect(
        findCatalogElement(
          findCatalogElement(table, (node) => node.tag === 'thead'),
          (node) => node.tag === 'tr',
        ).props['aria-rowindex'],
      ).toBe(1)
      expect(
        findCatalogElement(
          findCatalogElement(table, (node) => node.tag === 'tfoot'),
          (node) => node.tag === 'tr',
        ).props['aria-rowindex'],
      ).toBe(count + 2)
      expect(
        children.every((child) =>
          ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'].includes(child.tag),
        ),
      ).toBe(true)
      for (const body of children.filter((child) => child.tag === 'tbody')) {
        expect(
          body.children
            .filter((child) => !child.tag.startsWith('#'))
            .every((child) => child.tag === 'tr'),
        ).toBe(true)
        if (body.props['aria-hidden']) {
          expect(body.props['data-occurrence']).toBeUndefined()
          const cell = findCatalogElement(body, (node) => node.tag === 'td')
          expect(cell.props.style).toMatchObject({
            padding: '0',
            border: '0',
            lineHeight: '0',
            fontSize: '0',
          })
        }
      }
      expect(elements(table).some((node) => node.tag === 'div')).toBe(false)
      for (const [index, body] of groups(test.root).entries()) {
        expect(body.props.style).toBeUndefined()
        const row = body.children.find((child) => child.tag === 'tr')!
        expect(row.props['aria-rowindex']).toBe(index + 2)
      }
    } finally {
      test.unmount()
    }
    expect(test.release.mock.calls.length).toBe(test.mount.mock.calls.length)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    samples.push({ count, mounted, observed, released: test.release.mock.calls.length })
    if (
      samples.length === virtualCollectionSizes.length &&
      process.env.AM_VIRTUAL_TABLE_BASELINE_OUTPUT
    )
      writeFileSync(
        process.env.AM_VIRTUAL_TABLE_BASELINE_OUTPUT,
        `${JSON.stringify({ method: 'Vue Node custom renderer of controlled native VirtualTable; installed engine, 100px injected viewport, 20px injected natural tbody boxes, overscan2/cache32, one header/footer row. No real native table layout, focus, sticky headers, accessibility-tree or runtime/frame evidence.', samples }, null, 2)}\n`,
      )
  })

  it('supports existing native tr components without nesting rows, and supplies full physical positions', async () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document)
    root.clientHeight = 80
    root.scrollTop = 0
    const scopeMount = vi.fn(),
      scopeRelease = vi.fn()
    const NativeRow = defineComponent({
      setup(_props, { attrs }) {
        scopeMount()
        onScopeDispose(scopeRelease)
        return () => h('tr', attrs, [h('td', 'Native cells')])
      },
    })
    const view = mountVirtualGridComponent(
      defineComponent({
        setup: () => () =>
          h(
            VirtualTable as unknown as Component,
            {
              items: [{ key: 'group' }, { key: 'same-song-first' }, { key: 'same-song-second' }],
              getItemKey: (item: { key: string }) => item.key,
              getContentGeneration: () => 0,
              getItemRowCount: (_item: unknown, index: number) => (index === 1 ? 2 : 1),
              estimatedItemSize: 20,
              columnCount: 1,
              headerRowCount: 2,
              scrollElement: root.asElement(),
            },
            {
              rows: ({
                row,
                position,
              }: {
                row: { index: number }
                position: { firstRowIndex: number; rowCount: number }
              }) =>
                row.index === 0
                  ? h('tr', { 'aria-rowindex': position.firstRowIndex }, [
                      h('th', { scope: 'rowgroup', colspan: 1 }, 'Group'),
                    ])
                  : Array.from({ length: position.rowCount }, (_, offset) =>
                      h(NativeRow, {
                        key: offset,
                        'aria-rowindex': position.firstRowIndex + offset,
                      }),
                    ),
              head: ({ firstRowIndex }: { firstRowIndex: number }) => [
                h('tr', { 'aria-rowindex': firstRowIndex }, [h('th', 'Title')]),
                h('tr', { 'aria-rowindex': firstRowIndex + 1 }, [h('th', 'Subtitle')]),
              ],
            },
          ),
      }),
      env.document,
    )
    await settle()
    try {
      const body = groups(view.root)
      expect(body).toHaveLength(3)
      expect(
        body.map((node) =>
          node.children
            .filter((child) => child.tag === 'tr')
            .map((row) => row.props['aria-rowindex']),
        ),
      ).toEqual([[3], [4, 5], [6]])
      const table = findCatalogElement(view.root, (node) => node.tag === 'table')
      expect(table.props['aria-rowcount']).toBe(6)
      expect(
        elements(table)
          .filter((node) => node.tag === 'tr')
          .every((row) => row.parent?.tag === 'thead' || row.parent?.tag === 'tbody'),
      ).toBe(true)
      expect(scopeMount).toHaveBeenCalledTimes(3)
    } finally {
      view.unmount()
    }
    expect(scopeRelease).toHaveBeenCalledTimes(3)
    expect(env.observers[0]!.disconnect).toHaveBeenCalledTimes(1)
  })

  it('releases row resources on disable and unmount, and ignores queued old row measurements', async () => {
    const test = setup(1000, true)
    await settle()
    const observer = test.observers[0]!
    const oldGroups = groups(test.root)
    test.enabled.value = false
    await settle()
    expect(groups(test.root)).toHaveLength(0)
    expect(test.release.mock.calls.length).toBe(test.mount.mock.calls.length)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    observer.notify(oldGroups as unknown as Element[])
    await settle()
    expect(groups(test.root)).toHaveLength(0)
    test.enabled.value = true
    await settle()
    expect(groups(test.root).length).toBeGreaterThan(0)
    const currentObserver = test.observers.at(-1)!
    currentObserver.notify(groups(test.root) as unknown as Element[])
    test.unmount()
    await settle()
    expect(test.release.mock.calls.length).toBe(test.mount.mock.calls.length)
    expect(currentObserver.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps keyed row/detail scopes, physical positions and sparse gaps around distant retained rows', async () => {
    const test = setup(1000, true)
    await settle()
    try {
      const table = findCatalogElement(test.root, (node) => node.tag === 'table')
      const original = groups(test.root)[1]!
      expect(
        original.children
          .filter((child) => child.tag === 'tr')
          .map((row) => row.props['aria-rowindex']),
      ).toEqual([3, 4])
      expect(table.props['aria-rowcount']).toBe(1335)
      test.retainedIndexes.value = [1, 900]
      test.scrollRoot.scrollTop = 10_000
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      const next = groups(test.root)
      expect(next.find((body) => body.props['data-occurrence'] === 'occurrence-1')).toBe(original)
      expect(next.some((body) => body.props['data-occurrence'] === 'occurrence-900')).toBe(true)
      expect(next.length).toBeLessThan(15)
      const spacers = elements(table).filter((node) => node.tag === 'td' && node.props.style)
      expect(
        spacers.filter(
          (node) =>
            Number.parseFloat(String((node.props.style as { blockSize: string }).blockSize)) > 100,
        ),
      ).toHaveLength(3)
      expect(test.mount.mock.calls.length - test.release.mock.calls.length).toBe(
        next.reduce(
          (count, body) => count + body.children.filter((child) => child.tag === 'tr').length,
          0,
        ),
      )
      // Same entity IDs never replace occurrence identity; row groups follow stable occurrence keys.
      const previous = test.items.value
      test.items.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
      test.scrollRoot.scrollTop = 0
      test.scrollRoot.dispatchEvent(new Event('scroll'))
      await settle()
      const reordered = groups(test.root)[0]!
      expect(reordered).toBe(original)
      expect(
        reordered.children
          .filter((child) => child.tag === 'tr')
          .map((row) => row.props['aria-rowindex']),
      ).toEqual([2, 3])
    } finally {
      test.unmount()
    }
  })
})
