import type { LibraryTrackRecord, Track } from '@any-music/core'
import { createSession } from '@any-music/plugin-tag-management/vue'
import type { TagManagementImplementation } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useTagManagement } from '../../../src/features/plugins/use-tag-management'
import type { WorkbenchRuntime } from '../../../src/runtime/workbench-runtime'
import { createProductGenerationStorage } from '../../../src/storage/product-generation-store'
import { initial, memory, options } from '../../storage/product-storage-fixtures'

const implementation = { Panel: {}, createSession } satisfies TagManagementImplementation
const track: Track = {
  id: 'source:new',
  title: '核心曲目',
  artists: [{ name: '作者' }],
  sourceTags: ['来源标签'],
  source: { pluginId: 'source', resourceId: 'new', mediaKind: 'audio' },
}
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}
function fixture(loader: () => Promise<TagManagementImplementation> = async () => implementation) {
  const data = memory(initial())
  const storage = createProductGenerationStorage(data.raw, options)
  const enabled = shallowRef(true)
  const records = shallowRef<readonly LibraryTrackRecord[]>([])
  const runtime = { storage, loadTagManagement: loader } satisfies Pick<
    WorkbenchRuntime,
    'storage' | 'loadTagManagement'
  >
  const scope = effectScope()
  const feature = scope.run(() =>
    useTagManagement(
      runtime,
      () => enabled.value,
      () => records.value,
      (tracks) => {
        records.value = [
          ...records.value,
          ...tracks.map((item) => ({ track: item, customTags: [], addedAtMs: 1, updatedAtMs: 1 })),
        ]
      },
    ),
  )!
  return { data, storage, enabled, records, scope, feature }
}
describe('tag feature host boundary', () => {
  it('offers recent user labels and marks only labels shared by the complete selection', async () => {
    const f = fixture()
    await settle()
    const other = { ...track, id: 'source:other' }
    f.feature.addTags([track, other], '通勤')
    f.feature.addTag(track, '夜晚')
    f.feature.actions.value!.createTag('空标签')
    f.feature.actions.value!.addPlaylistTag('p', '歌单标签')
    expect(f.feature.tagInputOptions([track, other])).toEqual([
      { value: '歌单标签', selected: false },
      { value: '空标签', selected: false },
      { value: '夜晚', selected: false },
      { value: '通勤', selected: true },
      { value: 'user-tag', selected: false },
    ])
    f.feature.addTags([track, other], '夜晚')
    expect(f.feature.tagInputOptions([track, other])[0]).toEqual({ value: '夜晚', selected: true })
    expect(f.feature.tagInputOptions([]).every((option) => !option.selected)).toBe(true)
    f.enabled.value = false
    expect(f.feature.tagInputOptions([track])).toEqual([])
    f.scope.stop()
  })
  it('projects standalone definitions reactively and retains them across disable and reload', async () => {
    const f = fixture()
    await settle()
    f.feature.actions.value!.createTag('现场')
    expect(f.feature.tagDefinitions.value.map(({ name }) => name)).toEqual(['现场', 'user-tag'])
    expect(f.feature.records.value).toEqual([])
    const namespace = f.storage.read('plugin:feature.tags:v1')
    f.enabled.value = false
    expect(f.feature.tagDefinitions.value).toEqual([])
    f.enabled.value = true
    await settle()
    expect(f.feature.tagDefinitions.value.map(({ name }) => name)).toEqual(['现场', 'user-tag'])
    expect(f.storage.read('plugin:feature.tags:v1')).toEqual(namespace)
    f.scope.stop()
  })
  it('withdraws all tag projections immediately, retains namespace and resumes without writes', async () => {
    const f = fixture()
    await settle()
    f.feature.addTag(track, '用户标签')
    f.feature.actions.value!.addPlaylistTag('playlist', '歌单标签')
    expect(f.feature.tagsByPlaylistId.value.get('playlist')).toEqual(['歌单标签'])
    expect(f.feature.records.value[0]?.customTags).toEqual(['用户标签'])
    expect(f.feature.records.value[0]?.updatedAtMs).not.toBe(1)
    const namespace = f.storage.read('plugin:feature.tags:v1')
    const count = f.data.writes.length
    const oldActions = f.feature.actions.value!
    f.enabled.value = false
    expect(f.feature.records.value[0]?.customTags).toEqual([])
    expect(f.feature.records.value[0]?.updatedAtMs).toBe(1)
    expect(f.feature.records.value[0]?.track.sourceTags).toEqual(['来源标签'])
    expect(f.feature.tagsByTrackId.value.size).toBe(0)
    expect(f.feature.tagsByPlaylistId.value.size).toBe(0)
    expect(() => f.feature.addTag(track, '迟到')).toThrow('未启用')
    expect(f.storage.read('plugin:feature.tags:v1')).toEqual(namespace)
    f.enabled.value = true
    await settle()
    expect(f.feature.records.value[0]?.customTags).toEqual(['用户标签'])
    expect(f.feature.tagsByPlaylistId.value.get('playlist')).toEqual(['歌单标签'])
    expect(() => oldActions.addTag(track, '旧确认')).toThrow('停用')
    expect(() => oldActions.addPlaylistTag('playlist', '旧确认')).toThrow('停用')
    expect(f.data.writes).toHaveLength(count)
    f.scope.stop()
  })
  it('isolates a failed lazy import and allows retry with the same data and core records', async () => {
    const loader = vi
      .fn<() => Promise<TagManagementImplementation>>()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValue(implementation)
    const f = fixture(loader)
    await settle()
    expect(f.feature.error.value).toBeDefined()
    expect(f.feature.available.value).toBe(false)
    const before = f.storage.snapshot()
    await f.feature.retry()
    expect(f.feature.available.value).toBe(true)
    expect(f.feature.error.value).toBeUndefined()
    expect(f.storage.snapshot()).toEqual(before)
    f.scope.stop()
  })
  it('rejects a late loader after disable/unmount and isolates a future namespace schema', async () => {
    let resolve!: (value: TagManagementImplementation) => void
    const f = fixture(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    f.enabled.value = false
    resolve(implementation)
    await settle()
    expect(f.feature.available.value).toBe(false)
    const data = f.storage.snapshot()
    data.namespaces = data.namespaces.map((entry) =>
      entry.pluginId === 'feature.tags' ? { ...entry, schemaVersion: 99 } : entry,
    )
    f.storage.replace(data, f.storage.revision())
    const future = createProductGenerationStorage(f.data.raw, options)
    f.scope.stop()
    expect(() => future.read('plugin:feature.tags:v1')).toThrow('Unsupported')
    expect(future.read('local-library:v1')).toBeDefined()
  })
})
