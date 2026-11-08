<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'FeatureModuleLoadError' })

const props = defineProps<{
  error?: Error
}>()

const emit = defineEmits<{
  retry: []
}>()

const errorMessage = computed(() => props.error?.message || '功能模块加载失败，请稍后重新打开。')
</script>

<template>
  <div class="feature-module-error" role="alert">
    <strong>功能暂时不可用</strong>
    <small>{{ errorMessage }}</small>
    <button type="button" @click="emit('retry')">重新加载</button>
  </div>
</template>
