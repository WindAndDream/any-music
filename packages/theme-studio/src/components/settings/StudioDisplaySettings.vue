<script setup lang="ts">
import { collectionItemStyles } from '@any-music/card-styles'
import { COLLECTION_DISPLAY_GROUPS, useCollectionDisplaySettings } from '@any-music/ui'
import CollectionDisplayDialog from '@any-music/ui/components/CollectionDisplayDialog.vue'
import DisplayOptionsDialog from '@any-music/ui/components/DisplayOptionsDialog.vue'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, onScopeDispose, watch } from 'vue'

const props = defineProps<{
  feature: UiThemeFeatureMap['settings']
  overlayTarget?: HTMLElement | null
}>()
const emit = defineEmits<{ detailOpenChange: [open: boolean] }>()
const { expanded, region, value, open, get, select, update, layoutSections, selectLayout } =
  useCollectionDisplaySettings({
    get settings() {
      return props.feature.state.displayDefaults
    },
    get suspended() {
      return props.feature.state.suspended
    },
    get setDefault() {
      return props.feature.actions.setDisplayDefault
    },
  })
watch(open, (isOpen) => emit('detailOpenChange', isOpen), { immediate: true })
onScopeDispose(() => emit('detailOpenChange', false))
const labels = { standard: '标准', comfortable: '宽松', compact: '紧凑' }
const groups = computed(() =>
  COLLECTION_DISPLAY_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
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
  <div class="studio-display-settings settings-sections">
    <p class="settings-form__hint">
      按板块设置默认展示方式，选择后立即保存；已单独调整的区域保留各自设置。
    </p>
    <section v-for="group in groups" :key="group.id" class="settings-form__card">
      <button
        type="button"
        :aria-expanded="expanded === group.id"
        @click="expanded = expanded === group.id ? null : group.id"
      >
        {{ group.title }} · {{ group.regions.length }} 个区域
      </button>
      <div v-if="expanded === group.id" class="studio-display-settings__regions">
        <button
          v-for="entry in group.regions"
          :key="entry.id"
          type="button"
          aria-haspopup="dialog"
          :data-am-focus-key="`settings:display:${group.id}:${entry.id}`"
          @click="select(group.id, entry.id)"
        >
          <span class="settings-form__heading"
            ><strong>{{ entry.title }}</strong
            ><small class="settings-form__hint">{{ entry.summary }}</small></span
          >
        </button>
      </div>
    </section>
  </div>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <DisplayOptionsDialog
      v-if="region?.layoutOptions"
      :open="open"
      :suspended="feature.state.suspended"
      :title="`${region.subject}展示方式`"
      :sections="layoutSections"
      @select="selectLayout"
      @close="open = false"
    />
    <CollectionDisplayDialog
      v-else
      :open="open"
      :suspended="feature.state.suspended"
      :subject="region?.subject"
      :hide-arrangement="region?.hideArrangement"
      :styles="region?.subject === '歌单' ? [] : collectionItemStyles"
      :display-mode="value.displayMode"
      :mobile-columns="value.mobileColumns"
      :item-style="value.itemStyle"
      @close="open = false"
      @update-display-mode="update({ displayMode: $event })"
      @update-mobile-columns="update({ mobileColumns: $event })"
      @update-item-style="update({ itemStyle: $event })"
    />
  </Teleport>
</template>

<style scoped>
.studio-display-settings__regions {
  display: grid;
  gap: var(--am-space-2);
}
.studio-display-settings button {
  inline-size: 100%;
  text-align: start;
}
</style>
