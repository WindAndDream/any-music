<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import StudioCollection from './StudioCollection.vue'
defineProps<{ feature: UiThemeFeatureMap['queue'] }>()
</script>
<template>
  <StudioCollection
    title="待听"
    scope="queue:tracks"
    :state="feature.state"
    :actions="feature.actions"
    :availability="feature.availability"
    :status="feature.status"
    :remove="feature.actions.remove"
    :reorder="feature.actions.reorder"
    :clear="feature.actions.clear"
  />
</template>
