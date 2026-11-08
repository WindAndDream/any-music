import type { LibraryTrackRecord, MusicPlaylist } from '@any-music/core'
import {
  createEditingSession,
  provideEditingSession,
  provideConfirmationDialog,
} from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import PlaylistDrawer from '../../../src/components/library/PlaylistDrawer.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? slots.default?.() : null,
  }),
}))
vi.mock('@any-music/ui/components/BottomSheet.vue', () => ({
  default: defineComponent({
    props: ['open'],
    setup:
      (props, { slots }) =>
      () =>
        props.open ? slots.default?.() : null,
  }),
}))
beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

const records: LibraryTrackRecord[] = ['two', 'one'].map((id) => ({
  track: {
    id,
    title: `歌曲 ${id}`,
    artists: [],
    source: { pluginId: 'source', resourceId: id, mediaKind: 'audio' },
  },
  customTags: [],
  addedAtMs: 1,
  updatedAtMs: 1,
}))
const playlist: MusicPlaylist = {
  id: 'playlist',
  name: '歌单',
  trackIds: ['two', 'one'],
  createdAtMs: 1,
  updatedAtMs: 1,
}

function mountDrawer() {
  const onDownload = vi.fn(),
    onFavorite = vi.fn(),
    onRemoveTrack = vi.fn(),
    onDelete = vi.fn()
  const visible = shallowRef(true)
  const editing = createEditingSession()
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        confirmation = provideConfirmationDialog()
        return () =>
          visible.value
            ? h(PlaylistDrawer, {
                records,
                playlist,
                customTracks: [],
                platforms: [{ id: 'source', name: '来源' }],
                favoriteTrackIds: new Set<string>(),
                downloadBusy: false,
                onDownload,
                onFavorite,
                onRemoveTrack,
                onDelete,
              })
            : null
      },
    }),
    {},
  )
  const button = (label: string) =>
    findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === label,
    )
  return {
    ...view,
    visible,
    editing,
    confirmation,
    onDownload,
    onFavorite,
    onRemoveTrack,
    onDelete,
    button,
  }
}

describe('classic playlist detail', () => {
  it('keeps batch selection and playlist order across replacement and emits controlled membership edits', async () => {
    const view = mountDrawer()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props.type === 'checkbox',
      ),
      'onChange',
      false,
    )
    await nextTick()
    expect(view.root.textContent).toContain('已选 2')
    view.visible.value = false
    await nextTick()
    view.visible.value = true
    await nextTick()
    expect(view.root.textContent).toContain('已选 2')
    dispatchCatalogEvent(view.button('下载已选'), 'onClick', false)
    expect(view.onDownload).toHaveBeenCalledExactlyOnceWith(records.map((record) => record.track))
    dispatchCatalogEvent(view.button('喜欢'), 'onClick', false)
    expect(view.onFavorite).toHaveBeenCalledExactlyOnceWith(records[0]!.track)
    dispatchCatalogEvent(view.button('移出歌单'), 'onClick', false)
    expect(view.onRemoveTrack).toHaveBeenCalledExactlyOnceWith(playlist.id, records[0]!.track.id)
    expect(playlist.trackIds).toEqual(['two', 'one'])
    view.unmount()
    view.editing.dispose()
  })

  it('never replays a confirmed deletion into a replacement playlist view', async () => {
    const view = mountDrawer()
    dispatchCatalogEvent(view.button('删除歌单'), 'onClick', false)
    expect(view.confirmation.activeRequest.value?.title).toBe('删除歌单')
    view.visible.value = false
    await nextTick()
    view.visible.value = true
    await nextTick()
    view.confirmation.accept()
    await nextTick()
    expect(view.onDelete).not.toHaveBeenCalled()
    dispatchCatalogEvent(view.button('删除歌单'), 'onClick', false)
    view.confirmation.accept()
    await nextTick()
    expect(view.onDelete).toHaveBeenCalledExactlyOnceWith(playlist.id)
    view.unmount()
    view.editing.dispose()
  })
})
