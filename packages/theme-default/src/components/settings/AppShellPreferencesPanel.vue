<script setup lang="ts">
import { UI_THEME_SELECTION } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { AppShellPreferencesProps, AppShellPreferencesEmits } from '@any-music/ui/theme'
import { computed, inject } from 'vue'

import { sidebarSideOptions, themeOptions } from './app-shell-preference-options'
import NavigationOrderList from './NavigationOrderList.vue'

const props = defineProps<AppShellPreferencesProps>()
const emit = defineEmits<AppShellPreferencesEmits>()
const injectedThemeSelection = inject(UI_THEME_SELECTION, undefined)
const uiThemeSelection = computed(() => props.themeSelection ?? injectedThemeSelection)

// 入口只展示当前偏好并请求打开弹窗，不持有需要持久化的设置草稿。
const sidebarSideLabel = computed(
  () => sidebarSideOptions.find((option) => option.value === props.sidebarSide)?.label,
)
const themeLabel = computed(
  () => themeOptions.find((option) => option.value === props.theme)?.label,
)
const uiThemeLabel = computed(
  () =>
    uiThemeSelection.value?.choices.find(
      (choice) => choice.id === uiThemeSelection.value?.currentId(),
    )?.title,
)
</script>

<template>
  <div class="shell-preferences settings-sections">
    <section
      v-if="props.section !== 'navigation'"
      class="shell-preferences__section settings-form__card"
      :aria-labelledby="!props.section ? 'am-shell-appearance-title' : undefined"
      :aria-label="props.section ? '外观与布局' : undefined"
    >
      <div v-if="!props.section" class="shell-preferences__heading">
        <AppIcon name="palette" />
        <div>
          <h3 id="am-shell-appearance-title">外观与布局</h3>
          <p>这些设置会在不同宿主页之间保留。</p>
        </div>
      </div>

      <div class="shell-preferences__option-grid">
        <button
          v-if="uiThemeSelection"
          class="shell-preferences__picker"
          data-am-host-surface="theme-selection"
          type="button"
          aria-haspopup="dialog"
          :aria-label="`界面主题：${uiThemeLabel}`"
          @click="emit('openPreferenceSelection', 'ui-theme')"
        >
          <span>界面主题</span>
          <span class="shell-preferences__picker-value">
            <strong>{{ uiThemeLabel }}</strong>
            <AppIcon name="arrow-right" :size="18" />
          </span>
        </button>
        <button
          class="shell-preferences__picker"
          type="button"
          aria-haspopup="dialog"
          :aria-label="`侧栏位置：${sidebarSideLabel}`"
          @click="emit('openPreferenceSelection', 'sidebar-side')"
        >
          <span>侧栏位置</span>
          <span class="shell-preferences__picker-value">
            <strong>{{ sidebarSideLabel }}</strong>
            <AppIcon name="arrow-right" :size="18" />
          </span>
        </button>
        <button
          class="shell-preferences__picker"
          type="button"
          aria-haspopup="dialog"
          :aria-label="`主题：${themeLabel}`"
          @click="emit('openPreferenceSelection', 'theme')"
        >
          <span>主题</span>
          <span class="shell-preferences__picker-value">
            <strong>{{ themeLabel }}</strong>
            <AppIcon name="arrow-right" :size="18" />
          </span>
        </button>
      </div>
      <p v-if="uiThemeSelection?.error?.()" role="alert">{{ uiThemeSelection.error() }}</p>

      <div class="shell-preferences__navigation-toggle">
        <button
          class="shell-preferences__toggle-button"
          type="button"
          :aria-pressed="props.isMobileNavigationEnabled"
          aria-label="移动端底部导航"
          aria-describedby="am-mobile-navigation-description"
          @click="emit('setMobileNavigationEnabled', !props.isMobileNavigationEnabled)"
        >
          <AppIcon :name="props.isMobileNavigationEnabled ? 'check' : 'hide'" :size="18" />
          {{ props.isMobileNavigationEnabled ? '已开启' : '已关闭' }}
        </button>
        <span class="shell-preferences__toggle-copy">
          <strong>移动端底部导航</strong>
          <small id="am-mobile-navigation-description">关闭后仍可从侧栏进入所有功能。</small>
        </span>
      </div>
    </section>

    <section
      v-if="props.section !== 'appearance'"
      class="shell-preferences__section settings-form__card"
      :aria-labelledby="!props.section ? 'am-shell-navigation-title' : undefined"
      :aria-label="props.section ? '导航管理' : undefined"
    >
      <div v-if="!props.section" class="shell-preferences__heading">
        <AppIcon name="list" />
        <div>
          <h3 id="am-shell-navigation-title">导航顺序</h3>
          <p>按住把手拖动排序；键盘聚焦把手后按空格，再用方向键移动。核心入口始终保留。</p>
        </div>
      </div>

      <p v-if="props.section === 'navigation'">
        按住把手拖动排序；也可用键盘空格与方向键调整。核心入口始终保留。
      </p>

      <NavigationOrderList
        :destinations="props.destinations"
        :hidden-destination-ids="props.hiddenDestinationIds"
        :is-mobile-layout="props.isMobileLayout"
        @set-destination-visible="(id, isVisible) => emit('setDestinationVisible', id, isVisible)"
        @move-destination="(id, offset) => emit('moveDestination', id, offset)"
      />
    </section>
  </div>
</template>

<style scoped>
.shell-preferences {
  display: grid;
}

.shell-preferences__section {
  display: grid;
  gap: var(--am-space-4);
  min-inline-size: 0;
}

.shell-preferences__heading {
  display: flex;
  align-items: flex-start;
  gap: var(--am-space-3);
}

.shell-preferences__heading > :first-child {
  flex: 0 0 auto;
  margin-block-start: 2.4px;
  color: var(--am-color-primary);
}
.shell-preferences__heading > div {
  display: grid;
  gap: var(--am-space-1);
}

.shell-preferences h3,
.shell-preferences p {
  margin: 0;
}

.shell-preferences p,
.shell-preferences small {
  color: var(--am-color-text-secondary);
}

.shell-preferences__option-grid {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}

.shell-preferences__picker {
  display: flex;
  min-inline-size: 0;
  min-block-size: 64px;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  padding: var(--am-space-3) var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.shell-preferences__picker > :first-child {
  flex: 0 0 auto;
  font-weight: 600;
}

.shell-preferences__picker-value {
  display: inline-flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
  color: var(--am-color-primary);
  text-align: end;
}
.shell-preferences__picker-value strong {
  overflow-wrap: anywhere;
}
.shell-preferences__picker-value .app-icon {
  flex-shrink: 0;
}

.shell-preferences__navigation-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--am-space-3);
  position: relative;
  padding: var(--am-space-4);
  margin-block-start: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
}
.shell-preferences__navigation-toggle::before {
  content: '';
  position: absolute;
  inset-block-start: calc(0px - var(--am-space-4));
  inset-inline: 0;
  border-block-start: 1px solid var(--am-color-border);
  pointer-events: none;
}

.shell-preferences__toggle-copy {
  display: grid;
  grid-column: 2;
  grid-row: 1;
  gap: var(--am-space-1);
  min-inline-size: 0;
}

.shell-preferences__toggle-button {
  display: inline-flex;
  grid-column: 1;
  grid-row: 1;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-inline-size: 104px;
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text-secondary);
  font: inherit;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.shell-preferences__toggle-button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.shell-preferences__picker:hover {
  color: var(--am-color-primary);
}
.shell-preferences__toggle-button:hover {
  border-color: var(--am-color-primary);
}

.shell-preferences__picker:focus-visible,
.shell-preferences__toggle-button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
