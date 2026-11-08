<script setup lang="ts">
import type { UiCatalogErrorDetailsProps, UiCatalogErrorDetailsEmits } from '@any-music/ui/catalog'
import {
  getCatalogDrawerErrorMessage,
  getCatalogDrawerKindLabel,
  getCatalogDrawerErrorGuide,
} from '@any-music/ui/catalog'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { computed } from 'vue'

// 错误详情把完整原因、已加载进度与可执行步骤分开；来源管理和歌曲页由宿主导航。
const props = defineProps<UiCatalogErrorDetailsProps>()

const emit = defineEmits<UiCatalogErrorDetailsEmits>()

const errorMessage = computed(() => getCatalogDrawerErrorMessage(props.drawer))
const kindLabel = computed(() => getCatalogDrawerKindLabel(props.drawer))
const guide = computed(() => getCatalogDrawerErrorGuide(props.drawer))
// 验证完成后 loading 先更新，列表结果状态稍后更新；旧错误不能覆盖这段恢复进度。
const isRecovering = computed(() => props.drawer.isLoading || props.drawer.status === 'restoring')
const isProgress = computed(() => isRecovering.value || Boolean(props.drawer.isVerifying))
const summaryTitle = computed(() =>
  isRecovering.value ? '正在重新加载列表' : props.drawer.isVerifying ? '正在等待验证' : '错误原因',
)
const summaryMessage = computed(() => {
  if (isRecovering.value) return '正在重新加载第一页，请稍候。'
  if (props.drawer.verificationPhase === 'opening') return '正在打开此账号的验证浏览器，请稍候。'
  if (props.drawer.verificationPhase === 'confirming')
    return '正在确认验证结果并保存账号凭证，请稍候。'
  if (props.drawer.verificationPhase === 'restoring')
    return '验证已通过，正在更新账号并重新加载列表。'
  if (props.drawer.isVerifying) return '请在账号浏览器中完成安全验证。'
  return errorMessage.value || '当前列表暂时无法继续加载。'
})
</script>

<template>
  <section class="catalog-error-details" aria-label="音乐列表错误详情">
    <div
      class="catalog-error-details__summary"
      :class="{ 'catalog-error-details__summary--progress': isProgress }"
      :role="isProgress ? 'status' : undefined"
    >
      <span class="catalog-error-details__icon" aria-hidden="true">
        <AppIcon :name="isProgress ? 'refresh' : 'warning'" :size="24" />
      </span>
      <div>
        <span>{{ summaryTitle }}</span>
        <strong>{{ summaryMessage }}</strong>
      </div>
    </div>

    <p
      v-if="props.drawer.verificationErrorMessage && !isProgress"
      role="alert"
      class="catalog-error-details__action-error"
    >
      验证操作未完成：{{ props.drawer.verificationErrorMessage }}
      {{ props.drawer.canVerify ? '可再次点击验证。' : '请检查账号设置后重试。' }}
    </p>
    <p v-else-if="props.drawer.verificationPhase === 'cancelled' && !isProgress" role="status">
      验证已取消，当前请求仍需要验证，可再次点击验证。
    </p>

    <dl class="catalog-error-details__context">
      <div>
        <dt>列表</dt>
        <dd>{{ props.drawer.title }}</dd>
      </div>
      <div>
        <dt>请求</dt>
        <dd>{{ props.drawer.pluginName }} · {{ kindLabel }} · {{ props.drawer.input }}</dd>
      </div>
      <div>
        <dt>进度</dt>
        <dd>已加载 {{ props.drawer.tracks.length }} 首，{{ props.drawer.loadedPageCount }} 页</dd>
      </div>
      <div v-if="props.drawer.failureOperation && !isProgress">
        <dt>发生位置</dt>
        <dd>
          {{
            {
              search: '搜索第一页',
              import: '链接导入',
              pagination: '加载后续页',
              restore: '重新加载列表',
            }[props.drawer.failureOperation]
          }}
        </dd>
      </div>
      <div v-if="props.drawer.account?.state">
        <dt>账号状态</dt>
        <dd>
          {{
            { 'signed-in': '已登录', 'signed-out': '未登录', unknown: '登录待确认' }[
              props.drawer.account.state.login
            ]
          }}{{ props.drawer.account.state.verification === 'required' ? ' · 需要安全验证' : ''
          }}{{ props.drawer.account.state.connection === 'unavailable' ? ' · 连接不可用' : '' }}
        </dd>
      </div>
      <div v-if="props.drawer.errorCode && !isProgress">
        <dt>错误代码</dt>
        <dd>{{ props.drawer.errorCode }}</dd>
      </div>
    </dl>

    <div v-if="!isRecovering" class="catalog-error-details__guide">
      <span>处理指引</span>
      <h3>{{ props.drawer.canVerify ? '在账号浏览器中完成验证' : guide.title }}</h3>
      <p v-if="props.drawer.canVerify">
        {{
          props.drawer.isVerifying
            ? '请在打开的浏览器中完成安全验证。验证通过后浏览器会自动关闭，列表从第一页重新加载。'
            : '点击“验证”打开此列表所用账号的浏览器；完成后会自动关闭浏览器并重新加载列表。'
        }}
        <strong v-if="!props.drawer.isVerifying" class="catalog-error-details__retry-note">
          完成验证前，点击“重试”仍可能出现相同错误。
        </strong>
      </p>
      <ol v-else>
        <li v-for="step in guide.steps" :key="step">{{ step }}</li>
      </ol>
      <p v-if="props.drawer.tracks.length > 0">
        已加载的
        {{ props.drawer.tracks.length }}
        首歌曲仍可查看或加入“我的喜欢”；尚未加载的分页不在本次操作中。
        重试会从第一页重新加载，请先收藏需要保留的歌曲。
      </p>
    </div>

    <div class="catalog-error-details__actions">
      <button
        v-if="props.drawer.tracks.length > 0"
        class="catalog-error-details__secondary"
        type="button"
        :disabled="isProgress"
        @click="emit('view', props.drawer.id)"
      >
        查看已加载歌曲
      </button>
      <button
        v-if="props.drawer.canVerify"
        class="catalog-error-details__secondary"
        type="button"
        :disabled="isProgress"
        @click="emit('verify', props.drawer.id)"
      >
        {{
          props.drawer.verificationPhase === 'opening'
            ? '正在打开…'
            : props.drawer.isVerifying
              ? '等待验证…'
              : props.drawer.verificationPhase === 'failed'
                ? '重新验证'
                : '验证'
        }}
      </button>
      <button
        v-if="props.drawer.isVerifying"
        class="catalog-error-details__secondary"
        type="button"
        @click="emit('cancelVerification', props.drawer.id)"
      >
        {{ props.drawer.verificationPhase === 'restoring' ? '取消加载' : '取消验证' }}
      </button>
      <button
        v-if="
          props.drawer.status === 'paused' ||
          props.drawer.status === 'missing' ||
          !props.drawer.isSourceEnabled
        "
        type="button"
        @click="emit('openPlugins')"
      >
        打开插件中心
      </button>
      <button v-else type="button" :disabled="isProgress" @click="emit('retry', props.drawer.id)">
        {{ isRecovering ? '正在重试…' : '重试' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.catalog-error-details {
  display: grid;
  gap: var(--am-space-5);
}

.catalog-error-details__action-error {
  margin: 0;
  color: var(--am-color-danger);
  overflow-wrap: anywhere;
}

.catalog-error-details__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--am-space-3);
  align-items: center;
  padding: var(--am-space-4);
  border: 1px solid color-mix(in srgb, var(--am-color-danger) 32%, var(--am-color-border));
  border-radius: var(--am-radius-card);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-error-details__icon {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  border-radius: var(--am-radius-control);
  background: color-mix(in srgb, var(--am-color-danger) 14%, transparent);
}

.catalog-error-details__summary--progress {
  border-color: var(--am-color-border);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
}

.catalog-error-details__summary--progress .catalog-error-details__icon {
  background: var(--am-color-surface);
}

.catalog-error-details__summary > div > span,
.catalog-error-details__summary strong {
  display: block;
}

.catalog-error-details__summary span {
  font-size: var(--am-font-size-xs);
  font-weight: 700;
}

.catalog-error-details__summary strong {
  margin-block-start: var(--am-space-1);
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
}

.catalog-error-details__context {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-2);
  margin: 0;
}

