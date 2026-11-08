<script setup lang="ts">
defineOptions({ name: 'FeatureModuleLoading' })
</script>

<template>
  <div class="feature-module-status" role="status" aria-live="polite">
    <span class="feature-module-status__spinner" aria-hidden="true"></span>
    <strong>正在加载功能模块</strong>
    <small>只会在首次使用该功能时执行对应代码。</small>
  </div>
</template>
