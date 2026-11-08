<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'

import CatalogOperatorPanel from '../music-sources/CatalogOperatorPanel.vue'

defineProps<{
  open: boolean
  suspended: boolean
  selectedCount: number
  visibleCount: number
  allSelected: boolean
  someSelected: boolean
  canEnable: boolean
  canDisable: boolean
}>()
defineEmits<{ close: []; toggleAll: []; enable: []; disable: []; refresh: [] }>()
</script>

<template>
  <SidePanel
    :open="open"
    title="插件操作器"
    stacked-actions
    :suspended="suspended"
    @close="$emit('close')"
  >
    <CatalogOperatorPanel
      :selected-count="selectedCount"
      :visible-count="visibleCount"
      :all-selected="allSelected"
      :some-selected="someSelected"
      :select-all-label="`全选当前 ${visibleCount} 个匹配插件`"
      count-unit="个"
      :disabled="suspended"
      @toggle-all="$emit('toggleAll')"
    >
      <button type="button" :disabled="suspended || !canEnable" @click="$emit('enable')">
        <AppIcon name="check" :size="18" /><span>启用内置插件</span><small>启用</small>
      </button>
      <button type="button" :disabled="suspended || !canDisable" @click="$emit('disable')">
        <AppIcon name="close" :size="18" /><span>停用内置插件</span><small>停用</small>
      </button>
      <button type="button" :disabled="suspended" @click="$emit('refresh')">
        <AppIcon name="refresh" :size="18" /><span>刷新外置插件</span><small>刷新</small>
      </button>
    </CatalogOperatorPanel>
  </SidePanel>
</template>
