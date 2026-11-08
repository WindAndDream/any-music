<script setup lang="ts">
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioTagPage from './StudioTagPage.vue'
defineProps<{ feature: UiThemeFeatureMap['tags'] }>()
</script>
<template>
  <section aria-label="标签管理">
    <h1>标签工作台</h1>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" /><component
      v-if="feature.availability.status === 'available' && feature.state.Editor"
      :is="feature.state.Editor"
      v-slot="{ editor }"
      ><StudioTagPage :editor="editor" /></component
    ><button v-if="feature.status.status === 'error'" type="button" @click="feature.actions.retry">
      重试标签功能
    </button>
  </section>
</template>
