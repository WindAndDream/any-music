<script setup lang="ts">
import type { CatalogNamingFilter } from '@any-music/ui/catalog'
import type { CatalogFilterContext } from '@any-music/ui/catalog'
import { computed } from 'vue'

import CollectionFilterChoices from './CollectionFilterChoices.vue'

/** 原生单选表达互斥状态，全部为明确的重置入口；不以来源类型推断命名状态。 */
const props = defineProps<{ filterContext: CatalogFilterContext }>()
const naming = defineModel<CatalogNamingFilter>({ required: true })
const options = computed(() => {
  const item = props.filterContext === 'drawers' ? '音乐列表' : '歌曲'
  return [
    { value: 'all', label: '全部', description: `显示所有${item}，不限命名状态` },
    { value: 'custom', label: '自定义名称', description: `只显示设置了自定义名称的${item}` },
    { value: 'original', label: '来源原名', description: `只显示使用原始名称的${item}` },
  ] as const
})
</script>

<template>
  <CollectionFilterChoices v-model="naming" label="命名状态" :options="options" />
</template>
