<script setup lang="ts">
import type {
  UiMusicSourcePickerDialogProps,
  UiMusicSourcePickerDialogEmits,
} from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, shallowRef, useId, watch } from 'vue'

/** 只投影已启用平台；可用性检测与切换结果仍由运行端处理。 */
const props = defineProps<UiMusicSourcePickerDialogProps>()
const emit = defineEmits<UiMusicSourcePickerDialogEmits>()
const query = shallowRef('')
const searchId = `${useId()}-source-search`
const normalizedQuery = computed(() => query.value.normalize('NFKC').trim().toLowerCase())
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) query.value = ''
  },
)
const groups = computed(() =>
  [
    { label: '内置音乐源', sources: props.builtInSources },
    { label: '自定义音乐源', sources: props.externalSources },
  ]
    .map((group) => ({
      label: group.label,
      sources: group.sources.filter((source) =>
        `${source.name} ${source.id}`
          .normalize('NFKC')
          .toLowerCase()
          .includes(normalizedQuery.value),
      ),
    }))
    .filter((group) => group.sources.length > 0),
)
function selectSource(sourceId: string): void {
  // 重选当前项只关闭弹窗，避免重复会话刷新或外部服务探测。
  if (sourceId !== props.activeSourceId) emit('select', sourceId)
  emit('close')
}
</script>

<template>
  <AppDialog
    :open="props.open"
    :suspended="props.suspended"
    title="选择音乐平台"
    size="compact"
    initial-focus-selector="[data-source-search]"
    @close="emit('close')"
  >
    <div class="music-source-picker">
      <form class="music-source-picker__search" role="search" @submit.prevent>
        <label :for="searchId" class="music-source-picker__search-label">搜索音乐平台</label>
        <span class="music-source-picker__input-control">
          <input
            :id="searchId"
            v-model="query"
            class="music-source-picker__search-input"
            data-source-search
            type="search"
            inputmode="search"
            autocomplete="off"
            placeholder="输入平台名称"
          />
        </span>
      </form>
      <section
        v-for="group in groups"
        :key="group.label"
        class="music-source-picker__group"
        :aria-label="group.label"
      >
        <h3 class="music-source-picker__heading">{{ group.label }}</h3>
        <button
          v-for="source in group.sources"
          :key="source.id"
          class="music-source-picker__option"
          type="button"
          :aria-pressed="source.id === props.activeSourceId"
          @click="selectSource(source.id)"
        >
          <span class="music-source-picker__name">{{ source.name }}</span>
          <span v-if="source.id === props.activeSourceId" class="music-source-picker__state">
            <AppIcon name="check" :size="18" />
            已选
          </span>
        </button>
      </section>
      <p v-if="groups.length === 0" class="music-source-picker__empty" role="status">
        {{ normalizedQuery ? '没有匹配的音乐平台。' : '暂无已启用的音乐平台。' }}
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.music-source-picker,
.music-source-picker__group {
  display: grid;
  gap: var(--am-space-2);
}
.music-source-picker {
  gap: var(--am-space-5);
}
.music-source-picker__search {
  display: grid;
  gap: var(--am-space-2);
}
.music-source-picker__search-label {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
/* 与筛选器输入保持同样的底线和焦点反馈，输入不会触发来源探测。 */
.music-source-picker__input-control {
  position: relative;
  display: block;
  min-inline-size: 0;
}
.music-source-picker__input-control::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3px;
  background: var(--am-color-primary);
  pointer-events: none;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--am-motion-slow) var(--am-ease-standard);
}
.music-source-picker__input-control:focus-within::after {
  transform: scaleX(1);
}
@starting-style {
  .music-source-picker__input-control:focus-within::after {
    transform: scaleX(0);
  }
}
.music-source-picker__search-input {
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 52px;
  padding: var(--am-space-2) 0;
  border: 0;
  border-block-end: 1px solid var(--am-color-border-strong);
  border-radius: 0;
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  font-size: var(--am-font-size-xl);
}
.music-source-picker__search-input:focus,
.music-source-picker__search-input:focus-visible {
  outline: none;
  box-shadow: none;
}
.music-source-picker__heading,
.music-source-picker__empty {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.music-source-picker__option {
  display: flex;
  min-block-size: 48px;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  text-align: start;
  touch-action: manipulation;
}
.music-source-picker__name {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.music-source-picker__option:hover,
.music-source-picker__option[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
.music-source-picker__option:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.music-source-picker__state {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--am-space-1);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
}
@media (prefers-reduced-motion: reduce) {
  .music-source-picker__input-control::after {
    transition: none;
  }
}
</style>
