import { AppError, toAppErrorState } from '@any-music/core'
import type { AppErrorState, LibraryTrackRecord, Track } from '@any-music/core'
import type { TagManagementImplementation, TagManagementSession } from '@any-music/ui'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'

/** Host adapter: the plugin receives only its namespace and a named track-retention action. */
export function useTagManagement(
  runtime: Pick<WorkbenchRuntime, 'storage' | 'loadTagManagement'>,
  isEnabled: () => boolean,
  records: () => readonly LibraryTrackRecord[],
  rememberTracks: (tracks: readonly Track[]) => void,
) {
  const implementation = shallowRef<TagManagementImplementation>()
  const session = shallowRef<TagManagementSession>()
  const revision = shallowRef(0)
  const error = shallowRef<AppErrorState>()
  const loading = shallowRef(false)
  const generation = shallowRef(0)
  let disposed = false
  async function load(): Promise<void> {
    const attempt = ++generation.value
    session.value?.dispose()
    session.value = undefined
    implementation.value = undefined
    loading.value = false
    if (disposed || !isEnabled() || !runtime.loadTagManagement) return
    loading.value = true
    error.value = undefined
    const isCurrent = () => !disposed && attempt === generation.value && isEnabled()
    try {
      const loaded = await runtime.loadTagManagement()
      if (!isCurrent()) return
      const created = loaded.createSession({
        read: () => runtime.storage.read('plugin:feature.tags:v1'),
        write: (value) => runtime.storage.write('plugin:feature.tags:v1', value),
        rememberTracks,
        changed: () => {
          revision.value++
        },
        isCurrent,
      })
      if (!isCurrent()) {
        created.dispose()
        return
      }
      implementation.value = loaded
      session.value = created
    } catch (cause) {
      if (isCurrent()) error.value = toAppErrorState(cause, 'invalid-input', '标签功能加载失败。')
    } finally {
      if (attempt === generation.value) loading.value = false
    }
  }
  watch(
    isEnabled,
    () => {
      void load()
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(() => {
    disposed = true
    generation.value++
    session.value?.dispose()
  })
  function current(): TagManagementSession {
    if (!isEnabled() || !session.value) throw new AppError('conflict', '标签功能未启用或尚未就绪。')
    return session.value
  }
  const tagNames = computed(() => {
    void revision.value
    return isEnabled() && session.value ? session.value.tagNames() : []
  })
  return {
    generation,
    editing: computed(() => session.value?.editing),
    actions: computed(() => session.value),
    available: computed(() => isEnabled() && !!session.value),
    Panel: computed(() => implementation.value?.Panel),
    tagDefinitions: computed(() => {
      void revision.value
      return isEnabled() && session.value ? session.value.tagDefinitions() : []
    }),
    error,
    loading,
    retry: load,
    tagInputOptions: (tracks: readonly Track[]) => {
      void revision.value
      const tags = session.value?.tagsByTrackId()
      return tagNames.value.map((value) => {
        const key = value.normalize('NFKC').trim().toLocaleLowerCase()
        return {
          value,
          selected:
            tracks.length > 0 &&
            tracks.every((track) =>
              tags
                ?.get(track.id)
                ?.some((name) => name.normalize('NFKC').trim().toLocaleLowerCase() === key),
            ),
        }
      })
    },
    records: computed(() => {
      void revision.value
      return isEnabled() && session.value
        ? session.value.project(records())
        : records().map((record) => Object.assign({}, record, { customTags: [] }))
    }),
    tagsByTrackId: computed(() => {
      void revision.value
      return isEnabled() && session.value
        ? session.value.tagsByTrackId()
        : new Map<string, readonly string[]>()
    }),
    tagsByPlaylistId: computed(() => {
      void revision.value
      return isEnabled() && session.value
        ? session.value.tagsByPlaylistId()
        : new Map<string, readonly string[]>()
    }),
    addTag: (track: Track, tag: string) => current().addTag(track, tag),
    addTags: (tracks: readonly Track[], tag: string) => current().addTags(tracks, tag),
    removeTag: (track: Track, tag: string) => current().removeTag(track, tag),
    renameTag: (tag: string, next: string) => current().renameTag(tag, next),
    deleteTag: (tag: string) => current().deleteTag(tag),
    deleteTags: (tags: readonly string[]) => current().deleteTags(tags),
    mergeTags: (tags: readonly string[], target: string) => current().mergeTags(tags, target),
  }
}
