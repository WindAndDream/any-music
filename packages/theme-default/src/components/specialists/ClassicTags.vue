<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import ClassicFeatureStatus from '../library/ClassicFeatureStatus.vue'
import TagManagementPage from './TagManagementPage.vue'

defineProps<{ feature: UiThemeFeatureMap['tags']; mobileLayout?: boolean }>()
</script>

<template>
  <ClassicFeatureStatus :availability="feature.availability" :status="feature.status" />
  <component
    v-if="feature.availability.status === 'available' && feature.state.Editor"
    :is="feature.state.Editor"
    v-slot="{ editor }"
  >
    <TagManagementPage :editor="editor" :mobile-layout="mobileLayout" />
  </component>
  <button v-if="feature.status.status === 'error'" type="button" @click="feature.actions.retry">
    重试标签功能
  </button>
</template>
