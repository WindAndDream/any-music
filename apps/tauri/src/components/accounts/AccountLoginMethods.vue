<script setup lang="ts">
import type { AccountLoginCapabilities } from '@any-music/core'
import { AppIcon } from '@any-music/ui'

import type { AccountAuthentication } from '../../features/accounts/source-authentication'

defineProps<{
  capabilities: AccountLoginCapabilities
  busy: boolean
  qrUnavailable: boolean
  authentication: AccountAuthentication
}>()
const emit = defineEmits<{ qr: []; browser: []; credentials: []; phone: []; withoutLogin: [] }>()
</script>
<template>
  <div class="native-settings__entries" aria-label="登录方式">
    <button
      v-if="authentication.methods.includes('qr')"
      class="native-settings__entry"
      type="button"
      :disabled="busy || qrUnavailable || capabilities.qrPresentation === 'unavailable'"
      @click="emit('qr')"
    >
      <AppIcon name="qr-code" /><span>
        <strong>{{
          capabilities.qrPresentation === 'handoff' ? '哔哩哔哩扫码授权' : '二维码登录'
        }}</strong>
        <small>{{
          qrUnavailable || capabilities.qrPresentation === 'unavailable'
            ? authentication.methods.length === 1
              ? '二维码暂不可用，请稍后重试'
              : '二维码暂不可用，请选择其他方式登录'
            : capabilities.qrPresentation === 'handoff'
              ? '打开本机哔哩哔哩应用，确认授权后返回'
              : '使用平台手机客户端扫码'
        }}</small> </span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      v-if="
        authentication.methods.includes('system-browser') &&
        capabilities.verification === 'system-browser'
      "
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      @click="emit('browser')"
    >
      <AppIcon name="external-link" /><span
        ><strong>使用系统浏览器</strong> <small>在此账号独立的浏览器窗口中登录或验证</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      v-if="authentication.methods.includes('credentials')"
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      @click="emit('credentials')"
    >
      <AppIcon name="key" /><span
        ><strong>输入凭证</strong><small>按来源要求输入 Token、API Key 或其他凭证</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      v-if="authentication.methods.includes('phone')"
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      @click="emit('phone')"
    >
      <AppIcon name="phone" /><span
        ><strong>手机号登录</strong><small>通过来源的短信验证码完成验证</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
    <button
      v-if="authentication.allowUnauthenticated"
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      @click="emit('withoutLogin')"
    >
      <AppIcon name="arrow-right" /><span
        ><strong>无需登录</strong><small>此来源允许直接获取公开数据</small></span
      ><AppIcon name="arrow-right" :size="18" />
    </button>
  </div>
</template>
