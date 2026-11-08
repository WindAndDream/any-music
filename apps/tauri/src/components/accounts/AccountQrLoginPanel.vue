<script setup lang="ts">
import { AppIcon } from '@any-music/ui'

import type { LoginPhase } from '../../features/accounts/account-login'
import AccountQrCode from './AccountQrCode.vue'

defineProps<{
  platformName: string
  image: string
  handoff: boolean
  canOpenApp: boolean
  busy: boolean
  openingApp: boolean
  canRetry: boolean
  phase: LoginPhase
}>()
const emit = defineEmits<{ openApp: []; regenerate: []; error: [] }>()
</script>
<template>
  <div class="qr-login">
    <div v-if="phase === 'generating'" class="qr-login__loading" role="status">
      <AppIcon class="qr-login__spinner" name="refresh" :size="32" />
      <p class="settings-form__hint">正在加载二维码…</p>
    </div>
    <template v-else-if="handoff">
      <AppIcon name="qr-code" :size="32" />
      <div class="settings-form__heading">
        <h4 class="native-settings__section-title">在哔哩哔哩应用中授权</h4>
        <p class="settings-form__hint">
          选择本机的哔哩哔哩应用或应用分身，确认登录后返回，登录状态会自动更新。
        </p>
      </div>
      <button
        v-if="canOpenApp"
        class="settings-form__save"
        type="button"
        :disabled="busy || openingApp"
        @click="emit('openApp')"
      >
        <AppIcon name="external-link" :size="18" />{{
          openingApp ? '正在打开…' : '登录 / 打开哔哩哔哩'
        }}
      </button>
      <p v-if="canOpenApp" class="settings-form__hint">
        未选中应用或关闭了选择框？再次点击登录即可。
      </p>
    </template>
    <template v-else-if="image">
      <AccountQrCode :image="image" @error="emit('error')" />
      <p class="settings-form__hint">使用{{ platformName }}手机客户端扫码，并在手机上确认。</p>
    </template>
    <button
      v-if="canRetry && phase !== 'generating'"
      class="native-settings__button qr-login__regenerate"
      type="button"
      :disabled="busy || openingApp"
      @click="emit('regenerate')"
    >
      <AppIcon name="refresh" :size="16" />{{
        phase === 'expired' ? '二维码已过期，重新生成' : '重新生成二维码'
      }}
    </button>
  </div>
</template>
<style scoped>
.qr-login {
  display: grid;
  min-inline-size: 0;
  justify-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  text-align: center;
}
.qr-login__loading {
  display: flex;
  min-block-size: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-3);
}
.qr-login__spinner {
  color: var(--am-color-primary);
  animation: qr-login-spin 1s linear infinite;
}
.qr-login .settings-form__save {
  min-block-size: 44px;
  inline-size: 100%;
  justify-content: center;
}
.qr-login .qr-login__regenerate {
  justify-self: center;
}
@keyframes qr-login-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .qr-login__spinner {
    animation: none;
  }
}
</style>
