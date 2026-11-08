import type { LibraryTrackRecord } from '@any-music/core'
import { createEditingSession } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useTagDirectory } from '../../src/vue/use-tag-directory'
import { useTagManagementFilters } from '../../src/vue/use-tag-management-filters'

const platforms = [
  { id: 'bilibili', name: '哔哩哔哩' },
  { id: 'douyin', name: '抖音' },
]
function record(
  id: string,
  pluginId: string,
  tags: readonly string[],
  time: number,
): LibraryTrackRecord {
  return {
    track: {
      id,
      title: `歌曲 ${id}`,
      artists: [],
      source: { pluginId, resourceId: id, mediaKind: 'audio' },
    },
    customTags: tags,
    addedAtMs: 1,
    updatedAtMs: time,
  }
}
function fixture() {
  const records = shallowRef([
    record('1', 'bilibili', ['通勤', '收藏', 'ＦＯＯ', 'foo'], 100),
    record('2', 'douyin', ['通勤', '夜晚'], 300),
    record('3', 'bilibili', ['收藏'], 200),
    record('4', 'douyin', [], 400),
  ])
  const editing = createEditingSession()
  const bind = () => {
    const scope = effectScope()
    const result = scope.run(() => {
      const filters = useTagManagementFilters(records, platforms, editing)
      return { ...filters, directory: useTagDirectory(filters, editing) }
    })!
    return { ...result, stop: () => scope.stop() }
  }
  return { records, editing, bind }
}

