<script setup lang="ts">
import type { AppShellPreferenceKind, AppShellPreferences, ProductViewId } from '@any-music/ui'
import { useEditingSession } from '@any-music/ui'
import type { UiThemeFeatureMap, UiThemeHostSlots } from '@any-music/ui/theme'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import AppShellPreferenceDialog from './AppShellPreferenceDialog.vue'
import AppShellPreferencesPanel from './AppShellPreferencesPanel.vue'
import GlobalSettingsPanel from './GlobalSettingsPanel.vue'
import { preferenceKey } from './settings-editing-state'

/** Complete-root adapter. Ordinary forms use projections and named host operations only. */
const props = defineProps<{
  feature: UiThemeFeatureMap['settings']
  overlayTarget?: HTMLElement | null
}>()
defineSlots<UiThemeHostSlots>()
const emit = defineEmits<{ detailOpenChange: [open: boolean] }>()
const session = useEditingSession('settings')
const setting = session.state(preferenceKey, () => shallowRef<AppShellPreferenceKind | null>(null))
const detailOverlayTarget = shallowRef<HTMLElement | null>(null)
const detailOpen = shallowRef(false)
watch(
  () => setting.value !== null || detailOpen.value,
  (open) => emit('detailOpenChange', open),
  { immediate: true },
)
onScopeDispose(() => emit('detailOpenChange', false))
const state = computed(() => props.feature.state)
const themeSelection = computed(() => ({
  choices: state.value.themes,
  currentId: () => state.value.themeId,
  error: () => state.value.themeError ?? '',
  select: (id: string) => {
    const choice = state.value.themes.find((candidate) => candidate.id === id)
    if (choice && session.active) void props.feature.actions.selectTheme(choice.id)
  },
}))
function updatePreferences(value: Partial<AppShellPreferences>): void {
  if (!session.active || state.value.suspended) return
  props.feature.actions.setPreferences({ ...state.value.preferences, ...value })
}
function setAppearance(value: AppShellPreferences['theme']): void {
  if (session.active && !state.value.suspended) props.feature.actions.setAppearance(value)
}
function setVisible(id: ProductViewId, visible: boolean): void {
  const hidden = state.value.preferences.hiddenDestinationIds.filter(
    (candidate) => candidate !== id,
  )
  updatePreferences({ hiddenDestinationIds: visible ? hidden : [...hidden, id] })
}
function moveDestination(id: ProductViewId, offset: -1 | 1): void {
  const order = [...state.value.preferences.destinationOrder]
  const index = order.indexOf(id)
  const next = index + offset
  if (index < 0 || next < 0 || next >= order.length) return
  ;[order[index], order[next]] = [order[next]!, order[index]!]
  updatePreferences({ destinationOrder: order })
}
</script>

<template>
  <div v-if="feature.availability.status !== 'available'" role="status">
    {{ feature.availability.reason }}
  </div>
  <div v-else class="classic-settings" :inert="state.suspended ? true : undefined">
    <p v-if="feature.status.status === 'loading'" role="status">正在加载设置…</p>
    <p v-if="feature.status.status === 'error' || feature.status.status === 'invalid'" role="alert">
      {{ feature.status.error.message }}
    </p>
    <ul v-if="feature.status.status === 'partial'" role="alert">
      <li v-for="(error, index) in feature.status.errors" :key="index">{{ error.message }}</li>
    </ul>
    <GlobalSettingsPanel
      :plugins="state.sources.map((descriptor) => ({ descriptor }))"
      :availability-by-plugin-id="state.availabilityBySourceId"
      :enabled-plugin-ids="state.enabledSourceIds"
      :external-sources-enabled="state.externalSourcesEnabled"
      :profile="{ id: state.profileId, displayName: state.creatorDisplayName }"
      :history-limit="state.playbackHistoryLimit"
      :download-concurrency="state.downloadConcurrency"
      :is-mobile-layout="state.isMobileLayout"
      :initial-section="state.section"
      :suspended="state.suspended || setting !== null"
      :overlay-target="detailOverlayTarget"
      :network-summary="state.networkSummary"
      :account-summary="state.accountSummary"
      :network-title="state.networkTitle"
      :network-description="state.networkDescription"
      :appearance-summary="
        state.appearance === 'system'
          ? '跟随系统'
          : state.appearance === 'dark'
            ? '深色主题'
            : '浅色主题'
      "
      :filter-history-settings="state.filterHistory"
      :set-filter-history-settings="feature.actions.setFilterHistory"
      :display-defaults="state.displayDefaults"
      :set-display-default="feature.actions.setDisplayDefault"
      @select-section="feature.actions.selectSection"
      @detail-open-change="detailOpen = $event"
      @set-plugin-enabled="feature.actions.setSourceEnabled"
      @check-plugin="feature.actions.checkSource"
      @set-history-limit="feature.actions.setPlaybackHistoryLimit"
      @set-download-concurrency="feature.actions.setDownloadConcurrency"
      @update-local-user-display-name="feature.actions.setCreatorDisplayName"
    >
      <template #appearance-settings>
        <AppShellPreferencesPanel
          section="appearance"
          :destinations="state.destinations"
          :hidden-destination-ids="state.preferences.hiddenDestinationIds"
          :sidebar-side="state.preferences.sidebarSide"
          :theme="state.appearance"
          :theme-selection="themeSelection"
          :is-mobile-navigation-enabled="state.preferences.isMobileNavigationEnabled"
          :is-mobile-layout="state.isMobileLayout"
          @open-preference-selection="setting = $event"
          @set-mobile-navigation-enabled="updatePreferences({ isMobileNavigationEnabled: $event })"
        />
      </template>
      <template #navigation-settings>
        <AppShellPreferencesPanel
          section="navigation"
          :destinations="state.destinations"
          :hidden-destination-ids="state.preferences.hiddenDestinationIds"
          :sidebar-side="state.preferences.sidebarSide"
          :theme="state.appearance"
          :is-mobile-navigation-enabled="state.preferences.isMobileNavigationEnabled"
          :is-mobile-layout="state.isMobileLayout"
          @set-destination-visible="setVisible"
          @move-destination="moveDestination"
        />
      </template>
      <template v-if="$slots['account-settings']" #account-settings="context"
        ><slot name="account-settings" v-bind="context"
      /></template>
      <template v-if="$slots['network-settings']" #network-settings
        ><slot name="network-settings"
      /></template>
      <template v-if="$slots['download-settings']" #download-settings
        ><slot name="download-settings"
      /></template>
      <template v-if="$slots['cache-settings']" #cache-settings="context"
        ><slot name="cache-settings" v-bind="context"
      /></template>
      <template v-if="$slots['external-source-settings']" #external-source-settings
        ><slot name="external-source-settings"
      /></template>
    </GlobalSettingsPanel>
  </div>
  <Teleport :to="props.overlayTarget ?? 'body'" :disabled="!props.overlayTarget">
    <AppShellPreferenceDialog
      :setting="setting"
      :theme="state.appearance"
      :theme-selection="themeSelection"
      :sidebar-side="state.preferences.sidebarSide"
      :suspended="state.suspended"
      @close="setting = null"
      @set-theme="setAppearance"
      @set-sidebar-side="updatePreferences({ sidebarSide: $event })"
    />
    <div ref="detailOverlayTarget" class="classic-settings-overlay-target"></div>
  </Teleport>
</template>

<style scoped>
.classic-settings {
  /* Carry the bounded sheet height through this adapter to both scrolling columns. */
  block-size: 100%;
  min-block-size: 0;
}
.classic-settings-overlay-target {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
