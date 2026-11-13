<script setup lang="ts">
defineProps<{
  tags: readonly string[]
  singleLine?: boolean
  label?: string
}>()
</script>

<template>
  <span
    class="track-tag-list"
    :class="{ 'track-tag-list--single-line': singleLine }"
    role="list"
    :aria-label="label ?? '歌曲标签'"
  >
    <span v-for="tag in tags" :key="tag" class="track-tag-list__tag" role="listitem">{{
      tag
    }}</span>
  </span>
</template>

<style scoped>
.track-tag-list {
  display: flex;
  min-inline-size: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.track-tag-list__tag {
  display: inline-flex;
  flex: 0 0 auto;
  min-inline-size: 0;
  max-inline-size: 100%;
  min-block-size: 28px;
  align-items: center;
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
  overflow-wrap: anywhere;
}

/* 摘要只占一行；完整标签在只读弹窗中换行展示。 */
.track-tag-list--single-line {
  flex-wrap: nowrap;
  overflow: hidden;
}

.track-tag-list--single-line .track-tag-list__tag {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
