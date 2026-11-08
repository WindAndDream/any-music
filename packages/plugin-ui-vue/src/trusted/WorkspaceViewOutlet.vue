<script setup lang="ts">
import { shallowRef, watch } from 'vue'

import WorkspaceViewBoundary from './WorkspaceViewBoundary.vue'
const props = defineProps<{
  views: readonly { id: string; implementationId: string }[]
  activeId: string
}>()
defineSlots<{ [implementationId: string]: (context: { active: boolean }) => unknown }>()
const visited = shallowRef<ReadonlySet<string>>(new Set())
watch(
  () => [props.activeId, props.views] as const,
  () => {
    const current = props.views.find((view) => view.id === props.activeId)
    if (current && !visited.value.has(current.id))
      visited.value = new Set([...visited.value, current.id])
  },
  { immediate: true },
)
</script>
<template>
  <template v-for="view in props.views" :key="view.id">
    <WorkspaceViewBoundary v-if="visited.has(view.id)">
      <slot :name="view.implementationId" :active="view.id === props.activeId" />
    </WorkspaceViewBoundary>
  </template>
</template>
