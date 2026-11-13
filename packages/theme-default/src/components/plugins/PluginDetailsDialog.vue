<script setup lang="ts">
import { getPluginRuntimeStatusLabel, PLUGIN_DEVELOPMENT_STATUS_LABELS } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { UiPluginCenterItem } from '@any-music/ui/theme'
import { computed } from 'vue'

import { pluginFailure } from '../../composables/plugin-presentation'

const props = defineProps<{ item?: UiPluginCenterItem; busy: boolean }>()
defineEmits<{ close: []; setEnabled: [enabled: boolean]; retry: []; manage: [] }>()
const failure = computed(() => props.item && pluginFailure(props.item))
</script>

<template>
  <AppDialog
    :open="!!item"
    :title="item?.name ?? '插件介绍'"
    description="插件介绍"
    size="compact"
    @close="$emit('close')"
  >
    <section v-if="item" class="plugin-details" aria-label="插件介绍">
      <div class="plugin-details__identity">
        <span class="plugin-details__icon"
          ><AppIcon :name="item.category === '音乐源' ? 'music' : 'plugin'" :size="28"
        /></span>
        <div>
          <strong>{{ item.name }}</strong
          ><small
            >{{ item.category }} · {{ item.origin === 'builtin' ? '内置插件' : '外置插件' }}</small
          >
        </div>
      </div>
      <p class="plugin-details__description">{{ item.description }}</p>
      <dl class="plugin-details__metadata">
        <div v-if="item.origin === 'builtin'">
          <dt>开发者状态</dt>
          <dd>{{ PLUGIN_DEVELOPMENT_STATUS_LABELS[item.developmentStatus ?? 'stable'] }}</dd>
        </div>
        <div>
          <dt>运行状态</dt>
          <dd>{{ getPluginRuntimeStatusLabel(item) }}</dd>
        </div>
        <div v-if="item.publisher">
          <dt>发布者</dt>
          <dd>{{ item.publisher }}</dd>
        </div>
        <div v-if="item.generation !== undefined">
          <dt>代次</dt>
          <dd>{{ item.generation }}</dd>
        </div>
      </dl>
      <p v-if="failure" class="plugin-details__error" role="alert">{{ failure }}</p>
    </section>
    <template #footer>
      <div v-if="item" class="plugin-details__actions">
        <button v-if="failure" type="button" :disabled="busy" @click="$emit('retry')">
          <AppIcon name="refresh" :size="16" />重试加载
        </button>
        <button
          v-if="item.origin === 'builtin'"
          type="button"
          :disabled="busy"
          :aria-disabled="!!item.unavailableReason"
          :title="item.unavailableReason"
          @click="$emit('setEnabled', !item.enabled)"
        >
          {{ item.enabled ? '停用插件' : '启用插件' }}
        </button>
        <button
          v-else
          type="button"
          :disabled="busy"
          aria-haspopup="dialog"
          @click="$emit('manage')"
        >
          管理插件<AppIcon name="arrow-right" :size="16" />
        </button>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.plugin-details {
  display: grid;
  gap: var(--am-space-5);
}
.plugin-details__identity {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  min-inline-size: 0;
}
.plugin-details__icon {
  display: grid;
  inline-size: 52px;
  block-size: 52px;
  place-items: center;
  flex: none;
  border-radius: var(--am-radius-card);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.plugin-details__identity > div {
  display: grid;
  gap: var(--am-space-1);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.plugin-details__identity small,
.plugin-details__metadata dt {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.plugin-details__description,
.plugin-details__error {
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.plugin-details__metadata {
  display: grid;
  gap: var(--am-space-3);
  margin: 0;
  font-size: var(--am-font-size-sm);
}
.plugin-details__metadata > div {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--am-space-3);
  align-items: baseline;
}
.plugin-details__metadata dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.plugin-details__error {
  color: var(--am-color-danger);
}
.plugin-details__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--am-space-3);
}
.plugin-details__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  cursor: pointer;
}
.plugin-details__actions button:last-child {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.plugin-details__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plugin-details__actions button:hover:enabled {
  filter: brightness(0.95);
}
.plugin-details__actions button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
