<script setup lang="ts">
import { onErrorCaptured, shallowRef } from 'vue'

const props = defineProps<{ generation: number }>()
const emit = defineEmits<{ failure: [generation: number, error: unknown] }>()
defineSlots<{ default(): unknown }>()
const failed = shallowRef(false)
onErrorCaptured((error) => {
  failed.value = true
  emit('failure', props.generation, error)
  return false
})
</script>

<template>
  <slot v-if="!failed" />
</template>
