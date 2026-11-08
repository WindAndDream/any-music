import { provideConfirmationDialog, providePlaylistPickerPresentation } from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CatalogPlaylistPickerDialog from '../../../src/components/music-sources/CatalogPlaylistPickerDialog.vue'
import CatalogTrackActionsDialog from '../../../src/components/music-sources/CatalogTrackActionsDialog.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

async function mountPicker(kind: 'batch' | 'song') {
  const covers = shallowRef<Record<string, string>>({ cover: 'data:image/png;base64,AAAA' })
  const select = vi.fn()
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideConfirmationDialog()
        providePlaylistPickerPresentation({
          coverUrls: () => covers.value,
          customTagsByPlaylistId: () => new Map([['p', ['通勤']]]),
          mobileLayout: () => true,
        })
        const playlists = [
          {
            id: 'p',
            name: '我的通勤',
            coverId: 'cover',
            trackIds: [],
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ]
        return () =>
          kind === 'song'
            ? h(CatalogTrackActionsDialog, {
                open: true,
                track: {
                  id: 'song',
                  title: '音乐',
                  artists: [],
                  source: { pluginId: 'test', resourceId: 'song', mediaKind: 'audio' },
                },
                playlists,
                invalid: false,
                favorite: false,
                customTags: [],
              })
            : h(CatalogPlaylistPickerDialog, {
                open: true,
                playlists,
                selectedCount: 2,
                onSelect: select,
              })
      },
    }),
    {},
  )
  if (kind === 'song') {
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('添加歌单'),
      ),
      'onClick',
    )
    await nextTick()
  }
  return { ...view, covers, select }
}

describe('playlist picker library presentation', () => {
  it('renders library artwork and tags, reacts to resolved covers and selects without opening details', async () => {
    const view = await mountPicker('batch')
    const image = () => findCatalogElement(view.root, (node) => node.tag === 'img')
    expect(image().props.src).toBe(view.covers.value.cover)
    expect(image().props.referrerpolicy).toBe('no-referrer')
    expect(view.root.textContent).toContain('通勤')
    expect(() =>
      findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '查看 我的通勤 的详细信息',
      ),
    ).toThrow()
    expect(() =>
      findCatalogElement(view.root, (node) => 'data-queue-handle' in node.props),
    ).toThrow()
    view.covers.value = { cover: 'data:image/png;base64,BBBB' }
    await nextTick()
    expect(image().props.src).toBe(view.covers.value.cover)
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '选择歌单 我的通勤，0 首歌曲',
      ),
      'onClick',
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('加入歌单（1）'),
      ),
      'onClick',
    )
    expect(view.select).toHaveBeenCalledWith(['p'])
    view.unmount()
  })

  it.each([
    ['batch', '歌单展示方式'],
    ['batch', '歌单筛选器'],
    ['song', '歌单展示方式'],
    ['song', '歌单筛选器'],
  ] as const)(
    'opens %s / %s above the suspended parent and restores it on close',
    async (kind, label) => {
      const view = await mountPicker(kind)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === label),
        'onClick',
      )
      await nextTick()
      const parent = findCatalogElement(view.root, (node) =>
        String(node.props.class).split(' ').includes('app-dialog'),
      )
      expect(parent.props.inert).toBe(true)
      const layer = findCatalogElement(
        view.root,
        (node) => node.props.class === 'app-dialog__overlays',
      )
      const child = findCatalogElement(layer, (node) => node.props.role === 'dialog')
      for (let node: CatalogTestElement | null = child; node; node = node.parent)
        expect(node.props.inert).toBeUndefined()
      dispatchCatalogEvent(
        findCatalogElement(
          layer,
          (node) => node.tag === 'button' && node.props['aria-label'] === '关闭',
        ),
        'onClick',
      )
      await nextTick()
      expect(parent.props.inert).toBeUndefined()
      view.unmount()
    },
  )
})
