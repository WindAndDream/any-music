<script setup lang="ts">
import { collectionItemStyles } from '@any-music/card-styles'
import {
  COLLECTION_DISPLAY_GROUPS,
  getProductDestination,
  useCollectionDisplaySettings,
} from '@any-music/ui'
import type { CollectionDisplayDefaults, SetCollectionDisplayDefault } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import DisplayOptionsDialog from '@any-music/ui/components/DisplayOptionsDialog.vue'
import { computed, onScopeDispose, watch, useId } from 'vue'

import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'

const props = defineProps<{
  settings?: CollectionDisplayDefaults
  setDefault?: SetCollectionDisplayDefault
  overlayTarget?: HTMLElement | null
  suspended?: boolean
}>()
const emit = defineEmits<{ detailOpenChange: [open: boolean] }>()
const { expanded, region, value, open, get, select, update, layoutSections, selectLayout } =
  useCollectionDisplaySettings(props)
const id = useId()
watch(open, (isOpen) => emit('detailOpenChange', isOpen), { immediate: true })
onScopeDispose(() => emit('detailOpenChange', false))
const labels = { standard: '标准', comfortable: '宽松', compact: '紧凑' }
const groups = computed(() =>
  COLLECTION_DISPLAY_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    icon: getProductDestination(group.id).icon,
    regions: group.regions.map((entry) => {
      const preferences = get(group.id, entry.id)
      const style = collectionItemStyles.find(
        (option) => option.id === (preferences.itemStyle ?? 'minimal'),
      )?.label
      const summary = entry.layoutOptions
        ? (
            entry.layoutOptions.find((option) => option.id === preferences.layout) ??
            entry.layoutOptions[0]
          )?.label
        : entry.hideArrangement
          ? style
          : `${entry.id === 'playlist-cards' ? '' : `${style} · `}${labels[preferences.displayMode]} · 手机一行 ${preferences.mobileColumns} 个`
      return { id: entry.id, title: entry.title, summary }
    }),
  })),
)
</script>

<template>
  <div class="display-settings">
    <section
      v-for="group in groups"
      :key="group.id"
      class="settings-form__card display-settings__group"
    >
      <h4 class="display-settings__heading">
        <button
          type="button"
          class="display-settings__entry"
          :aria-expanded="expanded === group.id"
          :aria-controls="`${id}-${group.id}`"
          @click="expanded = expanded === group.id ? null : group.id"
        >
          <AppIcon :name="group.icon" :size="20" />
          <span class="settings-form__heading"
            ><strong>{{ group.title }}</strong
            ><small class="settings-form__hint">{{ group.regions.length }} 个区域</small></span
          >
          <AppIcon name="arrow-right" :size="18" class="display-settings__chevron" />
        </button>
      </h4>
      <div
        :id="`${id}-${group.id}`"
        class="display-settings__regions"
        :data-expanded="expanded === group.id"
        :aria-hidden="expanded !== group.id"
        :inert="expanded !== group.id ? true : undefined"
      >
        <div class="display-settings__clip">
          <div class="display-settings__list">
            <button
              v-for="entry in group.regions"
              :key="entry.id"
              type="button"
              class="display-settings__entry"
              aria-haspopup="dialog"
              :data-am-focus-key="`settings:display:${group.id}:${entry.id}`"
              @click="select(group.id, entry.id)"
            >
              <span class="settings-form__heading"
                ><strong>{{ entry.title }}</strong
                ><small class="settings-form__hint">{{ entry.summary }}</small></span
              >
              <AppIcon name="arrow-right" :size="18" />
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <DisplayOptionsDialog
      v-if="region?.layoutOptions"
      :open="open"
      :suspended="suspended"
      :title="`${region.subject}展示方式`"
      :sections="layoutSections"
      @select="selectLayout"
      @close="open = false"
    />
    <CatalogDisplayModeDialog
      v-else
      :open="open"
      :subject="region?.subject"
      :hide-arrangement="region?.hideArrangement"
      :display-mode="value.displayMode"
      :mobile-columns="value.mobileColumns"
      :item-style="value.itemStyle"
      :suspended="suspended"
      @close="open = false"
      @update-display-mode="update({ displayMode: $event })"
      @update-mobile-columns="update({ mobileColumns: $event })"
      @update-item-style="update({ itemStyle: $event })"
    />
  </Teleport>
</template>

<style scoped>
.display-settings {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-4);
}
.display-settings__group {
  gap: 0;
  min-inline-size: 0;
  padding: 0;
}
.display-settings__heading {
  margin: 0;
  font: inherit;
}
.display-settings__entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  justify-content: space-between;
  inline-size: 100%;
  min-block-size: 64px;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  font-size: var(--am-font-size-sm);
  text-align: start;
  cursor: pointer;
}
.display-settings__entry .settings-form__heading {
  overflow-wrap: anywhere;
}
.display-settings__heading .display-settings__entry {
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.display-settings__heading .display-settings__entry > :first-child {
  color: var(--am-color-primary);
}
.display-settings__entry:hover {
  background: var(--am-color-hover);
}
.display-settings__entry:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.display-settings__entry > svg {
  flex: none;
  color: var(--am-color-text-secondary);
}
.display-settings__regions {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition:
    grid-template-rows var(--am-motion-normal) var(--am-ease-standard),
    opacity var(--am-motion-normal) var(--am-ease-standard),
    visibility 0s linear var(--am-motion-normal);
}
.display-settings__regions[data-expanded='true'] {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
.display-settings__clip {
  min-block-size: 0;
  overflow: hidden;
}
.display-settings__list {
  display: grid;
  margin: var(--am-space-3) var(--am-space-4) var(--am-space-4);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
}
.display-settings__list .display-settings__entry {
  padding: var(--am-space-3);
  border-radius: 0;
}
.display-settings__list .display-settings__entry + .display-settings__entry {
  border-block-start: 1px solid var(--am-color-border);
}
.display-settings__chevron {
  transition: transform var(--am-motion-fast) var(--am-ease-standard);
}
[aria-expanded='true'] .display-settings__chevron {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .display-settings__regions,
  .display-settings__chevron {
    transition: none;
  }
}
</style>
