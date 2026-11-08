<script setup lang="ts">
/** Collection headings, count badges and spacing share one presentation in every library page. */
withDefaults(
  defineProps<{
    title: string
    totalCount: number
    counts?: readonly { label: string; count: number }[]
    intro?: string
    showTitle?: boolean
    mobileLayout: boolean
    detail: boolean
    empty: boolean
    countUnit?: string
    showCount?: boolean
  }>(),
  { countUnit: '首', showCount: true },
)
defineSlots<{
  controls?: () => unknown
  header?: () => unknown
  headingActions?: () => unknown
  count?: () => unknown
  default?: () => unknown
}>()
</script>

<template>
  <div
    class="listen-queue__view"
    :class="{ 'listen-queue__view--detail': detail, 'listen-queue__view--empty': empty }"
  >
    <div class="listen-queue__surface">
      <header v-if="(!mobileLayout || showTitle) && !detail" class="listen-queue__header">
        <div class="listen-queue__intro">
          <h2 data-collection-focus tabindex="-1">
            {{ title
            }}<slot v-if="showCount" name="count">
              <span
                v-for="badge in counts ?? [{ label: '', count: totalCount }]"
                :key="badge.label"
                class="listen-queue__count"
                >{{ badge.label }}<strong>{{ badge.count }}</strong> {{ countUnit }}</span
              >
            </slot>
          </h2>
          <p v-if="intro">{{ intro }}</p>
        </div>
        <slot name="headingActions" />
      </header>
      <slot name="controls" />
      <div v-if="$slots.header" class="listen-queue__extra"><slot name="header" /></div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.listen-queue__view {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  min-inline-size: 0;
  padding: var(--am-queue-padding);
  padding-block-end: max(var(--am-queue-padding), var(--am-space-6));
  background: var(--am-color-background);
}
.listen-queue__view--detail {
  padding-block-start: 0;
}
.listen-queue__surface {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.listen-queue__view--detail .listen-queue__surface {
  padding-block: 0;
  background: transparent;
}
.listen-queue__view--detail :deep(.listen-queue__results) {
  /* Keep the sticky heading's gap outside the gray song surface, as in Discover. */
  flex: 1 0 auto;
  margin-inline: calc(-1 * var(--am-space-3));
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.listen-queue__header {
  margin-block-end: var(--am-space-3);
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: var(--am-space-4);
}
.listen-queue__intro {
  min-inline-size: 0;
  flex: 1 1 180px;
}
.listen-queue__intro h2 {
  /* 与歌曲页上下文共用标题行尺寸，徽标与标题垂直居中。 */
  display: flex;
  min-block-size: 44px;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-3);
  margin: 0 0 var(--am-space-2);
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
}
.listen-queue__count {
  display: inline-flex;
  align-items: baseline;
  gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  white-space: nowrap;
}
.listen-queue__count strong {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
}
.listen-queue__intro p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}

.listen-queue__view--empty :deep(.listen-queue__list) {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}
.listen-queue__extra {
  margin-block-end: var(--am-space-3);
}
</style>
