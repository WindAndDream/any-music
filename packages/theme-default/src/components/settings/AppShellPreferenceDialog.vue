<script setup lang="ts">
import type { AppThemePreference, SidebarSide } from '@any-music/ui'
import { UI_THEME_SELECTION } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type {
  AppShellPreferenceDialogProps,
  AppShellPreferenceDialogEmits,
} from '@any-music/ui/theme'
import { computed, inject, onScopeDispose } from 'vue'

import { sidebarSideOptions, themeOptions } from './app-shell-preference-options'

/** 受控外观选择弹窗；选择立即发出修改意图，焦点与关闭行为复用 AppDialog。 */
const props = defineProps<AppShellPreferenceDialogProps>()
const emit = defineEmits<AppShellPreferenceDialogEmits>()
const injectedThemeSelection = inject(UI_THEME_SELECTION, undefined)
const uiThemeSelection = computed(() => props.themeSelection ?? injectedThemeSelection)
let active = true
onScopeDispose(() => (active = false))
function canSelect(): boolean {
  return active && props.setting !== null && !props.suspended
}

function selectUiTheme(id: string): void {
  if (!canSelect() || props.setting !== 'ui-theme') return
  uiThemeSelection.value?.select(id)
  if (!uiThemeSelection.value?.choices.find((choice) => choice.id === id)?.unavailableReason)
    emit('close')
}

function selectSidebarSide(side: SidebarSide): void {
  if (!canSelect() || props.setting !== 'sidebar-side') return
  emit('setSidebarSide', side)
  emit('close')
}

function selectTheme(theme: AppThemePreference): void {
  if (!canSelect() || props.setting !== 'theme') return
  emit('setTheme', theme)
  emit('close')
}
</script>

<template>
  <AppDialog
    :open="props.setting !== null"
    :suspended="props.suspended"
    :title="
      props.setting === 'ui-theme'
        ? '界面主题'
        : props.setting === 'sidebar-side'
          ? '侧栏位置'
          : '主题'
    "
    description="选择后立即应用。"
    size="compact"
    initial-focus-selector="[aria-pressed='true']"
    @close="emit('close')"
  >
    <div
      v-if="props.setting === 'sidebar-side'"
      class="preference-options"
      role="group"
      aria-label="侧栏位置"
    >
      <button
        v-for="option in sidebarSideOptions"
        :key="option.value"
        :data-am-focus-key="`preference:${props.setting}:${option.value}`"
        class="preference-options__button"
        type="button"
        :aria-pressed="props.sidebarSide === option.value"
        @click="selectSidebarSide(option.value)"
      >
        <AppIcon :name="option.value === 'left' ? 'arrow-left' : 'arrow-right'" />
        <span class="preference-options__copy">
          <strong>{{ option.label }}</strong>
          <small>{{ option.description }}</small>
        </span>
        <span class="preference-options__state">
          <AppIcon v-if="props.sidebarSide === option.value" name="check" :size="18" />
          {{ props.sidebarSide === option.value ? '已选' : '选择' }}
        </span>
      </button>
    </div>
    <div
      v-else-if="props.setting === 'ui-theme'"
      class="preference-options"
      role="group"
      aria-label="界面主题"
      data-am-host-surface="theme-selection"
    >
      <button
        v-for="choice in uiThemeSelection?.choices ?? []"
        :key="choice.id"
        :data-am-focus-key="`preference:ui-theme:${choice.id}`"
        class="preference-options__button"
        type="button"
        :aria-pressed="uiThemeSelection?.currentId() === choice.id"
        :aria-disabled="!!choice.unavailableReason"
        :title="choice.unavailableReason"
        @click="selectUiTheme(choice.id)"
      >
        <AppIcon name="palette" />
        <span class="preference-options__copy"
          ><strong>{{ choice.title }}</strong></span
        >
        <span class="preference-options__state">
          <AppIcon v-if="uiThemeSelection?.currentId() === choice.id" name="check" :size="18" />
          {{
            choice.unavailableReason
              ? '暂不可用'
              : uiThemeSelection?.currentId() === choice.id
                ? '已选'
                : '选择'
          }}
        </span>
      </button>
    </div>
    <div
      v-else-if="props.setting === 'theme'"
      class="preference-options"
      role="group"
      aria-label="主题"
    >
      <button
        v-for="option in themeOptions"
        :key="option.value"
        :data-am-focus-key="`preference:${props.setting}:${option.value}`"
        class="preference-options__button"
        type="button"
        :aria-pressed="props.theme === option.value"
        @click="selectTheme(option.value)"
      >
        <AppIcon name="palette" />
        <span class="preference-options__copy">
          <strong>{{ option.label }}</strong>
          <small>{{ option.description }}</small>
        </span>
        <span class="preference-options__state">
          <AppIcon v-if="props.theme === option.value" name="check" :size="18" />
          {{ props.theme === option.value ? '已选' : '选择' }}
        </span>
      </button>
    </div>
  </AppDialog>
</template>

<style scoped>
.preference-options {
  display: grid;
  gap: var(--am-space-3);
}

.preference-options__button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 72px;
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
}

.preference-options__button:hover,
.preference-options__button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}

.preference-options__copy {
  display: grid;
  gap: var(--am-space-1);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.preference-options__copy small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.preference-options__state {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-1);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
}

.preference-options__button[aria-pressed='true'] .preference-options__state {
  color: var(--am-color-primary);
}

@container am-dialog (max-width: 360px) {
  .preference-options__button {
    gap: var(--am-space-2);
    padding: var(--am-space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .preference-options__button {
    transition-duration: 1ms;
  }
}
</style>
