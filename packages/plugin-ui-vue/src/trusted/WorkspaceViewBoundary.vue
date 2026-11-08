<script setup lang="ts">
import { onErrorCaptured, shallowRef } from 'vue'
defineSlots<{ default(): unknown }>()
const failed = shallowRef(false)
onErrorCaptured(() => {
  failed.value = true
  return false
})
</script>
<template>
  <section v-if="failed" role="alert" data-am-host-surface="view-recovery">
    <p>此页面暂时不可用，其他功能仍可使用。</p>
    <button type="button" @click="failed = false">重试页面</button>
  </section>
  <slot v-else />
</template>
