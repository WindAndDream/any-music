import { AppError, toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import type {
  MusicCreationHostPorts,
  MusicCreationImplementation,
  MusicCreationSession,
  MusicCreationState,
} from '@any-music/ui'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'

/** Host owns only lifecycle and named action wiring. Editing state remains inside the lazy plugin. */
export function useMusicCreation(
  runtime: Pick<WorkbenchRuntime, 'storage' | 'loadMusicCreation'>,
  isEnabled: () => boolean,
  ports: MusicCreationHostPorts,
  onWithdraw: () => void,
) {
  const implementation = shallowRef<MusicCreationImplementation>()
  const session = shallowRef<MusicCreationSession>()
  const revision = shallowRef(0)
  const generation = shallowRef(0)
  const error = shallowRef<AppErrorState>()
  const loading = shallowRef(false)
  let disposed = false
  async function load(): Promise<void> {
    const attempt = ++generation.value
    session.value?.dispose()
    session.value = undefined
    implementation.value = undefined
    loading.value = false
    onWithdraw()
    if (disposed || !isEnabled() || !runtime.loadMusicCreation) return
    loading.value = true
    error.value = undefined
    const isCurrent = () => !disposed && attempt === generation.value && isEnabled()
    try {
      const loaded = await runtime.loadMusicCreation()
      if (!isCurrent()) return
      const created = loaded.createSession({
        ...ports,
        read: () => runtime.storage.read('plugin:feature.composer:v1'),
        write: (value) => runtime.storage.write('plugin:feature.composer:v1', value),
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
      if (isCurrent())
        error.value = toAppErrorState(cause, 'invalid-input', '创作功能加载失败，数据已保留。')
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
    session.value = undefined
    implementation.value = undefined
    loading.value = false
    onWithdraw()
  })
  function current(): MusicCreationSession {
    if (!isEnabled() || !session.value) throw new AppError('conflict', '创作功能未启用或尚未就绪。')
    return session.value
  }
  return {
    generation,
    editing: computed(() => session.value?.editing),
    error,
    loading,
    retry: load,
    current,
    actions: computed(() => session.value),
    available: computed(() => isEnabled() && !!session.value),
    Composer: computed(() => implementation.value?.Composer),
    state: computed<MusicCreationState>(() => {
      void revision.value
      return isEnabled() && session.value
        ? session.value.snapshot()
        : { materialCollections: [], pendingMaterialTrackIds: [], materialCollectionByTrackId: {} }
    }),
  }
}
