<script setup lang="ts">
/** 集合入口按实际内容宽度排列，供平台与歌单卡片共用；窄于理想列宽时自然单列。 */
defineSlots<{ default(): unknown }>()
</script>

<template>
  <div class="collection-grid"><slot /></div>
</template>

<style scoped>
.collection-grid {
  /* 固定 CSS 像素基准，避免 Userscript 宿主页根字号改变理想列宽。 */
  --am-collection-card-width: 320px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--am-collection-card-width)), 1fr));
  align-items: stretch;
  gap: var(--am-space-4);
  min-inline-size: 0;
}
</style>
