import type { CollectionItemStyle } from '@any-music/ui/library'
import { computed, inject, provide } from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'

import { playbackProgress } from './index'

interface CardPresentation {
  itemStyle: () => CollectionItemStyle
  player: () => {
    readonly track: { readonly id: string } | null
    readonly playing: boolean
    readonly positionMs: number
    readonly durationMs: number
  }
  actions: {
    play: () => void | Promise<void>
    pause: () => void
  }
}
const key: InjectionKey<CardPresentation> = Symbol('collection-card-presentation')

/** A complete root supplies readonly player inputs and bound intents, without business owners. */
export function provideCardPresentation(value: CardPresentation): void {
  provide(key, value)
}

export function useCardPresentation(trackId: MaybeRefOrGetter<string>) {
  const presentation = inject(key, null)
  const itemStyle = computed(() => presentation?.itemStyle() ?? 'default')
  const active = computed(() => presentation?.player().track?.id === toValue(trackId))
  const playing = computed(() => active.value && Boolean(presentation?.player().playing))
  const progress = computed(() => {
    if (!active.value || !presentation) return 0
    const player = presentation.player()
    return playbackProgress(player.positionMs, player.durationMs)
  })
  function resume() {
    if (active.value && !playing.value) return presentation?.actions.play()
  }
  function pause() {
    if (playing.value) presentation?.actions.pause()
  }
  return { itemStyle, active, playing, progress, resume, pause }
}
