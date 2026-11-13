<script setup lang="ts">
import type { PluginCenterDisplay } from '../../composables/plugins/use-plugin-center-view'
import AppIcon from '../AppIcon.vue'

defineProps<{ display: PluginCenterDisplay }>()
const emit = defineEmits<{ select: [display: PluginCenterDisplay] }>()
const options = [
  {
    id: 'grid',
    icon: 'library',
    label: '卡片',
    description: '按卡片浏览插件，列数随可用宽度调整。',
  },
  { id: 'list', icon: 'list', label: '列表', description: '逐行查看插件，适合快速整理与管理。' },
] as const
</script>

<template>
  <div class="plugin-display-options" role="group" aria-label="插件展示方式">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :aria-pressed="display === option.id"
      @click="emit('select', option.id)"
    >
      <AppIcon :name="option.icon" :size="24" />
      <span
        ><strong>{{ option.label }}</strong
        ><small>{{ option.description }}</small></span
      >
      <AppIcon v-if="display === option.id" name="check" :size="18" />
    </button>
  </div>
</template>

<style scoped>
.plugin-display-options {
  display: grid;
  gap: var(--am-space-3);
}
.plugin-display-options button {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 76px;
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  text-align: start;
  cursor: pointer;
}
.plugin-display-options button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
}
.plugin-display-options button:hover {
  border-color: var(--am-color-primary);
}
.plugin-display-options button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.plugin-display-options span {
  display: grid;
  flex: 1;
  gap: var(--am-space-1);
}
.plugin-display-options strong {
  font-size: var(--am-font-size-sm);
}
.plugin-display-options small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
</style>