.catalog-error-details__context div {
  min-inline-size: 0;
  padding: var(--am-space-3);
  border-radius: var(--am-radius-sm);
  background: var(--am-color-surface-subtle);
}

.catalog-error-details__context dt,
.catalog-error-details__context dd {
  margin: 0;
}

.catalog-error-details__context dt,
.catalog-error-details__guide > span,
.catalog-error-details__guide p {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.catalog-error-details__context dd {
  margin-block-start: var(--am-space-1);
  overflow-wrap: anywhere;
  color: var(--am-color-text);
  font-weight: 650;
}

.catalog-error-details__guide {
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-background);
}

.catalog-error-details__guide h3,
.catalog-error-details__guide ol,
.catalog-error-details__guide p {
  margin: 0;
}

.catalog-error-details__guide h3 {
  margin-block-start: var(--am-space-1);
  font-size: var(--am-font-size-md);
}

.catalog-error-details__guide ol {
  display: grid;
  gap: var(--am-space-2);
  margin-block-start: var(--am-space-3);
  padding-inline-start: var(--am-space-5);
}

.catalog-error-details__guide p {
  margin-block-start: var(--am-space-4);
  padding-block-start: var(--am-space-3);
  border-block-start: 1px dashed var(--am-color-border);
}

.catalog-error-details__retry-note {
  font-weight: 700;
}

.catalog-error-details__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--am-space-2);
}

.catalog-error-details__actions button {
  /* 按钮按文案保留自然宽度，窄屏空间不足时换行，而不拉伸成整行。 */
  display: inline-flex;
  flex: 0 1 auto;
  min-inline-size: calc(2 * var(--am-size-control));
  max-inline-size: 100%;
  min-block-size: var(--am-size-control);
  align-items: center;
  justify-content: center;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.catalog-error-details__actions .catalog-error-details__secondary {
  background: var(--am-color-surface);
  color: var(--am-color-primary);
}

.catalog-error-details__actions button {
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}

.catalog-error-details__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@container am-dialog (max-width: 520px) {
  .catalog-error-details__context {
    grid-template-columns: 1fr;
  }
}
</style>
