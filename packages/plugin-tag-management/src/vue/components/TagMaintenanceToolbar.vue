<script setup lang="ts">
import { useEditingSession } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, shallowRef, watch } from 'vue'

import { selectedTagKey, tagDraftKey, tagSearchKey } from '../tag-maintenance-state'
import type { TagOption } from '../use-tag-management-filters'

const props = defineProps<{
  tagOptions: readonly TagOption[]
}>()

const emit = defineEmits<{
  renameTag: [currentTag: string, nextTag: string]
  deleteTag: [tag: string]
}>()

// 工具栏只收集全局维护意图；合并确认与资料库写入由拥有完整数据上下文的上层处理。
const selectedTag = useEditingSession('tag-maintenance').state(selectedTagKey, () => shallowRef(''))
const tagDraft = useEditingSession('tag-maintenance').state(tagDraftKey, () => shallowRef(''))
const search = useEditingSession('tag-maintenance').state(tagSearchKey, () => shallowRef(''))
const visibleTags = computed(() =>
  props.tagOptions.filter((tag) =>
    createSearchKey(tag.name).includes(createSearchKey(search.value)),
  ),
)
const affectedCount = computed(
  () =>
    props.tagOptions.find((tag) => createSearchKey(tag.name) === createSearchKey(selectedTag.value))
      ?.count ?? 0,
)
const normalizedDraft = computed(() => tagDraft.value.normalize('NFKC').trim().replace(/\s+/g, ' '))
const willMerge = computed(() =>
  props.tagOptions.some(
    (tag) =>
      createSearchKey(tag.name) === createSearchKey(normalizedDraft.value) &&
      createSearchKey(tag.name) !== createSearchKey(selectedTag.value),
  ),
)
const canRename = computed(() =>
  Boolean(
    selectedTag.value && normalizedDraft.value && normalizedDraft.value !== selectedTag.value,
  ),
)

watch(
  () => props.tagOptions,
  (tagOptions) => {
    if (!selectedTag.value) return
    const selectedKey = createSearchKey(selectedTag.value)
    const current = tagOptions.find((tag) => createSearchKey(tag.name) === selectedKey)
    if (current) {
      if (current.name !== selectedTag.value) {
        selectedTag.value = current.name
        tagDraft.value = current.name
      }
      return
    }
    selectedTag.value = ''
    tagDraft.value = ''
  },
  { immediate: true },
)

function selectTag(tag: string): void {
  selectedTag.value = tag
  tagDraft.value = tag
}

function submitRename(): void {
  const nextTag = normalizedDraft.value
  if (!canRename.value) return
  emit('renameTag', selectedTag.value, nextTag)
  // Keep input until the host confirms the mutation; cancelling a merge must preserve the draft.
}

function requestDelete(): void {
  if (!selectedTag.value) return
  emit('deleteTag', selectedTag.value)
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
</script>

<template>
  <form class="tag-maintenance" aria-label="全局标签维护" @submit.prevent="submitRename">
    <p class="tag-maintenance__hint">选择一个标签，统一修改所有关联歌曲中的名称。</p>
    <label class="tag-maintenance__field"
      >查找标签<input
        v-model="search"
        class="tag-maintenance__input"
        type="search"
        placeholder="搜索标签名称"
    /></label>
    <div class="tag-maintenance__options" role="group" aria-label="选择需要维护的标签">
      <button
        v-for="tag in visibleTags"
        :key="tag.name"
        type="button"
        :aria-pressed="selectedTag === tag.name"
        @click="selectTag(tag.name)"
      >
        <AppIcon name="tag" :size="16" /><span>{{ tag.name }}</span
        ><small>{{ tag.count }} 首</small>
      </button>
      <p v-if="!visibleTags.length" class="tag-maintenance__hint">
        {{
          props.tagOptions.length
            ? '没有匹配的标签，试试其他关键词。'
            : '还没有标签，可先在歌曲列表中添加。'
        }}
      </p>
    </div>
    <div class="tag-maintenance__editor">
      <strong>{{ selectedTag ? `维护 #${selectedTag}` : '选择标签开始维护' }}</strong>
      <p class="tag-maintenance__hint">
        {{
          selectedTag
            ? `当前关联 ${affectedCount} 首歌曲，操作会应用到所有平台。`
            : '筛选条件不会缩小全局维护的范围。'
        }}
      </p>
      <label class="tag-maintenance__field"
        >标签名称<input
          v-model="tagDraft"
          class="tag-maintenance__input"
          maxlength="32"
          :disabled="!selectedTag"
          placeholder="输入新名称"
          aria-label="标签的新名称"
      /></label>
      <p v-if="willMerge" class="tag-maintenance__merge" role="status">
        同名标签已存在，确认后将合并歌曲关联。
      </p>
      <button class="tag-maintenance__save" type="submit" :disabled="!canRename">
        {{ willMerge ? '合并到已有标签' : '保存名称' }}
      </button>
      <button
        class="tag-maintenance__delete"
        type="button"
        :disabled="!selectedTag"
        @click="requestDelete"
      >
        全局删除
      </button>
    </div>
  </form>
</template>
