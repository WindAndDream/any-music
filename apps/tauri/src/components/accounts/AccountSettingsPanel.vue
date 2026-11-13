<script setup lang="ts">
import { AppIcon } from '@any-music/ui'
import { computed, onScopeDispose, watch } from 'vue'

import type { AccountSettingsController } from '../../features/accounts/use-account-settings'
import AccountPlatformList from './AccountPlatformList.vue'

const props = defineProps<{
  settings: AccountSettingsController
  detailOpenChange?: (open: boolean) => void
}>()
const busy = computed(() => props.settings.busy.value || props.settings.checking.value)
const hasEnabledAccounts = computed(() =>
  props.settings.snapshot.value.accounts.some(
    (account) =>
      account.enabled &&
      props.settings.platforms.some((platform) => platform.id === account.platformId),
  ),
)
// The protected account popup suspends settings while this overview is mounted.
watch(props.settings.detailOpen, (open) => props.detailOpenChange?.(open), { immediate: true })
// App owns session closure; presentation disposal releases only its focus trap.
onScopeDispose(() => props.detailOpenChange?.(false))
</script>
<template>
  <div class="settings-form settings-form__card native-settings account-settings">
    <div class="settings-form__heading">
      <h4>平台账号</h4>
      <p class="settings-form__hint">按需添加账号，各账号独立保存登录状态与连接设置。</p>
    </div>
    <p
      v-if="settings.error.value && !settings.detailOpen.value"
      class="settings-form__error"
      role="alert"
    >
      {{ settings.error.value }}
    </p>
    <p v-if="settings.checkSummary.value" class="settings-form__hint" role="status">
      {{ settings.checkSummary.value }}
    </p>
    <AccountPlatformList
      :platforms="settings.platforms"
      :accounts="settings.snapshot.value.accounts"
      :busy="settings.busy.value"
      @select="settings.selectPlatform"
    />
    <div class="settings-form__footer account-settings__toolbar">
      <button
        v-if="settings.checking.value"
        class="native-settings__button"
        type="button"
        @click="settings.cancelChecks"
      >
        取消检测
      </button>
      <button
        class="native-settings__button"
        type="button"
        :disabled="busy || !hasEnabledAccounts"
        @click="settings.checkAll"
      >
        <AppIcon name="refresh" :size="16" />{{ settings.checking.value ? '检测中…' : '一键检测' }}
      </button>
      <button
        class="settings-form__save"
        type="button"
        :disabled="busy || !settings.platforms.length"
        aria-haspopup="dialog"
        @click="settings.startAdd()"
      >
        <AppIcon name="plus" :size="16" />添加账号
      </button>
    </div>
  </div>
</template>
<style scoped>
.account-settings {
  gap: var(--am-space-4);
}
</style>
