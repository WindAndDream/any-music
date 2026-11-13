<script setup lang="ts">
import { usePresentationContinuity } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { inject, useTemplateRef } from 'vue'

import { studioVirtualFavoritesCanaryKey } from '../../composables/studio-virtual-favorites-canary'
import StudioCollection from './StudioCollection.vue'
import StudioFavoriteFilters from './StudioFavoriteFilters.vue'
const props = defineProps<{ feature: UiThemeFeatureMap['favorites'] }>()
const virtualized = inject(studioVirtualFavoritesCanaryKey, false)
const platforms = useTemplateRef<HTMLElement>('platforms')
usePresentationContinuity({
  element: platforms,
  region: 'favorites:platforms',
  scrollElement: () => {
    const content = platforms.value?.closest<HTMLElement>('.studio-content')
    const desk = content?.closest<HTMLElement>('.studio-desk')
    return desk && desk.scrollHeight > desk.clientHeight ? desk : (content ?? null)
  },
})
function move(id: string, offset: -1 | 1) {
  if (props.feature.availability.status !== 'available') return
  const ids = [...props.feature.state.platformOrder],
    index = ids.indexOf(id),
    next = index + offset
  if (index < 0 || next < 0 || next >= ids.length) return
  ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
  props.feature.actions.reorderPlatforms(ids)
}
function remove(ids: readonly string[]) {
  for (const id of ids)
    if (props.feature.state.favoriteTrackIds.includes(id))
      void props.feature.actions.toggleFavorite(id)
}
</script>
<template>
  <StudioCollection
    title="我的喜欢"
    :virtualized="virtualized"
    scope="favorites:tracks"
    :state="feature.state"
    :actions="feature.actions"
    :availability="feature.availability"
    :status="feature.status"
    :remove="remove"
  >
    <template #header
      ><button
        type="button"
        :disabled="feature.availability.status !== 'available'"
        @click="
          feature.actions.setFavoriteFilterDraft({
            ...feature.state.favoriteFilters,
            selectedPlatformIds: [...feature.state.favoriteFilters.selectedPlatformIds],
          })
        "
      >
        喜欢筛选
      </button>
      <ol ref="platforms" class="studio-platform-order">
        <li
          v-for="(id, index) in feature.state.platformOrder"
          :key="id"
          :data-am-continuity-item="id"
          :data-am-focus-key="`platform:${id}:open`"
          tabindex="-1"
        >
          {{ feature.state.platformNames.get(id) ?? id
          }}<button
            type="button"
            :aria-label="`上移平台 ${id}`"
            :data-am-focus-key="`platform:${id}:reorder`"
            :disabled="index === 0"
            @click="move(id, -1)"
          >
            上移</button
          ><button
            type="button"
            :aria-label="`下移平台 ${id}`"
            :data-am-focus-key="`platform:${id}:reorder-down`"
            :data-am-focus-restore-key="`platform:${id}:reorder`"
            :disabled="index === feature.state.platformOrder.length - 1"
            @click="move(id, 1)"
          >
            下移
          </button>
        </li>
      </ol></template
    >
  </StudioCollection>
  <StudioFavoriteFilters v-if="feature.availability.status === 'available'" :feature="feature" />
</template>
