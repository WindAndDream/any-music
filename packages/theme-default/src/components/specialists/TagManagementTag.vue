<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagManagementTag } from '@any-music/ui/theme'

defineProps<{ tag: TagManagementTag; selectable: boolean; selected: boolean; playlist?: boolean }>()
defineEmits<{ activate: [key: string] }>()
</script>

<template>
  <component
    :is="selectable ? 'label' : 'button'"
    class="tag-management__tag"
    :class="{ 'tag-management__tag--selected': selected }"
    :type="selectable ? undefined : 'button'"
    :title="tag.name"
    :aria-label="selectable ? undefined : `查看标签 ${tag.name}`"
    :aria-haspopup="selectable ? undefined : 'dialog'"
    @click="!selectable && $emit('activate', tag.key)"
  >
    <input
      v-if="selectable"
      type="checkbox"
      :checked="selected"
      :aria-label="`选择标签 ${tag.name}`"
      @change="$emit('activate', tag.key)"
    />
    <AppIcon v-else name="tag" :size="18" />
    <strong>{{ tag.name }}</strong
    ><small>{{ tag.count }} {{ playlist ? '个' : '首' }}</small>
  </component>
</template>
