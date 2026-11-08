<script setup lang="ts">
import type { MusicSourceAvailability, MusicSourceDescriptor } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { useId } from 'vue'

/** 音乐源开关和检测保持受控，界面展示不会触发平台登录或网络请求。 */
const props = defineProps<{
  groups: readonly {
    id: string
    title: string
    plugins: readonly { readonly descriptor: MusicSourceDescriptor }[]
  }[]
  enabledPluginIds: readonly string[]
  availabilityByPluginId: Readonly<Record<string, MusicSourceAvailability>>
}>()
const emit = defineEmits<{
  setPluginEnabled: [pluginId: string, isEnabled: boolean]
  checkPlugin: [pluginId: string]
}>()
const settingsId = useId()

function getAvailabilityLabel(pluginId: string): string {
  const status = props.availabilityByPluginId[pluginId]?.status ?? 'unchecked'
  return {
    available: '可用',
    checking: '检测中',
    invalid: '已失效',
    unavailable: '连接失败',
    unchecked: '未检测',
  }[status]
}
</script>

<template>
  <div class="source-settings settings-sections">
    <section
      v-for="group in props.groups"
      :key="group.id"
      class="settings-form__card source-settings__group"
      :aria-labelledby="`${settingsId}-${group.id}`"
    >
      <div class="source-settings__heading">
        <h4 :id="`${settingsId}-${group.id}`">{{ group.title }}</h4>
        <span class="source-settings__count">{{ group.plugins.length }} 个</span>
      </div>
      <p v-if="group.plugins.length === 0" class="source-settings__empty">暂无音乐源。</p>
      <ul v-else class="source-settings__list">
        <li
          v-for="plugin in group.plugins"
          :key="plugin.descriptor.id"
          class="source-settings__row"
        >
          <div class="source-settings__copy">
            <div class="source-settings__identity">
              <strong>{{ plugin.descriptor.name }}</strong>
              <span
                class="source-settings__status"
                :data-status="
                  props.availabilityByPluginId[plugin.descriptor.id]?.status ?? 'unchecked'
                "
                >{{ getAvailabilityLabel(plugin.descriptor.id) }}</span
              >
            </div>
            <small>{{ plugin.descriptor.description ?? plugin.descriptor.id }}</small>
          </div>
          <div class="source-settings__actions">
            <button
              class="settings-switch"
              type="button"
              role="switch"
              :aria-label="`启用${plugin.descriptor.name}`"
              :aria-checked="props.enabledPluginIds.includes(plugin.descriptor.id)"
              :disabled="
                props.enabledPluginIds.length === 1 &&
                props.enabledPluginIds.includes(plugin.descriptor.id)
              "
              @click="
                emit(
                  'setPluginEnabled',
                  plugin.descriptor.id,
                  !props.enabledPluginIds.includes(plugin.descriptor.id),
                )
              "
            >
              <span class="settings-switch__thumb" />
            </button>
            <button
              v-if="plugin.descriptor.provenance === 'external'"
              class="source-settings__check"
              type="button"
              :aria-label="`检测${plugin.descriptor.name}`"
              :disabled="props.availabilityByPluginId[plugin.descriptor.id]?.status === 'checking'"
              @click="emit('checkPlugin', plugin.descriptor.id)"
            >
              <AppIcon name="preview" :size="16" />
              {{
                (props.availabilityByPluginId[plugin.descriptor.id]?.status ?? 'unchecked') ===
                'unchecked'
                  ? '检测'
                  : '重新检测'
              }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.source-settings__group {
  display: grid;
  gap: var(--am-space-3);
}
.source-settings {
  container: am-source-settings / inline-size;
}
.source-settings h4,
.source-settings p {
  margin: 0;
}
.source-settings h4 {
  font-size: var(--am-font-size-sm);
}
.source-settings__heading,
.source-settings__identity {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-2) var(--am-space-3);
}
.source-settings__heading {
  justify-content: space-between;
}
.source-settings__count {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
}
.source-settings__list {
  margin: 0;
  padding: 0 var(--am-space-4);
  list-style: none;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
}
.source-settings__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--am-space-4);
  align-items: center;
  padding-block: var(--am-space-4);
}
.source-settings__row + .source-settings__row {
  border-block-start: 1px solid var(--am-color-border);
}
.source-settings__copy {
  display: grid;
  gap: var(--am-space-1);
  min-inline-size: 0;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.source-settings__copy small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}
.source-settings__status {
  padding: 2px var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
}
.source-settings__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--am-space-2) var(--am-space-3);
}
.source-settings__status[data-status='available'] {
  color: var(--am-color-success);
}
.source-settings__status[data-status='invalid'],
.source-settings__status[data-status='unavailable'] {
  color: var(--am-color-danger);
}
.source-settings__check {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-primary);
  font: inherit;
  cursor: pointer;
}
.source-settings__check:hover:not(:disabled) {
  background: var(--am-color-primary-soft);
  border-color: var(--am-color-primary);
}
.source-settings__check:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.source-settings__check:disabled {
  opacity: 0.5;
  cursor: wait;
}
.source-settings__empty {
  padding: var(--am-space-4);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  text-align: center;
}
@container am-source-settings (max-width: 420px) {
  .source-settings__row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--am-space-3);
  }
  .source-settings__actions {
    justify-content: space-between;
    padding-block-start: var(--am-space-2);
  }
}
</style>
