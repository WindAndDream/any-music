<script setup lang="ts">
import { computed } from 'vue'

import type { CollectionItemStyle } from '../product/track-display-preferences'
import DisplayOptionsDialog from './DisplayOptionsDialog.vue'
import { catalogTrackDisplayModes } from './music-sources/catalog-track-display-mode'
import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from './music-sources/catalog-track-display-mode'

const props = defineProps<{
  open: boolean
  suspended?: boolean
  subject?: string
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  itemStyle?: CollectionItemStyle
  styles: readonly { id: CollectionItemStyle; label: string; description: string }[]
  hideArrangement?: boolean
}>()
const emit = defineEmits<{
  close: []
  updateDisplayMode: [value: CatalogTrackDisplayMode]
  updateMobileColumns: [value: MobileTrackColumns]
  updateItemStyle: [value: CollectionItemStyle]
}>()
const sections = computed(() => [
  ...(props.styles.length > 1
    ? [
        {
          id: 'style',
          label: '风格选择',
          description: '选择当前列表中每一项的外观',
          value: props.itemStyle ?? 'minimal',
          options: props.styles,
        },
      ]
    : []),
  ...(props.hideArrangement
    ? []
    : [
        {
          id: 'arrangement',
          label: '排列方式',
          description: '卡片数量会随内容区宽度调整。',
          value: `${props.displayMode}:${props.mobileColumns}`,
          options: [
            ...catalogTrackDisplayModes.map(({ id, label, description, columns }) => ({
              id: `density:${id}`,
              label,
              description: props.subject
                ? description.replaceAll('歌曲', props.subject)
                : description,
              columns,
              selected: props.displayMode === id,
              viewport: 'desktop' as const,
            })),
            {
              id: 'columns:1',
              label: '一行一个',
              description: props.subject ? '大卡片，适合逐个查看' : '大卡片，适合逐首查看',
              columns: 1,
              selected: props.mobileColumns === 1,
              viewport: 'mobile' as const,
            },
            {
              id: 'columns:2',
              label: '一行两个',
              description: '快速浏览，操作收进卡片菜单',
              columns: 2,
              selected: props.mobileColumns === 2,
              viewport: 'mobile' as const,
            },
          ],
        },
      ]),
])
function select(section: string, value: string) {
  if (section === 'style') {
    const style = props.styles.find((option) => option.id === value)
    if (style) emit('updateItemStyle', style.id)
  }
  if (section === 'arrangement') {
    const [kind, option] = value.split(':')
    if (
      kind === 'density' &&
      (option === 'standard' || option === 'comfortable' || option === 'compact')
    )
      emit('updateDisplayMode', option)
    if (kind === 'columns' && (option === '1' || option === '2'))
      emit('updateMobileColumns', option === '2' ? 2 : 1)
  }
}
</script>
<template>
  <DisplayOptionsDialog
    :open="open"
    :suspended="suspended"
    :title="`${subject ?? '歌曲'}展示方式`"
    :sections="sections"
    @select="select"
    @close="emit('close')"
  />
</template>