describe('tag directory filtering and editing state', () => {
  it('counts each playlist once and includes all member platforms without inheriting song tags', () => {
    const editing = createEditingSession()
    const scope = effectScope()
    const kind = shallowRef<'tracks' | 'playlists'>('playlists')
    const view = scope.run(() =>
      useTagManagementFilters(
        [record('song', 'bilibili', ['音乐专用'], 1)],
        platforms,
        editing,
        [],
        {
          kind,
          playlists: [
            {
              playlist: {
                id: 'p',
                name: '歌单',
                trackIds: ['song', 'song'],
                createdAtMs: 1,
                updatedAtMs: 2,
              },
              customTags: ['FOO', 'ＦＯＯ'],
              platformIds: ['bilibili', 'bilibili', 'douyin'],
            },
            {
              playlist: {
                id: 'empty',
                name: '空歌单',
                trackIds: [],
                createdAtMs: 1,
                updatedAtMs: 3,
              },
              customTags: ['空歌单标签'],
              platformIds: [],
            },
          ],
        },
      ),
    )!
    expect(view.index.value.tags.get('foo')).toMatchObject({
      count: 1,
      platformIds: ['bilibili', 'douyin'],
    })
    expect(view.index.value.playlists.get('foo')).toHaveLength(1)
    expect(view.index.value.tags.has('音乐专用')).toBe(false)
    expect(view.index.value.tags.get('空歌单标签')).toMatchObject({ count: 1, platformIds: [] })
    expect(view.platformOptions.value.slice(0, 2).map(({ count }) => count)).toEqual([1, 1])
    kind.value = 'tracks'
    expect(view.index.value.tags.get('音乐专用')?.count).toBe(1)
    expect(view.index.value.playlists.get('foo')).toBeUndefined()
    scope.stop()
    editing.dispose()
  })
  it('shows unused definitions without a source platform and merges their song counts once', () => {
    const records = shallowRef<readonly LibraryTrackRecord[]>([])
    const editing = createEditingSession()
    const scope = effectScope()
    const view = scope.run(() =>
      useTagManagementFilters(records, [], editing, [{ name: 'FOO', updatedAtMs: 10 }]),
    )!
    expect(view.tagOptions.value).toMatchObject([{ key: 'foo', count: 0, platformIds: [] }])
    records.value = [record('1', 'bilibili', ['foo', 'ＦＯＯ'], 20)]
    expect(view.allTagOptions.value).toMatchObject([
      { name: 'FOO', count: 1, platformIds: ['bilibili'], updatedAtMs: 20 },
    ])
    scope.stop()
    editing.dispose()
  })
  it('indexes unique songs per normalized tag, platform coverage and newest maintenance', () => {
    const f = fixture(),
      view = f.bind()
    expect(view.taggedRecords.value).toHaveLength(3)
    expect(view.allTagOptions.value).toHaveLength(4)
    expect(view.index.value.tags.get('foo')).toMatchObject({
      name: 'ＦＯＯ',
      count: 1,
      platformIds: ['bilibili'],
    })
    expect(view.index.value.tags.get('通勤')).toMatchObject({
      count: 2,
      platformIds: ['bilibili', 'douyin'],
      updatedAtMs: 300,
    })
    expect(view.platformOptions.value.slice(0, 2)).toMatchObject([
      { id: 'bilibili', count: 2 },
      { id: 'douyin', count: 1 },
    ])
    view.stop()
    f.editing.dispose()
  })
  it('previews tag filters without changing the applied list and discards cancelled edits', () => {
    const f = fixture(),
      view = f.bind()
    view.beginFilters()
    expect(view.filterDraft.value!.selectedPlatformIds).not.toBe(
      view.filters.value.selectedPlatformIds,
    )
    view.filterDraft.value = {
      ...view.filterDraft.value!,
      selectedPlatformIds: ['douyin'],
      searchQuery: '通',
      usage: ['multiple'],
      platformScope: ['multiple'],
    }
    expect(view.filterPreviewCount.value).toBe(1)
    expect(view.tagOptions.value).toHaveLength(4)
    view.filterDraft.value = null
    expect(view.tagOptions.value).toHaveLength(4)
    view.beginFilters()
    view.filterDraft.value = { ...view.filterDraft.value!, selectedPlatformIds: ['douyin'] }
    view.applyFilters()
    expect(view.tagOptions.value.map(({ name }) => name).toSorted()).toEqual(['夜晚', '通勤'])
    expect(view.index.value.tags.get('通勤')!.count).toBe(2)
    view.stop()
    f.editing.dispose()
  })
  it('combines dimensions, normalizes search, and treats an empty platform selection as all', () => {
    const f = fixture(),
      view = f.bind()
    view.filters.value = { ...view.filters.value, searchQuery: ' Foo ' }
    expect(view.tagOptions.value.map(({ key }) => key)).toEqual(['foo'])
    view.resetFilters()
    view.filters.value = { ...view.filters.value, usage: ['multiple'], platformScope: ['single'] }
    expect(view.tagOptions.value.map(({ name }) => name)).toEqual(['收藏'])
    view.filters.value = { ...view.filters.value, selectedPlatformIds: [] }
    expect(view.tagOptions.value.map(({ name }) => name)).toEqual(['收藏'])
    view.resetFilters()
    expect(view.hasFilters.value).toBe(false)
    expect(view.tagOptions.value).toHaveLength(4)
    view.stop()
    f.editing.dispose()
  })
  it('sorts by global usage or name with deterministic ties', () => {
    const f = fixture(),
      view = f.bind()
    view.filters.value = { ...view.filters.value, sortMode: ['usage-desc'] }
    expect(view.tagOptions.value.slice(0, 2).every(({ count }) => count === 2)).toBe(true)
    view.filters.value = { ...view.filters.value, sortMode: ['name-asc'] }
    const names = view.tagOptions.value.map(({ name }) => name)
    expect(names).toEqual(names.toSorted((a, b) => a.localeCompare(b, 'zh-CN')))
    view.stop()
    f.editing.dispose()
  })
  it('unions selected counts and coverage, intersects dimensions, and includes unused tags only with all', () => {
    const records = [
      record('1', 'bilibili', ['Single', 'Same', 'Cross'], 100),
      record('2', 'bilibili', ['Same'], 200),
      record('3', 'douyin', ['Cross'], 300),
    ]
    const editing = createEditingSession()
    const scope = effectScope()
    const view = scope.run(() =>
      useTagManagementFilters(records, platforms, editing, [{ name: 'Unused', updatedAtMs: 10 }]),
    )!
    expect(view.tagOptions.value).toHaveLength(4)
    view.filters.value = {
      ...view.filters.value,
      usage: ['single', 'multiple'],
      platformScope: ['single', 'multiple'],
    }
    expect(view.tagOptions.value.map(({ name }) => name).toSorted()).toEqual([
      'Cross',
      'Same',
      'Single',
    ])
    view.filters.value = { ...view.filters.value, usage: ['multiple'] }
    expect(view.tagOptions.value.map(({ name }) => name).toSorted()).toEqual(['Cross', 'Same'])
    view.filters.value = { ...view.filters.value, platformScope: ['single'] }
    expect(view.tagOptions.value.map(({ name }) => name)).toEqual(['Same'])
    view.filters.value = { ...view.filters.value, selectedPlatformIds: ['douyin'] }
    expect(view.tagOptions.value).toEqual([])
    view.filters.value = { ...view.filters.value, selectedPlatformIds: ['douyin', 'bilibili'] }
    expect(view.tagOptions.value.map(({ name }) => name)).toEqual(['Same'])
    view.resetFilters()
    expect(view.tagOptions.value).toHaveLength(4)
    scope.stop()
    editing.dispose()
  })
  it('uses selection order as sort priority and recent maintenance when all sorting is selected', () => {
    const records = [
      record('1', 'bilibili', ['A', 'B', 'D'], 100),
      record('2', 'bilibili', ['B'], 200),
      record('3', 'douyin', ['C', 'D'], 300),
    ]
    const editing = createEditingSession()
    const scope = effectScope()
    const view = scope.run(() => useTagManagementFilters(records, platforms, editing))!
    const names = () => view.tagOptions.value.map(({ name }) => name)
    expect(names()).toEqual(['C', 'D', 'B', 'A'])
    view.filters.value = { ...view.filters.value, sortMode: ['usage-desc', 'updated-desc'] }
    expect(names()).toEqual(['D', 'B', 'C', 'A'])
    view.filters.value = { ...view.filters.value, sortMode: ['updated-desc', 'usage-desc'] }
    expect(names()).toEqual(['D', 'C', 'B', 'A'])
    view.filters.value = {
      ...view.filters.value,
      sortMode: ['usage-desc', 'name-asc', 'updated-desc'],
    }
    expect(names()).toEqual(['B', 'D', 'A', 'C'])
    view.resetFilters()
    expect(names()).toEqual(['C', 'D', 'B', 'A'])
    scope.stop()
    editing.dispose()
  })
  it('opens details normally, selects only in operator mode, and prunes hidden or deleted selections', async () => {
    const f = fixture(),
      view = f.bind(),
      directory = view.directory
    directory.activateTag('通勤')
    expect(directory.detailTag.value?.name).toBe('通勤')
    expect(directory.detailRecords.value.map(({ track }) => track.id)).toEqual(['1', '2'])
    expect(directory.selectedTags.value).toHaveLength(0)
    directory.closeDetail()
    directory.setOperatorOpen(true)
    directory.activateTag('通勤')
    expect(directory.detailTag.value).toBeNull()
    expect(directory.selectedTags.value.map(({ name }) => name)).toEqual(['通勤'])
    directory.toggleAllTags()
    expect(directory.selectedTags.value).toHaveLength(4)
    view.filters.value = { ...view.filters.value, searchQuery: '夜' }
    expect(directory.selectedTags.value.map(({ name }) => name)).toEqual(['夜晚'])
    f.records.value = f.records.value.map((item) => ({
      ...item,
      customTags: item.customTags.filter((tag) => tag !== '夜晚'),
    }))
    await nextTick()
    expect(directory.selectedTags.value).toHaveLength(0)
    directory.setOperatorOpen(false)
    expect(directory.view.selectedTagKeys.size).toBe(0)
    view.stop()
    f.editing.dispose()
  })
  it('retains display, detail name, selection and unapplied filter drafts across presentation replacement', () => {
    const f = fixture(),
      first = f.bind()
    first.directory.view.displayMode = 'rows'
    first.directory.setOperatorOpen(true)
    first.directory.activateTag('通勤')
    first.directory.editSelectedTag()
    first.directory.view.tagNameDraft = '未提交名称'
    first.beginFilters()
    first.filterDraft.value = {
      ...first.filterDraft.value!,
      searchQuery: '收藏',
      usage: ['single', 'multiple'],
      platformScope: ['single', 'multiple'],
      sortMode: ['usage-desc', 'updated-desc'],
    }
    first.stop()
    const second = f.bind()
    expect(second.filterDraft.value?.searchQuery).toBe('收藏')
    expect(second.filterDraft.value?.usage).toEqual(['single', 'multiple'])
    expect(second.filterDraft.value?.platformScope).toEqual(['single', 'multiple'])
    expect(second.filterDraft.value?.sortMode).toEqual(['usage-desc', 'updated-desc'])
    expect(second.directory.view).toMatchObject({
      displayMode: 'rows',
      operatorOpen: true,
      tagNameDraft: '未提交名称',
    })
    expect(second.directory.selectedTags.value.map(({ name }) => name)).toEqual(['通勤'])
    second.stop()
    f.editing.dispose()
  })
  it('updates unknown platforms and custom music while respecting existing deselections', async () => {
    const f = fixture(),
      view = f.bind()
    view.filters.value = { ...view.filters.value, selectedPlatformIds: ['bilibili'] }
    f.records.value = [
      ...f.records.value,
      record('5', 'other', ['新标签'], 500),
      {
        ...record('6', 'recipe', ['拼接'], 600),
        track: {
          ...record('6', 'recipe', [], 600).track,
          source: { pluginId: 'recipe', resourceId: '6', mediaKind: 'custom' },
        },
      },
    ]
    await nextTick()
    expect(view.filters.value.selectedPlatformIds).toEqual(['bilibili'])
    expect(view.filters.value.selectedPlatformIds).not.toContain('douyin')
    expect(view.platformOptions.value.find(({ id }) => id === 'local-custom')?.count).toBe(1)
    view.stop()
    f.editing.dispose()
  })
  it('reconciles platforms introduced while its presentation was absent without restoring deselected platforms', () => {
    const f = fixture(),
      first = f.bind()
    first.filters.value = { ...first.filters.value, selectedPlatformIds: ['bilibili'] }
    first.stop()
    f.records.value = [...f.records.value, record('5', 'other', ['新增'], 500)]
    const second = f.bind()
    expect(second.filters.value.selectedPlatformIds).toEqual(['bilibili'])
    expect(second.tagOptions.value.some(({ name }) => name === '新增')).toBe(false)
    second.stop()
    f.editing.dispose()
  })
})
