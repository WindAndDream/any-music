<script setup lang="ts">
import type {
  UiCatalogDrawerActionsDialogProps,
  UiCatalogDrawerActionsDialogEmits,
} from '@any-music/ui/catalog'
import { createDrawerActionEditingState, drawerActionEditingKey } from '@any-music/ui/catalog'
import { useEditingSession } from '@any-music/ui/catalog'
import { isCatalogDrawerDisconnected } from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import DialogPages from '@any-music/ui/components/DialogPages.vue'
import NameEditor from '@any-music/ui/components/NameEditor.vue'
import { computed, shallowRef, watch } from 'vue'

import CatalogDrawerDetails from './CatalogDrawerDetails.vue'

/** 列表操作先展示全文；普通视图初始聚焦关闭入口，避免长请求把操作焦点推到屏外。 */
const props = withDefaults(defineProps<UiCatalogDrawerActionsDialogProps>(), { suspended: false })

const emit = defineEmits<UiCatalogDrawerActionsDialogEmits>()

const { isRenaming, draftTitle } = useEditingSession('drawer-actions').state(
  drawerActionEditingKey,
  createDrawerActionEditingState,
)
const isReturning = shallowRef(false)
const renameError = computed(() =>
  draftTitle.value.trim().length > 80 ? '名称不能超过 80 个字符。' : '',
)
const canRename = computed(
  () =>
    Boolean(draftTitle.value.trim()) &&
    !renameError.value &&
    draftTitle.value.trim() !== props.drawer?.title &&
    !props.suspended,
)
const isFullyFavorited = computed(() => {
  const tracks = props.drawer?.tracks ?? []
  return tracks.length > 0 && tracks.every((track) => props.favoriteTrackIds.has(track.id))
})
const canRefresh = computed(() => {
  const drawer = props.drawer
  return Boolean(
    drawer &&
    !isCatalogDrawerDisconnected(drawer) &&
    drawer.status !== 'paused' &&
    drawer.status !== 'restoring' &&
    !drawer.isLoading &&
    !drawer.isVerifying,
  )
})

watch([() => props.open, () => props.drawer?.id], () => {
  isRenaming.value = false
  isReturning.value = false
  draftTitle.value = props.drawer?.title ?? ''
})

function beginRename(): void {
  if (!props.open || !props.drawer || props.suspended) return
  draftTitle.value = props.drawer?.title ?? ''
  isReturning.value = false
  isRenaming.value = true
}

function cancelRename(): void {
  isReturning.value = true
  isRenaming.value = false
}

function submitRename(): void {
  const title = draftTitle.value.trim()
  if (!props.open || !props.drawer || !canRename.value) return
  emit('rename', props.drawer.id, title)
  cancelRename()
}

function requestAction(action: 'favoriteAll' | 'togglePinned'): void {
  const drawer = props.drawer
  if (!props.open || !drawer || props.suspended) return
  if (action === 'favoriteAll' && (drawer.tracks.length === 0 || isFullyFavorited.value)) return
  if (action === 'favoriteAll') {
    // 保留弹窗并由 suspended 暂停焦点圈，取消二次确认后仍能选择其他操作。
    emit('favoriteAll', drawer.id)
  } else {
    emit('close')
    emit('togglePinned', drawer.id)
  }
}

function requestRefresh(): void {
  if (!props.drawer || !canRefresh.value || props.suspended) return
  // 与批量喜欢一样，由工作台处理清空确认；取消时保留当前操作弹窗。
  emit('refresh', props.drawer.id)
}
</script>

<template>
  <AppDialog
    :open="props.open"
    :back-action="isRenaming ? () => void cancelRename() : () => emit('close')"
    :suspended="props.suspended"
    title="音乐列表操作"
    size="compact"
    :initial-focus-selector="isRenaming ? '[name=catalog-title]' : undefined"
    @close="emit('close')"
  >
    <DialogPages
      v-if="props.drawer"
      class="catalog-list-actions"
      :page="isRenaming ? 'name' : 'actions'"
      :returning="isReturning"
      :focus-selector="isRenaming ? '[name=catalog-title]' : '[data-catalog-rename]'"
    >
      <NameEditor
        v-if="isRenaming"
        v-model="draftTitle"
        :original-name="props.drawer.input"
        :original-label="props.drawer.kind === 'search' ? '搜索原名' : '导入来源'"
        input-name="catalog-title"
        placeholder="输入便于识别的列表名称"
        help-text="最多 80 个字符；仅修改列表名称，保留原始搜索内容或导入链接。"
        :max-length="80"
        :can-save="canRename"
        :error="renameError"
        @save="submitRename"
        @back="cancelRename"
      />
      <template v-else>
        <CatalogDrawerDetails :drawer="props.drawer" :suspended="props.suspended" />
        <button
          class="catalog-list-actions__option"
          type="button"
          :disabled="!canRefresh"
          @click="requestRefresh"
        >
          <AppIcon name="refresh" :size="20" />
          <span>
            <strong>刷新</strong>
            <small>清空当前结果，按原始搜索词或导入链接从第一页重新加载</small>
          </span>
          <AppIcon name="arrow-right" :size="17" />
        </button>
        <button
          class="catalog-list-actions__option"
          type="button"
          :disabled="props.drawer.tracks.length === 0 || isFullyFavorited"
          @click="requestAction('favoriteAll')"
        >
          <AppIcon name="heart" :size="20" />
          <span>
            <strong>{{ isFullyFavorited ? '已全部喜欢' : '全部喜欢' }}</strong>
            <small>将已加载的 {{ props.drawer.tracks.length }} 首歌曲加入我的喜欢</small>
          </span>
          <AppIcon name="arrow-right" :size="17" />
        </button>
        <button
          data-catalog-rename
          class="catalog-list-actions__option"
          type="button"
          @click="beginRename"
        >
          <AppIcon name="playlist" :size="20" />
          <span><strong>重命名</strong><small>修改列表名称，保留原始搜索或导入内容</small></span>
          <AppIcon name="arrow-right" :size="17" />
        </button>
        <button
          class="catalog-list-actions__option"
          type="button"
          @click="requestAction('togglePinned')"
        >
          <AppIcon name="arrow-up" :size="20" />
          <span>
            <strong>{{ props.drawer.isPinned ? '取消置顶' : '置顶' }}</strong>
            <small>{{
              props.drawer.isPinned ? '恢复到普通列表顺序' : '让这个列表优先显示，刷新后保留'
            }}</small>
          </span>
          <AppIcon name="arrow-right" :size="17" />
        </button>
      </template>
    </DialogPages>
  </AppDialog>
</template>

<style scoped>
.catalog-list-actions__option {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 20px;
  min-block-size: 64px;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  text-align: start;
}

.catalog-list-actions__option > span {
  display: grid;
  gap: var(--am-space-1);
}

.catalog-list-actions__option small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}

.catalog-list-actions__option:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}

.catalog-list-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.catalog-list-actions button:focus-visible,
.catalog-list-actions input:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
