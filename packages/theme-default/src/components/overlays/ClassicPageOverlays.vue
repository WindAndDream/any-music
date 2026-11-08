<script setup lang="ts">
import { useClassicOverlays } from '../../composables/use-classic-overlays'
const props = defineProps<{
  modalOpen?: boolean
  operatorOpen?: boolean
  modalTarget?: HTMLElement | null
}>()
defineSlots<{
  default?(): unknown
  operator?(): unknown
  toolbar?(): unknown
  source?(): unknown
}>()
const overlays = useClassicOverlays(
  () => Boolean(props.modalOpen),
  () => Boolean(props.operatorOpen),
)
</script>
<template>
  <Teleport
    v-if="modalTarget ?? overlays?.modalTarget.value"
    :to="(modalTarget ?? overlays?.modalTarget.value)!"
    ><slot
  /></Teleport>
  <slot v-else />
  <Teleport v-if="overlays?.operatorTarget.value" :to="overlays.operatorTarget.value"
    ><slot name="operator"
  /></Teleport>
  <slot v-else name="operator" />
  <Teleport v-if="overlays?.toolbarTarget.value" :to="overlays.toolbarTarget.value"
    ><slot name="toolbar"
  /></Teleport>
  <slot v-else name="toolbar" />
  <Teleport v-if="overlays?.sourceTarget.value" :to="overlays.sourceTarget.value"
    ><slot name="source"
  /></Teleport>
  <slot v-else name="source" />
</template>
