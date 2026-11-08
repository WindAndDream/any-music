<script setup lang="ts">
import { computed } from 'vue'

import {
  MIN_RESOURCE_CACHE_MIB,
  MAX_RESOURCE_CACHE_MIB,
  MAX_MEMORY_CACHE_MIB,
  type ResourceCacheSnapshot,
} from '../../product/resource-cache'
import AppIcon from '../AppIcon.vue'
import ResourceCacheCapacityCard from './ResourceCacheCapacityCard.vue'
const props = defineProps<{
  snapshot?: ResourceCacheSnapshot
  capacityMib: string
  memoryCapacityMib: string
  busy: boolean
  error?: string
  notice?: string
}>()
const emit = defineEmits<{
  'update:capacityMib': [value: string]
  'update:memoryCapacityMib': [value: string]
  save: []
  saveMemory: []
  refresh: []
  clear: []
  chooseDirectory: []
  resetDirectory: []
}>()
const usagePercent = computed(() =>
  props.snapshot
    ? Math.min(100, (props.snapshot.usedBytes / props.snapshot.capacityBytes) * 100)
    : 0,
)
function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}
</script>

<template>
  <section class="settings-form resource-cache" aria-label="资源缓存" :aria-busy="props.busy">
    <div class="settings-sections">
      <ResourceCacheCapacityCard
        title="硬盘缓存"
        :model-value="props.capacityMib"
        :minimum="MIN_RESOURCE_CACHE_MIB"
        :maximum="MAX_RESOURCE_CACHE_MIB"
        :disabled="props.busy || !props.snapshot"
        focus-key="settings:cache:capacity"
        @update:model-value="emit('update:capacityMib', $event)"
        @save="emit('save')"
      >
        <template #header-actions>
          <button
            class="settings-form__button resource-cache__refresh"
            type="button"
            aria-label="刷新用量"
            title="刷新用量"
            data-am-focus-key="settings:cache:refresh"
            :disabled="props.busy"
            @click="emit('refresh')"
          >
            <AppIcon name="refresh" :size="18" />
          </button>
        </template>
        <p v-if="!props.snapshot" class="resource-cache__status" role="status">
          {{ props.busy ? '正在读取缓存信息…' : '缓存信息尚未读取' }}
        </p>
        <template v-else>
          <p class="resource-cache__status" role="status">
            已用 {{ formatBytes(props.snapshot.usedBytes) }} /
            {{ formatBytes(props.snapshot.capacityBytes) }}
          </p>
          <progress
            class="resource-cache__usage"
            :value="usagePercent"
            max="100"
            aria-label="缓存空间使用率"
          />
          <p class="settings-form__hint">
            图片与封面 {{ formatBytes(props.snapshot.imageBytes) }} · 歌曲片段
            {{ formatBytes(props.snapshot.audioBytes) }} · {{ props.snapshot.entryCount }} 个缓存块
          </p>
        </template>
        <template #actions>
          <button
            class="settings-form__button"
            type="button"
            :disabled="props.busy || !props.snapshot"
            @click="emit('clear')"
          >
            清除缓存…
          </button>
        </template>
      </ResourceCacheCapacityCard>
      <ResourceCacheCapacityCard
        title="内存缓存"
        :model-value="props.memoryCapacityMib"
        :minimum="0"
        :maximum="MAX_MEMORY_CACHE_MIB"
        :disabled="props.busy || !props.snapshot"
        focus-key="settings:cache:memory-capacity"
        hint="0 表示关闭，默认 64 MiB，最高 1024 MiB。"
        @update:model-value="emit('update:memoryCapacityMib', $event)"
        @save="emit('saveMemory')"
      >
        <p v-if="props.snapshot" class="resource-cache__status" role="status">
          已用 {{ formatBytes(props.snapshot.memoryUsedBytes) }} /
          {{ formatBytes(props.snapshot.memoryCapacityBytes) }} ·
          {{ props.snapshot.memoryEntryCount }} 个缓存块
        </p>
      </ResourceCacheCapacityCard>
      <div class="settings-form__card">
        <div class="settings-form__heading">
          <h4 class="resource-cache__title">缓存位置</h4>
        </div>
        <template v-if="props.snapshot">
          <p class="resource-cache__directory">{{ props.snapshot.directory }}</p>
          <div v-if="props.snapshot.canChooseDirectory" class="settings-form__footer">
            <button
              class="settings-form__button"
              type="button"
              :disabled="props.busy || !props.snapshot.customDirectory"
              @click="emit('resetDirectory')"
            >
              恢复默认目录
            </button>
            <button
              class="settings-form__button"
              type="button"
              :disabled="props.busy"
              @click="emit('chooseDirectory')"
            >
              选择缓存目录
            </button>
          </div>
        </template>
      </div>
    </div>
  </section>
  <p v-if="props.error" class="settings-form__error" role="alert">{{ props.error }}</p>
  <p v-if="props.notice" role="status">{{ props.notice }}</p>
</template>

<style scoped>
.resource-cache__refresh {
  flex: 0 0 auto;
  inline-size: 44px;
  padding: 0;
}
.resource-cache__title,
.resource-cache__status {
  margin: 0;
}
.resource-cache__usage {
  inline-size: 100%;
  accent-color: var(--am-color-primary);
}
.resource-cache__directory {
  margin: 0;
  overflow-wrap: anywhere;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
}
</style>
