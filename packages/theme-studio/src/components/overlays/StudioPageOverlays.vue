<script setup lang="ts">
import { useStudioOverlays } from '../../composables/use-studio-overlays'

const props = defineProps<{ open: boolean; target?: HTMLElement | null }>()
defineSlots<{ default(): unknown }>()
const overlays = useStudioOverlays(() => props.open)
</script>

<template>
  <Teleport v-if="target ?? overlays?.target.value" :to="(target ?? overlays?.target.value)!"
    ><slot
  /></Teleport>
  <slot v-else />
</template>
