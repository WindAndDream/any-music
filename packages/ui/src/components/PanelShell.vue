<script setup lang="ts">
/** 平台无关的音乐面板外壳，仅负责语义容器和内容组合。 */
interface Props {
  /** 为 section 提供可访问名称，不用于渲染可见标题。 */
  label?: string
}

withDefaults(defineProps<Props>(), {
  label: 'Any Music',
})

// 默认插槽由各应用填充播放器、搜索或歌词等功能区域。
defineSlots<{
  default?: () => unknown
}>()
</script>

<template>
  <!-- 组件不负责定位，悬浮位置和窗口布局由具体应用决定。 -->
  <section class="am-panel-shell" :aria-label="label">
    <slot />
  </section>
</template>
