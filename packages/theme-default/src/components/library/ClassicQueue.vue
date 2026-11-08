<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import ClassicTrackCollection from './ClassicTrackCollection.vue'

defineProps<{ feature: UiThemeFeatureMap['queue'] }>()
</script>
<template>
  <ClassicTrackCollection
    title="待听"
    scope="queue:tracks"
    :state="feature.state"
    :actions="feature.actions"
    :availability="feature.availability"
    :status="feature.status"
    :collection="feature"
    :current-track-id="feature.state.currentTrackId"
    :remove="feature.actions.remove"
    :reorder="feature.actions.reorder"
  />
</template>
