<script setup lang="ts">
import type { MaterialCollection } from '@any-music/core'
import { useEditingSession } from '@any-music/ui'
import { useConfirmAction } from '@any-music/ui'
import { shallowRef } from 'vue'

import { collectionDraftKey, deleteMaterialRecordsKey } from '../collection-toolbar-state'

const props = defineProps<{
  collections: readonly MaterialCollection[]
  activeCollectionId: string
}>()

const emit = defineEmits<{
  select: [collectionId: string]
  create: [name: string]
  delete: [collectionId: string, deleteMaterialRecords: boolean]
}>()
const confirm = useConfirmAction()

const collectionDraft = useEditingSession('collection-toolbar').state(collectionDraftKey, () =>
  shallowRef(''),
)
const deleteMaterialRecords = useEditingSession('collection-toolbar').state(
  deleteMaterialRecordsKey,
  () => shallowRef(false),
)

function submitCollection(): void {
  const name = collectionDraft.value.trim()
  if (!name) return
  emit('create', name)
  collectionDraft.value = ''
}

function selectCollection(event: Event): void {
  const target = event.target
  if (target instanceof HTMLSelectElement) emit('select', target.value)
}

async function requestDelete(): Promise<void> {
  const collection = props.collections.find(
    (candidate) => candidate.id === props.activeCollectionId,
  )
  if (!collection) return
  const cleanupNotice = deleteMaterialRecords.value
    ? '同时删除本合集创建的自定义歌曲，并清理没有其他用途的素材记录。'
    : '素材记录会保留；若合集已有自定义歌曲，需要先勾选级联清理。'
  const confirmed = await confirm({
    title: '删除素材合集',
    message: `确定删除素材合集“${collection.name}”吗？\n${cleanupNotice}`,
    confirmLabel: '删除合集',
    tone: 'danger',
  })
  if (confirmed) {
    emit('delete', collection.id, deleteMaterialRecords.value)
    deleteMaterialRecords.value = false
  }
}
</script>

<template>
  <header class="material-collections" aria-label="素材合集管理">
    <div class="material-collections__heading">
      <div>
        <strong>素材合集</strong>
        <small>一次创作只能使用同一合集内的素材，自定义歌曲也可以再次加入合集。</small>
      </div>
      <span>{{ props.collections.length }} 个合集</span>
    </div>
    <div class="material-collections__controls">
      <select
        class="material-collections__select"
        :value="props.activeCollectionId"
        aria-label="当前素材合集"
        @change="selectCollection"
      >
        <option value="">选择素材合集</option>
        <option v-for="collection in props.collections" :key="collection.id" :value="collection.id">
          {{ collection.name }} · {{ collection.trackIds.length }} 首素材
        </option>
      </select>
      <button
        class="material-collections__delete"
        type="button"
        :disabled="!props.activeCollectionId"
        @click="requestDelete"
      >
        删除合集
      </button>
    </div>
    <label class="material-collections__cleanup">
      <input v-model="deleteMaterialRecords" type="checkbox" />
      <span> 级联删除本合集创建的自定义歌曲，并清理独占素材记录；共享或仍有用途的记录会保留 </span>
    </label>
    <form class="material-collections__create" @submit.prevent="submitCollection">
      <input
        v-model="collectionDraft"
        maxlength="80"
        placeholder="新素材合集名称"
        aria-label="新素材合集名称"
      />
      <button type="submit">创建合集</button>
    </form>
  </header>
</template>
