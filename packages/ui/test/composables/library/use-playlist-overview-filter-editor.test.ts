import { describe, expect, it } from 'vitest'

import {
  readPlaylistTrackCount,
  usePlaylistOverviewFilterEditor,
} from '../../../src/composables/library/use-playlist-overview-filter-editor'
import { createEditingSession } from '../../../src/composables/use-editing-session'

describe('playlist overview count editor', () => {
  it.each(['0', '-1', '1.5', '1e2', '+2', 'Infinity', 'NaN', '9007199254740992', '', ' '])(
    'rejects non-positive-integer input %j',
    (input) => expect(readPlaylistTrackCount(input)).toBeUndefined(),
  )

  it('previews valid pending bounds and confirms without requiring Add first', () => {
    const editor = usePlaylistOverviewFilterEditor()
    editor.active.value = 'trackCountRanges'
    editor.minimumCount.value = ' 2 '
    editor.maximumCount.value = '10'
    expect(editor.local.value.trackCountRanges).toEqual([])
    expect(editor.preview.value.trackCountRanges).toEqual([{ minCount: 2, maxCount: 10 }])
    expect(editor.confirmDraft()).toBe(true)
    expect(editor.local.value.trackCountRanges).toEqual([{ minCount: 2, maxCount: 10 }])
    expect(editor.minimumCount.value).toBe('')
  })

  it('keeps invalid or reversed input uncommitted and leaves selected ranges in the preview', () => {
    const editor = usePlaylistOverviewFilterEditor()
    editor.active.value = 'trackCountRanges'
    editor.minimumCount.value = '0'
    expect(editor.countError.value).toBe('请输入有效的正整数。')
    expect(editor.canAddRange.value).toBe(false)
    expect(editor.confirmDraft()).toBe(false)
    editor.minimumCount.value = '10'
    editor.maximumCount.value = '2'
    expect(editor.countError.value).toContain('不能小于')
    expect(editor.preview.value.trackCountRanges).toEqual([])
    expect(editor.confirmDraft()).toBe(false)
  })

  it('supports open bounds, edits, deduplication and removal without losing adjacent ranges', () => {
    const editor = usePlaylistOverviewFilterEditor()
    editor.minimumCount.value = '2'
    expect(editor.addRange()).toBe(true)
    editor.maximumCount.value = '1'
    expect(editor.addRange()).toBe(true)
    editor.editRange(0)
    editor.minimumCount.value = '3'
    expect(editor.addRange()).toBe(true)
    expect(editor.local.value.trackCountRanges).toEqual([
      { minCount: 3, maxCount: undefined },
      { minCount: undefined, maxCount: 1 },
    ])
    editor.minimumCount.value = '3'
    editor.addRange()
    expect(editor.local.value.trackCountRanges).toHaveLength(2)
    editor.editRange(1)
    editor.removeRange(0)
    expect(editor.editingIndex.value).toBe(0)
    editor.removeRange(0)
    expect(editor.local.value.trackCountRanges).toEqual([])
    expect(editor.maximumCount.value).toBe('')
  })

  it('retains unfinished range and tag search input with its editing owner', () => {
    const editing = createEditingSession()
    const first = usePlaylistOverviewFilterEditor(editing)
    first.active.value = 'trackCountRanges'
    first.minimumCount.value = '12'
    first.tagQuery.value = '通勤'
    const second = usePlaylistOverviewFilterEditor(editing)
    expect(second.minimumCount.value).toBe('12')
    expect(second.tagQuery.value).toBe('通勤')
    expect(second.preview.value.trackCountRanges).toEqual([{ minCount: 12, maxCount: undefined }])
    editing.dispose()
  })
})
