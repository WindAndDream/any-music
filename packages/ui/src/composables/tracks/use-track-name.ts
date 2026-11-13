import type { Track } from '@any-music/core'
import { computed, inject, provide, toValue } from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

type TrackNamesSource = MaybeRefOrGetter<ReadonlyMap<string, string>>
const trackNamesKey: InjectionKey<TrackNamesSource> = Symbol('any-music-track-names')
const emptyNames: ReadonlyMap<string, string> = new Map()

/** 跨列表、资料库和播放器共享名称展示；数据与持久化始终由运行端拥有。 */
export function provideTrackNames(source: TrackNamesSource): void {
  provide(trackNamesKey, source)
}

export function useTrackNames() {
  const source = inject(trackNamesKey, emptyNames)
  const customNamesByTrackId = computed(() => toValue(source))
  function getDisplayName(track: Track): string {
    return customNamesByTrackId.value.get(track.id) || track.title
  }
  return { customNamesByTrackId, getDisplayName }
}

export function useTrackName(track: MaybeRefOrGetter<Track | undefined>) {
  const { customNamesByTrackId } = useTrackNames()
  const customName = computed(() => {
    const current = toValue(track)
    return current ? customNamesByTrackId.value.get(current.id) : undefined
  })
  const displayName = computed(() => customName.value || toValue(track)?.title)
  return { customName, displayName }
}
