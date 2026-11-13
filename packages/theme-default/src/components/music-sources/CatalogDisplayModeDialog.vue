<script setup lang="ts">
import { collectionItemStyles } from '@any-music/card-styles'
import type {
  UiCatalogDisplayModeDialogProps,
  UiCatalogDisplayModeDialogEmits,
} from '@any-music/ui/catalog'
import CollectionDisplayDialog from '@any-music/ui/components/CollectionDisplayDialog.vue'
import type { CollectionItemStyle } from '@any-music/ui/library'

defineProps<
  UiCatalogDisplayModeDialogProps & {
    subject?: string
    itemStyle?: CollectionItemStyle
    hideArrangement?: boolean
  }
>()
defineEmits<UiCatalogDisplayModeDialogEmits & { updateItemStyle: [style: CollectionItemStyle] }>()
</script>
<template>
  <CollectionDisplayDialog
    v-bind="$props"
    :styles="subject === '歌单' ? [] : collectionItemStyles"
    @close="$emit('close')"
    @update-display-mode="$emit('updateDisplayMode', $event)"
    @update-mobile-columns="$emit('updateMobileColumns', $event)"
    @update-item-style="$emit('updateItemStyle', $event)"
  />
</template>
