import type { MusicPlaylist } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import { usePlaylistPicker } from '../../../src/composables/library/use-playlist-picker'

const playlists: MusicPlaylist[] = [
  { id: 'a', name: '通勤', trackIds: ['one'], createdAtMs: 1, updatedAtMs: 1 },
  { id: 'b', name: '放松', trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
  { id: 'c', name: '通勤备选', trackIds: ['two'], createdAtMs: 1, updatedAtMs: 1 },
]
function setup() {
  const props = reactive({ open: true, playlists, selectedCount: 2, suspended: false })
  const scope = effectScope()
  const picker = scope.run(() => usePlaylistPicker(props))!
  return { props, picker, stop: () => scope.stop() }
}

describe('playlist picker', () => {
  it('selects all matching playlists and derives full selection after individual changes', () => {
    const { picker, stop } = setup()
    picker.view.filters.keyword = '通勤'
    picker.toggleAll()
    expect(picker.submit()).toEqual(['a', 'c'])
    expect(picker.allSelected.value).toBe(true)
    picker.select('a')
    expect(picker.allSelected.value).toBe(false)
    picker.select('a')
    expect(picker.allSelected.value).toBe(true)
    picker.toggleAll()
    expect(picker.submit()).toEqual([])
    stop()
  })

  it('keeps selections outside the filter and removes deleted destinations before submitting', async () => {
    const { picker, props, stop } = setup()
    picker.select('b')
    picker.view.filters.keyword = '通勤'
    picker.toggleAll()
    expect(picker.submit()).toEqual(['b', 'a', 'c'])
    props.playlists = [playlists[1]!]
    expect(picker.submit()).toEqual(['b'])
    props.open = false
    await nextTick()
    props.open = true
    expect(picker.view.selection).toEqual([])
    expect(picker.view.filters.keyword).toBe('')
    stop()
  })

  it('applies filter drafts explicitly and blocks inactive, suspended and empty submissions', () => {
    const { picker, props, stop } = setup()
    picker.view.draft = { ...picker.view.filters, trackCountRanges: [{ maxCount: 0 }] }
    expect(picker.preview.value.map(({ id }) => id)).toEqual(['b'])
    expect(picker.visible.value).toHaveLength(3)
    picker.applyFilters()
    picker.toggleAll()
    expect(picker.submit()).toEqual(['b'])
    props.suspended = true
    picker.toggleAll()
    picker.select('b')
    expect(picker.view.selection).toEqual(['b'])
    expect(picker.submit()).toEqual([])
    props.suspended = false
    props.selectedCount = 0
    expect(picker.submit()).toEqual([])
    props.selectedCount = 2
    props.open = false
    expect(picker.submit()).toEqual([])
    stop()
  })
})
