<script setup lang="ts">
import { AppIcon } from '@any-music/ui'

import {
  accountStatus,
  canLogin,
  isSignedIn,
  connectionSummary,
  platformName,
} from '../../features/accounts/account-presentation'
import type { NativeAccount, NativeProxy } from '../../features/accounts/account-runtime'
defineProps<{
  account: NativeAccount
  platformLabel?: string
  proxies: NativeProxy[]
  busy: boolean
  checking?: boolean
  checkMessage?: string
}>()
const emit = defineEmits<{
  editName: []
  connection: []
  login: []
  check: []
  update: [account: NativeAccount]
}>()
</script>
<template>
  <div class="native-settings__identity">
    <AppIcon name="user" :size="28" />
    <div>
      <strong>{{ account.name }}</strong>
      <p class="settings-form__hint">
        {{ platformLabel ?? platformName(account.platformId) }} · {{ accountStatus(account) }}
      </p>
    </div>
  </div>
  <div class="native-settings__entries">
    <button class="native-settings__entry" type="button" :disabled="busy" @click="emit('editName')">
      <AppIcon name="edit" /><span
        ><strong>账号名称</strong><small>{{ account.name }}</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      v-if="!account.platformId.startsWith('external:')"
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      @click="emit('connection')"
    >
      <AppIcon name="link" /><span
        ><strong>请求连接</strong><small>{{ connectionSummary(account, proxies) }}</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      class="native-settings__entry"
      type="button"
      :disabled="busy || !canLogin(account)"
      @click="emit('login')"
    >
      <AppIcon name="qr-code" /><span
        ><strong>登录 / 验证</strong
        ><small>{{
          !account.enabled
            ? '启用账号后可登录'
            : canLogin(account)
              ? '二维码或系统浏览器'
              : isSignedIn(account)
                ? '已登录，可检测当前状态'
                : '登录待确认，请先检测账号'
        }}</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      class="native-settings__entry"
      type="button"
      :disabled="busy || !account.enabled"
      @click="emit('check')"
    >
      <AppIcon name="refresh" /><span
        ><strong>{{ checking ? '正在检测…' : '检测账号状态' }}</strong
        ><small>{{ checkMessage || '检查当前登录是否有效' }}</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
  </div>
  <div class="native-settings__heading native-settings__heading--row">
    <div>
      <h4>启用账号</h4>
      <p class="settings-form__hint">停用会结束此账号正在进行的请求。</p>
    </div>
    <button
      class="settings-switch"
      type="button"
      role="switch"
      :aria-checked="account.enabled"
      aria-label="启用账号"
      :disabled="busy"
      @click="emit('update', { ...account, enabled: !account.enabled })"
    >
      <span class="settings-switch__thumb"></span>
    </button>
  </div>
</template>
