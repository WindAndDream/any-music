<script setup lang="ts">
import { AppIcon } from '@any-music/ui'

import { accountStatus, connectionSummary } from '../../features/accounts/account-presentation'
import type { NativeAccount, NativeProxy } from '../../features/accounts/account-runtime'
import type { AccountCheckResult } from '../../features/accounts/use-account-checks'
const props = defineProps<{
  accounts: NativeAccount[]
  proxies: NativeProxy[]
  checkingId?: string
  busy: boolean
  checkResults: ReadonlyMap<string, AccountCheckResult>
}>()
// Keep known account facts on failed checks; a valid login replaces the duplicate login label.
function statusMessage(account: NativeAccount): string {
  const status = accountStatus(account)
  const result = props.checkResults.get(account.id)
  if (!account.enabled || !result?.message) return status
  return result.status === 'signed-in' && status === '已登录'
    ? result.message
    : `${status} · ${result.message}`
}
const emit = defineEmits<{
  select: [account: NativeAccount]
  check: [account: NativeAccount]
}>()
</script>
<template>
  <p v-if="!accounts.length" class="native-settings__empty">此平台尚未添加账号。</p>
  <ul v-else class="account-list" aria-label="已保存的账号">
    <li v-for="account in accounts" :key="account.id" class="account-list__item">
      <button
        class="native-settings__entry account-list__details"
        type="button"
        :disabled="busy"
        :aria-label="`管理 ${account.name}`"
        @click="emit('select', account)"
      >
        <AppIcon name="user" /><span
          ><strong>{{ account.name }}</strong
          ><small role="status" aria-atomic="true"
            >{{ statusMessage(account) }} · {{ connectionSummary(account, proxies) }}</small
          ></span
        ><AppIcon name="arrow-right" :size="18" />
      </button>
      <button
        class="native-settings__button account-list__check"
        type="button"
        :disabled="busy || !account.enabled"
        :aria-label="`检测 ${account.name}`"
        @click="emit('check', account)"
      >
        <AppIcon name="refresh" :size="16" />{{ checkingId === account.id ? '检测中…' : '检测' }}
      </button>
    </li>
  </ul>
</template>
<style scoped>
.account-list {
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  overflow: hidden;
}
.account-list__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--am-space-2);
  background: var(--am-color-surface);
}
.account-list__item + .account-list__item {
  border-block-start: 1px solid var(--am-color-border);
}
.account-list__details {
  min-block-size: 64px;
  padding: var(--am-space-3);
}
.account-list__check {
  margin-inline-end: var(--am-space-3);
  padding-inline: var(--am-space-3);
}
@container native-settings (max-width: 340px) {
  .account-list__details {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--am-space-2);
  }
  .account-list__details > :first-child {
    display: none;
  }
}
</style>
