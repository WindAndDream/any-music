<script setup lang="ts">
import type { ProductViewId } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ feature: UiThemeFeatureMap['navigation'] }>()
const destinations = computed(() =>
  props.feature.state.preferences.destinationOrder.flatMap((id) => {
    const entry = props.feature.state.destinations.find((item) => item.id === id)
    return entry && !props.feature.state.preferences.hiddenDestinationIds.includes(id)
      ? [entry]
      : []
  }),
)
function navigate(id: ProductViewId): void {
  if (
    props.feature.availability.status === 'available' &&
    destinations.value.some((entry) => entry.id === id)
  )
    props.feature.actions.navigate(id)
}
</script>

<template>
  <nav class="studio-navigation" aria-label="功能导航" data-am-scroll-key="navigation">
    <button
      v-for="item in destinations"
      :key="item.id"
      type="button"
      :aria-current="item.id === feature.state.activeViewId ? 'page' : undefined"
      :data-am-focus-key="`navigation:${item.id}`"
      :disabled="feature.availability.status !== 'available'"
      @click="navigate(item.id)"
    >
      <AppIcon :name="item.icon" />{{ item.label }}
    </button>
  </nav>
</template>
