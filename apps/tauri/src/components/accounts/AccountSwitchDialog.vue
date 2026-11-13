<script setup lang="ts">
import { AppDialog, AppIcon } from '@any-music/ui'
import { computed } from 'vue'

import {
  accountStatus,
  platformName as getPlatformName,
} from '../../features/accounts/account-presentation'
import type { NativeAccount, NativeProxy } from '../../features/accounts/account-runtime'

const props = defineProps<{
  platformId: string | null
  accounts: readonly NativeAccount[]
  userNames: ReadonlyMap<string, string>
  proxies: readonly NativeProxy[]
  selectedId: string | null
  busy: boolean
  error: string
}>()
const emit = defineEmits<{ select: [id: string | null]; refresh: []; manage: []; close: [] }>()
const platformName = computed(() => (props.platformId ? getPlatformName(props.platformId) : ''))
const rows = computed(() =>
  props.accounts.map((account) => {
    const userName = props.userNames.get(account.id)?.trim()
    const customName = account.name.trim()
    return {
      account,
      name:
        userName && customName && userName !== customName
          ? `${userName}（${customName}）`
          : userName || customName,
      status: accountStatus(account),
      proxy: props.proxies.find((proxy) => proxy.id === account.proxyId)?.name ?? '直连',
    }
  }),
)
</script>

<template>
  <AppDialog
    :open="platformId !== null"
    :title="`${platformName} · 切换账号`"
    description="选择此平台使用的账号，或从可用账号中随机选择。"
    size="compact"
    @close="emit('close')"
  >
    <div class="account-switcher" :aria-busy="busy">
      <p v-if="error" class="settings-form__error" role="alert">{{ error }}</p>
      <div class="account-switcher__options" role="group" aria-label="可用账号">
        <button
          class="account-switcher__option"
          type="button"
          :aria-pressed="selectedId === null"
          :disabled="busy"
          @click="emit('select', null)"
        >
          <AppIcon name="refresh" />
          <span><strong>随机</strong><small>从已启用的可用账号中选择</small></span>
          <AppIcon v-if="selectedId === null" name="check" />
        </button>
        <button
          v-for="row in rows"
          :key="row.account.id"
          class="account-switcher__option"
          type="button"
          :aria-pressed="selectedId === row.account.id"
          :disabled="busy || !row.account.enabled"
          :title="row.name"
          @click="emit('select', row.account.id)"
        >
          <AppIcon name="user" />
          <span
            ><strong>{{ row.name }}</strong
            ><small>{{ row.status }} · {{ row.proxy }}</small></span
          >
          <AppIcon v-if="selectedId === row.account.id" name="check" />
        </button>
      </div>
      <p v-if="!accounts.length" class="settings-form__hint">
        还没有此平台的账号，请在账号管理中添加。
      </p>
      <p class="settings-form__hint">
        切换会中止此平台正在进行的请求。已有列表仍显示原内容，重新搜索或导入时使用新账号。
      </p>
    </div>
    <template #footer>
      <div class="settings-form__footer">
        <button
          class="native-settings__button"
          type="button"
          :disabled="busy"
          @click="emit('refresh')"
        >
          <AppIcon name="refresh" :size="16" />刷新状态
        </button>
        <button class="settings-form__save" type="button" :disabled="busy" @click="emit('manage')">
          管理账号
        </button>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.account-switcher,
.account-switcher__options {
  display: grid;
  gap: var(--am-space-3);
}
.account-switcher__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3);
  min-block-size: 68px;
  padding: var(--am-space-3) var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-background);
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.account-switcher__option span {
  display: grid;
  gap: var(--am-space-1);
  overflow-wrap: anywhere;
}
.account-switcher__option small {
  color: var(--am-color-text-secondary);
}
.account-switcher__option[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-surface-hover);
  color: var(--am-color-primary);
}
.account-switcher__option:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.account-switcher__option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.account-switcher__option:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
