<script setup lang="ts">
import { AppDialog, AppIcon } from '@any-music/ui'
import { computed, useTemplateRef } from 'vue'

import { useAccountPageLayout } from '../../features/accounts/use-account-page-layout'
import { useAccountPage } from '../../platform/account-page'

// The official page is a native view drawn over the placeholder; this dialog owns only chrome.
// It shares the protected overlay host with account settings and mounts last, staying above them.
defineProps<{ overlayTarget?: HTMLElement | null }>()
const page = useAccountPage()
const presentation = computed(() => page.current.value)
const placeholder = useTemplateRef<HTMLElement>('placeholder')
const visible = computed(() => presentation.value?.state === 'visible')
useAccountPageLayout(placeholder, () =>
  presentation.value
    ? { accountId: presentation.value.accountId, visible: visible.value }
    : undefined,
)
// An isolated challenge reserves its own size plus a small margin; full pages use the dialog.
const isolated = computed(
  () => visible.value && !!presentation.value?.width && !!presentation.value?.height,
)
const frameStyle = computed(() =>
  isolated.value
    ? {
        inlineSize: `min(100%, ${Math.ceil(presentation.value!.width! + 16)}px)`,
        blockSize: `min(64vh, ${Math.ceil(presentation.value!.height! + 16)}px)`,
      }
    : undefined,
)
const pendingText = computed(() =>
  presentation.value?.mode === 'challenge'
    ? '正在后台加载官方页面，需要验证时会在这里显示验证内容。'
    : '正在加载官方页面…',
)
</script>

<template>
  <Teleport :to="overlayTarget ?? 'body'" :disabled="!overlayTarget">
    <AppDialog
      :open="!!presentation"
      :title="presentation?.title ?? ''"
      :description="presentation?.description"
      :size="isolated || !visible ? 'compact' : 'wide'"
      @close="page.close"
    >
      <div class="account-page" :aria-busy="!visible">
        <p v-if="presentation?.status" class="settings-form__hint" role="alert">
          {{ presentation.status }}
        </p>
        <div
          v-show="visible"
          ref="placeholder"
          class="account-page__frame"
          :class="{ 'account-page__frame--isolated': isolated }"
          :style="frameStyle"
          aria-label="官方页面"
        ></div>
        <p v-if="!visible" class="account-page__pending" role="status">
          <AppIcon name="refresh" class="account-page__spinner" />{{ pendingText }}
        </p>
      </div>
      <template v-if="presentation?.actionLabel" #footer>
        <div class="settings-form__footer">
          <button
            class="settings-form__save"
            type="button"
            :disabled="presentation.busy"
            @click="page.action"
          >
            {{ presentation.busy ? '正在确认…' : presentation.actionLabel }}
          </button>
        </div>
      </template>
    </AppDialog>
  </Teleport>
</template>

<style scoped>
.account-page {
  display: grid;
  gap: var(--am-space-3);
  justify-items: center;
}
.account-page__frame {
  inline-size: 100%;
  block-size: min(620px, 64vh);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
  overflow: hidden;
}
.account-page__frame--isolated {
  background: transparent;
}
.account-page__pending {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  margin: 0;
  padding: var(--am-space-6) var(--am-space-4);
  color: var(--am-color-text-secondary);
  line-height: 1.7;
}
.account-page__spinner {
  flex: 0 0 auto;
  animation: account-page-spin 1s linear infinite;
}
@keyframes account-page-spin {
  to {
    transform: rotate(1turn);
  }
}
@media (prefers-reduced-motion: reduce) {
  .account-page__spinner {
    animation: none;
  }
}
</style>
