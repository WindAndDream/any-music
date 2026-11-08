<script setup lang="ts">
import { resolveCardStyle, useCardPresentation } from '@any-music/card-styles/vue'
import type { Track } from '@any-music/core'
import type { CollectionItemStyle } from '@any-music/ui/library'
const props = defineProps<{
  itemStyle?: CollectionItemStyle
  track: Track
  title: string
  invalid?: boolean
  selected?: boolean
  selectable?: boolean
  detail?: string
  customTags?: readonly string[]
  focusId?: string
  selectionDescription?: string
  reorderable?: boolean
  readonly?: boolean
  selectionOnly?: boolean
  disabled?: boolean
}>()
defineEmits<{
  play: []
  select: []
  actions: []
  coverPress: [event: PointerEvent]
  shift: [direction: -1 | 1]
  cancelDrag: []
}>()
const { active, playing, progress, resume, pause } = useCardPresentation(() => props.track.id)
</script>
<template>
  <component
    :is="resolveCardStyle('track', itemStyle ?? 'minimal')"
    v-bind="$props"
    :active="active"
    :playing="playing"
    :progress="progress"
    @play="active ? resume() : $emit('play')"
    @pause="pause"
    @select="$emit('select')"
    @actions="$emit('actions')"
    @cover-press="$emit('coverPress', $event)"
    @shift="$emit('shift', $event)"
    @cancel-drag="$emit('cancelDrag')"
  />
</template>
