<script setup lang="ts">
defineProps<{ image: string }>()
const emit = defineEmits<{ error: [] }>()
</script>
<template>
  <div v-if="image">
    <img
      :src="image"
      width="240"
      height="240"
      alt="平台登录二维码"
      referrerpolicy="no-referrer"
      @error="emit('error')"
    />
    <p>请用另一台设备扫码并在平台客户端确认。</p>
  </div>
</template>

<style scoped>
img {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
  background: white;
  border-radius: var(--am-radius-control);
}
p {
  margin: var(--am-space-3) 0 0;
  font-size: var(--am-font-size-xs);
  line-height: 1.7;
  color: var(--am-color-text-secondary);
}
</style>
