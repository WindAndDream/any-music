<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import ClassicFeatureStatus from '../library/ClassicFeatureStatus.vue'
import MusicCreationPage from './MusicCreationPage.vue'

defineProps<{ feature: UiThemeFeatureMap['composer'] }>()
</script>

<template>
  <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
  <component
    v-if="feature.availability.status === 'available' && feature.state.Editor"
    :is="feature.state.Editor"
    v-slot="{ editor }"
  >
    <MusicCreationPage :editor="editor" />
  </component>
  <button v-if="feature.status.status === 'error'" type="button" @click="feature.actions.retry">
    重试创作功能
  </button>
</template>
