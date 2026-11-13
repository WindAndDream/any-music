<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

import { appIconPaths } from './app-icon'
import type { AppIconName } from './app-icon'

interface Props {
  /** 内置图标名称；不接受任意 HTML 或远程图标。 */
  name: AppIconName
  /** CSS 长度或以像素为单位的数字。 */
  size?: number | string
  /** 仅在图标独立表达含义时提供；装饰图标保持未定义。 */
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 20,
  title: undefined,
})

const paths = computed(() => appIconPaths[props.name])
const iconStyle = computed<CSSProperties>(() => ({
  width: typeof props.size === 'number' ? `${props.size}px` : props.size,
  height: typeof props.size === 'number' ? `${props.size}px` : props.size,
}))
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :style="iconStyle"
    :role="props.title ? 'img' : undefined"
    :aria-label="props.title"
    :aria-hidden="props.title ? undefined : 'true'"
    focusable="false"
  >
    <path v-for="path in paths" :key="path" :d="path" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: block;
  flex: none;
  overflow: visible;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  vector-effect: non-scaling-stroke;
}
</style>
