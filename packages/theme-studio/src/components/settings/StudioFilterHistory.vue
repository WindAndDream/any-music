<script setup lang="ts">
import { FILTER_HISTORY_SETTINGS_GROUPS, useCatalogFilterHistorySettings } from '@any-music/ui'
import { getCatalogFilterDimensions } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { onScopeDispose } from 'vue'
const props = defineProps<{ feature: UiThemeFeatureMap['settings'] }>()
let active = true
onScopeDispose(() => {
  active = false
})
const { regions, feedbackByContext, submitSettings } = useCatalogFilterHistorySettings({
  settings: () => props.feature.state.filterHistory,
  save: (value) => {
    if (
      active &&
      props.feature.state.open &&
      !props.feature.state.suspended &&
      props.feature.availability.status === 'available'
    )
      return props.feature.actions.setFilterHistory(value)
  },
})
</script>
<template>
  <div class="studio-settings-grid">
    <section v-for="group in FILTER_HISTORY_SETTINGS_GROUPS" :key="group.id">
      <h3>{{ group.title }}</h3>
      <form
        v-for="region in group.regions"
        :key="region.context"
        novalidate
        @submit.prevent="submitSettings(region.context)"
      >
        <h4>{{ region.title }}</h4>
        <p>{{ region.description }}</p>
        <label
          v-for="dimension in getCatalogFilterDimensions(region.context)"
          :key="dimension.id"
          class="studio-field"
          >{{ dimension.label }}保留数量<input
            v-model="regions[region.context].limits[dimension.id]"
            type="number"
            min="0"
            max="100"
            :data-am-focus-key="`settings:filter-history:${region.context}:${dimension.id}`" /></label
        ><label class="studio-field"
          >默认显示数量<input
            v-model="regions[region.context].collapseAfter"
            type="number"
            min="1"
            max="100"
        /></label>
        <p v-if="feedbackByContext[region.context].errorMessage" role="alert">
          {{ feedbackByContext[region.context].errorMessage }}
        </p>
        <p role="status">{{ feedbackByContext[region.context].statusMessage }}</p>
        <button type="submit">保存{{ region.title }}</button>
      </form>
    </section>
  </div>
</template>
