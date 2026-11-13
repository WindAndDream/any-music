<script setup lang="ts">
import { formatAppErrorMessage } from '@any-music/core'
import type { MusicSourceSession } from '@any-music/core'
import { computed } from 'vue'

import AppIcon from '../AppIcon.vue'

// 会话徽标渲染 core 状态机，并通过事件把登录/刷新意图交回应用层。
const props = withDefaults(
  defineProps<{
    session: MusicSourceSession
    refreshing: boolean
    /** 列表标题上方的小号账号行保留登录和刷新能力，不抢占主标题层级。 */
    compact?: boolean
    /** 手机列表用账号替代标题，保留状态灯、名称与刷新入口。 */
    prominent?: boolean
    switchable?: boolean
    accountMissing?: boolean
    /** 运行端选择偏好与检查到的登录身份分别展示；随机模式不能冒充固定账号。 */
    accountLabel?: string
  }>(),
  { compact: false, prominent: false },
)

const emit = defineEmits<{
  login: []
  refresh: []
  selectAccount: []
  addAccount: []
}>()

const isExpired = computed(() => !props.accountMissing && props.session.status === 'expired')

const label = computed(() => {
  if (props.accountMissing) return '无账号'
  if (props.accountLabel) return props.accountLabel
  // 刷新时保留已知账号名称，进度由刷新控件反馈，避免身份行闪动。
  if (props.session.status === 'signed-in')
    return props.session.user.customName?.trim() || props.session.user.name
  if (isExpired.value) return '登录已失效'
  if (props.refreshing) return '检查中…'
  if (props.session.status === 'checking') return '检查中…'
  if (props.session.status === 'not-required') return '无需登录'
  if (props.session.status === 'signed-out') return '未登录'
  return '状态不可用'
})

const errorMessage = computed(() =>
  props.session.status === 'expired' || props.session.status === 'unavailable'
    ? formatAppErrorMessage(props.session.error)
    : undefined,
)
</script>

<template>
  <div
    class="session"
    :class="{ 'session--compact': props.compact, 'session--heading': props.prominent }"
    :data-status="props.accountMissing ? 'signed-out' : session.status"
    :title="props.accountMissing ? undefined : errorMessage"
  >
    <span class="session__dot" aria-hidden="true"></span>
    <button
      v-if="props.switchable"
      class="session__label session__account"
      type="button"
      aria-haspopup="dialog"
      :aria-label="props.accountMissing ? '添加平台账号' : `切换平台账号：${label}`"
      :title="label"
      @click="props.accountMissing ? emit('addAccount') : emit('selectAccount')"
    >
      <AppIcon name="user" :size="16" /><span>{{ label }}</span
      ><AppIcon name="arrow-down" :size="12" />
    </button>
    <span
      v-else
      class="session__label"
      :title="label"
      :aria-label="
        props.prominent && session.status === 'signed-in'
          ? `用户名：${label}，${refreshing ? '检查中' : '已登录'}`
          : undefined
      "
      :role="props.prominent ? 'heading' : undefined"
      :aria-level="props.prominent ? 2 : undefined"
      >{{ label }}</span
    >
    <span v-if="isExpired && props.accountLabel" class="session__status" aria-live="polite">
      登录已失效
    </span>
    <span
      v-else-if="
        !props.accountMissing && props.compact && !props.prominent && session.status === 'signed-in'
      "
      class="session__status"
      aria-live="polite"
    >
      {{ refreshing ? '检查中…' : '已登录' }}
    </span>
    <button
      v-if="!isExpired"
      class="session__button"
      type="button"
      :disabled="refreshing && !props.accountMissing"
      :aria-busy="refreshing && !props.accountMissing"
      :aria-label="
        props.accountMissing ? '添加账号' : refreshing ? '正在刷新平台用户状态' : '刷新平台用户状态'
      "
      :title="
        props.accountMissing ? '添加账号' : refreshing ? '正在刷新平台用户状态' : '刷新平台用户状态'
      "
      @click="props.accountMissing ? emit('addAccount') : emit('refresh')"
    >
      <AppIcon
        v-if="props.compact && !props.accountMissing"
        class="session__refresh-icon"
        :class="{ 'session__refresh-icon--spinning': refreshing }"
        name="refresh"
        :size="props.prominent ? 17 : 15"
      />
      <template v-else>{{
        props.accountMissing ? '添加' : refreshing ? '检查中…' : '刷新'
      }}</template>
    </button>
    <button
      v-if="
        !props.accountMissing && (session.status === 'signed-out' || session.status === 'expired')
      "
      class="session__button"
      type="button"
      @click="emit('login')"
    >
      登录
    </button>
  </div>
</template>

<style scoped>
.session__account {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  padding: 0 var(--am-space-2);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.session__account span {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session__account:hover {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}
.session__account:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.session--compact {
  min-inline-size: 0;
  max-inline-size: 100%;
  gap: var(--am-space-2);
  padding-inline: 0;
  border: 0;
  background: transparent;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.session--compact .session__dot {
  flex: 0 0 auto;
  inline-size: 6px;
  block-size: 6px;
}
.session--compact .session__label {
  min-inline-size: 0;
  max-inline-size: min(48cqi, 200px);
  max-width: none;
  font-weight: 650;
}
.session__status {
  flex: 0 0 auto;
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
}
.session--compact .session__button {
  display: inline-flex;
  flex: 0 0 auto;
  min-inline-size: 44px;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 var(--am-space-1);
  border-color: transparent;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  touch-action: manipulation;
}
.session--compact .session__button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}
.session--compact .session__button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.session__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.session--heading {
  inline-size: 100%;
  gap: var(--am-space-1);
}
.session--heading .session__label {
  flex: 0 1 auto;
  min-inline-size: 0;
  max-inline-size: none;
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
  font-weight: 750;
  letter-spacing: -0.015em;
}
.session__refresh-icon--spinning {
  animation: session-refresh 0.9s linear infinite;
}
@keyframes session-refresh {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 768px) {
  .session {
    inline-size: fit-content;
    max-inline-size: 100%;
  }
  .session__label {
    min-inline-size: 0;
    max-width: none;
  }
  .session__account .app-icon,
  .session__button {
    flex-shrink: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .session__refresh-icon--spinning {
    animation: none;
  }
}
</style>
