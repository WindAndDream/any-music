<script setup lang="ts">
import { collectionItemStyles } from '@any-music/card-styles'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import CollectionDisplayDialog from '@any-music/ui/components/CollectionDisplayDialog.vue'
import type { UiThemeTrackListState, UiThemeTrackListActions } from '@any-music/ui/theme'
import { onDeactivated, shallowRef } from 'vue'
import type { DeepReadonly } from 'vue'

import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
const props = defineProps<{
  state: DeepReadonly<Pick<UiThemeTrackListState, 'displayMode' | 'mobileColumns' | 'itemStyle'>>
  actions: Pick<UiThemeTrackListActions, 'setDisplayMode' | 'setMobileColumns' | 'setItemStyle'>
  disabled?: boolean
  subject?: string
  hideArrangement?: boolean
}>()
const open = shallowRef(false)
onDeactivated(() => {
  open.value = false
})
</script>
<template>
  <button
    class="studio-display-trigger"
    type="button"
    :disabled="disabled"
    :aria-label="`${subject ?? '歌曲'}展示方式`"
    title="展示方式"
    aria-haspopup="dialog"
    @click="open = true"
  >
    <AppIcon name="list" :size="18" /><span>展示方式</span>
  </button>
  <StudioPageOverlays :open="open"
    ><CollectionDisplayDialog
      :open="open"
      :suspended="disabled"
      :subject="subject"
      :hide-arrangement="hideArrangement"
      :display-mode="state.displayMode"
      :mobile-columns="state.mobileColumns"
      :item-style="state.itemStyle"
      :styles="subject === '歌单' ? [] : collectionItemStyles"
      @close="open = false"
      @update-display-mode="props.actions.setDisplayMode"
      @update-mobile-columns="props.actions.setMobileColumns"
      @update-item-style="props.actions.setItemStyle?.($event)"
  /></StudioPageOverlays>
</template>
<style scoped>
.studio-display-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: 36px;
  gap: var(--am-space-2);
}
@media (max-width: 600px) {
  .studio-display-trigger {
    min-inline-size: 44px;
    min-block-size: 44px;
    padding-inline: 0;
  }
  .studio-display-trigger span {
    display: none;
  }
}
</style>
