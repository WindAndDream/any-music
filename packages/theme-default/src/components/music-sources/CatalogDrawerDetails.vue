<script setup lang="ts">
import { useCopyText } from '@any-music/ui/catalog'
import type { CatalogDrawerView } from '@any-music/ui/catalog'
import {
  formatCatalogDrawerCreatedAt,
  getCatalogDrawerKindLabel,
  getCatalogDrawerStatusLabel,
  isCatalogDrawerDisconnected,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed, useTemplateRef } from 'vue'

/** 操作弹窗中的只读卡片全文；直接消费当前列表投影，不触发请求或保存额外副本。 */
const props = defineProps<{ drawer: CatalogDrawerView; suspended?: boolean }>()
const copyContainer = useTemplateRef<HTMLElement>('copyContainer')
const informationCopy = useCopyText({
  context: () => props.drawer.id,
  enabled: () => !props.suspended,
  container: copyContainer,
  // 仅在点击时序列化公开投影和已加载歌曲，不产生来源请求。
  getText: () => JSON.stringify(props.drawer, null, 2),
  successMessage: '完整信息已复制为 JSON。',
})
const inputCopy = useCopyText({
  context: () => `${props.drawer.id}:${props.drawer.kind}:${props.drawer.input}`,
  enabled: () => !props.suspended,
  container: copyContainer,
  getText: () => props.drawer.input,
  successMessage: () =>
    props.drawer.kind === 'search' ? '原始搜索词已复制。' : '导入链接已复制。',
})
const copyFeedback = computed(() =>
  [informationCopy.feedback.value, inputCopy.feedback.value].filter((value) => value !== undefined),
)
const kindLabel = computed(() => getCatalogDrawerKindLabel(props.drawer))
const statusLabel = computed(() => getCatalogDrawerStatusLabel(props.drawer))
const accountLabel = computed(() => {
  const name = props.drawer.account?.name?.trim()
  const customName = props.drawer.account?.customName?.trim()
  if (name && customName && name !== customName) return `${name}（${customName}）`
  return name || customName || (props.drawer.status === 'idle' ? '加载后显示' : '未读取用户名')
})
const accountStatusLabel = computed(() => {
  if (props.drawer.accountStatus) return props.drawer.accountStatus
  const account = props.drawer.account
  if (!account) return '加载后显示'
  if (!account.state) return '加载后显示'
  const { login, verification, connection } = account.state
  return [
    login === 'signed-in' ? '已登录' : login === 'signed-out' ? '未登录' : '登录待确认',
    verification === 'required' ? '需要验证' : '',
    connection === 'unavailable' ? '连接不可用' : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
const createdAtLabel = computed(() => formatCatalogDrawerCreatedAt(props.drawer.createdAtMs))
const createdAtIso = computed(() =>
  props.drawer.createdAtMs !== undefined && createdAtLabel.value !== '时间未知'
    ? new Date(props.drawer.createdAtMs).toISOString()
    : undefined,
)
const paginationLabel = computed(() => {
  if (isCatalogDrawerDisconnected(props.drawer)) return '暂不加载新歌曲'
  if (props.drawer.hasMore) return '还有更多'
  return props.drawer.status === 'ready' ? '已到末尾' : ''
})
</script>

<template>
  <section ref="copyContainer" class="catalog-list-details" aria-label="音乐列表完整信息">
    <button
      class="catalog-list-details__copy catalog-list-details__copy-all"
      type="button"
      aria-label="复制完整信息"
      title="复制完整信息为 JSON"
      :disabled="informationCopy.isCopying.value || props.suspended"
      @click="informationCopy.copy"
    >
      <AppIcon name="copy" :size="18" />
    </button>
    <dl class="catalog-list-details__summary">
      <div class="catalog-list-details__item catalog-list-details__title">
        <dt>列表名称</dt>
        <dd>{{ props.drawer.title }}</dd>
      </div>
      <div class="catalog-list-details__item">
        <dt>音乐源</dt>
        <dd class="catalog-list-details__source">
          <AppIcon name="playlist" :size="16" />{{ props.drawer.pluginName }}
        </dd>
      </div>
      <div class="catalog-list-details__item">
        <dt>请求方式</dt>
        <dd>{{ kindLabel }}</dd>
      </div>
    </dl>
    <dl class="catalog-list-details__account" aria-label="列表请求账号">
      <div class="catalog-list-details__item">
        <dt>账号名称</dt>
        <dd>{{ accountLabel }}</dd>
      </div>
      <div class="catalog-list-details__item">
        <dt>账号状态</dt>
        <dd>
          {{ accountStatusLabel }}
        </dd>
      </div>
    </dl>
    <dl class="catalog-list-details__request">
      <div class="catalog-list-details__item catalog-list-details__input">
        <dt>{{ props.drawer.kind === 'search' ? '原始搜索词' : '导入链接' }}</dt>
        <dd>
          <span>{{ props.drawer.input }}</span>
          <button
            class="catalog-list-details__copy"
            type="button"
            :aria-label="props.drawer.kind === 'search' ? '复制原始搜索词' : '复制导入链接'"
            :title="props.drawer.kind === 'search' ? '复制原始搜索词' : '复制导入链接'"
            :disabled="inputCopy.isCopying.value || props.suspended"
            @click="inputCopy.copy"
          >
            <AppIcon name="copy" :size="18" />
          </button>
        </dd>
      </div>
      <div class="catalog-list-details__item catalog-list-details__created-at">
        <dt>{{ props.drawer.kind === 'search' ? '搜索时间' : '导入时间' }}</dt>
        <dd>
          <time v-if="createdAtIso" :datetime="createdAtIso">{{ createdAtLabel }}</time>
          <span v-else>{{ createdAtLabel }}</span>
        </dd>
      </div>
      <div class="catalog-list-details__item">
        <dt>列表状态</dt>
        <dd>{{ statusLabel }}</dd>
      </div>
      <div class="catalog-list-details__item">
        <dt>置顶状态</dt>
        <dd>{{ props.drawer.isPinned ? '已置顶' : '未置顶' }}</dd>
      </div>
      <div class="catalog-list-details__item catalog-list-details__progress">
        <dt>加载概况</dt>
        <dd>
          {{ props.drawer.tracks.length }} 首已加载 · {{ props.drawer.loadedPageCount }} 页内容
          <span v-if="paginationLabel"> · {{ paginationLabel }}</span>
        </dd>
      </div>
    </dl>
    <p
      v-for="(feedback, index) in copyFeedback"
      :key="index"
      class="catalog-list-details__feedback"
      :data-status="feedback.status"
      role="status"
    >
      {{ feedback.message }}
    </p>
  </section>
</template>

<style scoped>
.catalog-list-details {
  position: relative;
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
  margin: 0 0 var(--am-space-1);
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
  font-size: var(--am-font-size-sm);
  line-height: 1.6;
}

.catalog-list-details__summary,
.catalog-list-details__account,
.catalog-list-details__request {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-3) var(--am-space-4);
  min-inline-size: 0;
  margin: 0;
}

.catalog-list-details__account,
.catalog-list-details__request {
  padding-block-start: var(--am-space-3);
  border-block-start: 1px solid var(--am-color-border);
}

.catalog-list-details__item {
  display: grid;
  min-inline-size: 0;
  align-content: start;
  gap: var(--am-space-1);
}

.catalog-list-details__title,
.catalog-list-details__input,
.catalog-list-details__created-at,
.catalog-list-details__progress {
  grid-column: 1 / -1;
}

.catalog-list-details__title dd {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
  line-height: 1.4;
}

.catalog-list-details__title {
  padding-inline-end: 44px;
}

.catalog-list-details__source {
  display: flex;
  align-items: baseline;
  gap: var(--am-space-2);
}

.catalog-list-details__source :deep(svg) {
  flex-shrink: 0;
  align-self: center;
  color: var(--am-color-text-secondary);
}

.catalog-list-details__input dd {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
}

.catalog-list-details__input dd > span {
  min-inline-size: 0;
  flex: 1;
}

.catalog-list-details__copy {
  display: inline-flex;
  inline-size: 44px;
  block-size: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  cursor: pointer;
}

.catalog-list-details__copy-all {
  position: absolute;
  inset-block-start: var(--am-space-2);
  inset-inline-end: var(--am-space-2);
}

.catalog-list-details__copy:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}

.catalog-list-details__copy:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.catalog-list-details__copy:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}

.catalog-list-details__feedback {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}

.catalog-list-details__feedback[data-status='error'] {
  color: var(--am-color-danger);
}

.catalog-list-details dt {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-list-details dd {
  min-inline-size: 0;
  margin: 0;
  color: var(--am-color-text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}

@container am-dialog (max-width: 340px) {
  .catalog-list-details__summary,
  .catalog-list-details__account,
  .catalog-list-details__request {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
