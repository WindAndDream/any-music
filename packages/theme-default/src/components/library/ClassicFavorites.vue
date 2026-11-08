<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import ClassicTrackCollection from './ClassicTrackCollection.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['favorites'] }>()
function remove(ids: readonly string[]) {
  for (const id of ids)
    if (props.feature.state.favoriteTrackIds.includes(id))
      void props.feature.actions.toggleFavorite(id)
}
</script>
<template>
  <ClassicTrackCollection
    title="我的喜欢"
    scope="favorites:tracks"
    :state="feature.state"
    :current-track-id="feature.state.currentTrackId"
    :actions="feature.actions"
    :availability="feature.availability"
    :status="feature.status"
    :collection="feature"
    :remove="remove"
  />
</template>
