<script setup lang="ts">
import { NavigationRail } from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'
import type { UiThemeFeatureMap, UiThemeForm } from '@any-music/ui/theme'
import { computed } from 'vue'

const props = defineProps<{ feature: UiThemeFeatureMap['navigation']; form?: UiThemeForm }>()
const items = computed(() =>
  props.feature.state.preferences.destinationOrder.flatMap((id) => {
    const destination = props.feature.state.destinations.find((entry) => entry.id === id)
    return destination && !props.feature.state.preferences.hiddenDestinationIds.includes(id)
      ? [destination]
      : []
  }),
)
function navigate(id: string): void {
  if (
    props.feature.availability.status === 'available' &&
    items.value.some((item) => item.id === id)
  )
    props.feature.actions.navigate(id as ProductViewId)
}
</script>

<template>
  <NavigationRail
    :items="items"
    :active-id="feature.state.activeViewId"
    :collapsed="form !== 'mobile' && feature.state.preferences.isSidebarCollapsed"
    :inert="feature.availability.status !== 'available' || undefined"
    @select="navigate"
  />
</template>
