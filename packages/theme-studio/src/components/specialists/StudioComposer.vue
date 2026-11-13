<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioCreationPage from './StudioCreationPage.vue'
defineProps<{ feature: UiThemeFeatureMap['composer'] }>()
</script>
<template>
  <section aria-label="素材合集与自定义音乐创作">
    <h1>创作工作室</h1>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" /><component
      v-if="feature.availability.status === 'available' && feature.state.Editor"
      :is="feature.state.Editor"
      v-slot="{ editor }"
      ><StudioCreationPage :editor="editor" /></component
    ><button v-if="feature.status.status === 'error'" type="button" @click="feature.actions.retry">
      重试创作功能
    </button>
  </section>
</template>
