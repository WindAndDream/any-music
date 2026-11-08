import type { MusicPlaylist } from '@any-music/core'
import { createEditingSession, provideEditingSession } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, shallowRef } from 'vue'

import PlaylistEditorDialog from '../../../src/components/library/PlaylistEditorDialog.vue'
import {
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
        props.open ? h('section', slots.default?.()) : null,
  }),
}))
vi.mock('@any-music/ui/components/DialogPages.vue', () => ({
  default: defineComponent({
    props: ['page', 'focusSelector'],
    setup:
      (props, { slots }) =>
      () =>
        h('div', { 'data-focus-selector': props.focusSelector }, slots.default?.()),
  }),
}))

function mountEditor(existing?: MusicPlaylist) {
  const playlists = shallowRef<MusicPlaylist[]>(existing ? [existing] : [])
  const name = shallowRef(existing?.name ?? '新歌单')
  let finish!: () => void
  const create = vi.fn(async () => {
    playlists.value = [
      { id: 'new', name: name.value, trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
    ]
    await new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  const feature = computed(
    () =>
      ({
        availability: { status: 'available' },
        status: { status: 'ready' },
        state: {
          playlists: playlists.value,
          nameDraft: name.value,
          favoriteTrackIds: [],
          coverUrls: {},
          playlistTagsAvailable: true,
        },
        actions: {
          create,
          setNameDraft: (value: string) => {
            name.value = value
          },
        },
      }) as unknown as UiThemeFeatureMap['playlists'],
  )
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(createEditingSession())
        return () => h(PlaylistEditorDialog, { feature: feature.value, playlist: existing })
      },
    }),
    {},
  )
  return { view, create, finish: () => finish(), playlists }
}

describe('playlist editor', () => {
  it('does not flash duplicate-name validation between publishing a created playlist and closing', async () => {
    const f = mountEditor()
    try {
      dispatchCatalogEvent(
        findCatalogElement(f.view.root, (node) => node.tag === 'form'),
        'onSubmit',
      )
      await nextTick()
      expect(f.playlists.value).toHaveLength(1)
      expect(f.create).toHaveBeenCalledOnce()
      expect(f.view.root.textContent).not.toContain('已存在')
      f.finish()
      await nextTick()
      await nextTick()
      expect(f.view.root.textContent).not.toContain('已存在')
    } finally {
      f.view.unmount()
    }
  })

  it('keeps the description textarea out of automatic focus and targets the tag input on tag entry', async () => {
    const f = mountEditor({ id: 'p', name: '歌单', trackIds: [], createdAtMs: 1, updatedAtMs: 1 })
    const enter = async (field: string) => {
      dispatchCatalogEvent(
        findCatalogElement(f.view.root, (node) => node.props['data-playlist-field'] === field),
        'onClick',
        false,
      )
      await nextTick()
      return findCatalogElement(
        f.view.root,
        (node) => typeof node.props['data-focus-selector'] === 'string',
      ).props['data-focus-selector']
    }
    try {
      expect(await enter('description')).toBe('.playlist-editor__back')
      dispatchCatalogEvent(
        findCatalogElement(f.view.root, (node) => node.props['aria-label'] === '返回歌单操作'),
        'onClick',
        false,
      )
      await nextTick()
      expect(await enter('tags')).toBe('[name=playlist-tag]')
    } finally {
      f.view.unmount()
    }
  })
})
