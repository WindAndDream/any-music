<script setup lang="ts">
import type { AccountLoginCapabilities } from '@any-music/core'
import { AppIcon } from '@any-music/ui'
import DialogPages from '@any-music/ui/components/DialogPages.vue'
import { computed, nextTick, useTemplateRef, watch } from 'vue'

import type { LoginPhase, LoginVerification } from '../../features/accounts/account-login'
import { canLogin, platformName } from '../../features/accounts/account-presentation'
import type { NativeAccount } from '../../features/accounts/account-runtime'
import { BUILT_IN_AUTHENTICATION } from '../../features/accounts/source-authentication'
import type { AccountAuthentication } from '../../features/accounts/source-authentication'
import AccountCredentialForm from './AccountCredentialForm.vue'
import AccountLoginMethods from './AccountLoginMethods.vue'
import AccountPhoneLoginForm from './AccountPhoneLoginForm.vue'
import AccountQrLoginPanel from './AccountQrLoginPanel.vue'
import AccountVerificationPanel from './AccountVerificationPanel.vue'

const props = withDefaults(
  defineProps<{
    account: NativeAccount
    busy: boolean
    status: string
    qrImage: string
    qrContent: string
    capabilities: AccountLoginCapabilities
    authentication?: AccountAuthentication
    phoneCodeSent?: boolean
    verification?: LoginVerification
    retryAfter: number
    phase?: LoginPhase
    qrUnavailable?: boolean
    openingApp?: boolean
    checking?: boolean
    checkMessage?: string
  }>(),
  {
    phase: 'choose',
    qrUnavailable: false,
    openingApp: false,
    authentication: () => BUILT_IN_AUTHENTICATION,
    phoneCodeSent: false,
  },
)
const emit = defineEmits<{
  qr: []
  qrError: []
  browser: []
  credentials: []
  phone: []
  withoutLogin: []
  submitCredentials: [fields: Record<string, string>]
  sendPhoneCode: [phone: string]
  submitPhoneCode: [code: string]
  complete: []
  check: []
  choose: []
  openQrApp: []
  selectVerification: [id: string]
  resendSms: []
  submitSms: [code: string]
}>()
const step = computed(() =>
  props.phase === 'complete' || !canLogin(props.account)
    ? 'complete'
    : props.phase === 'choose'
      ? 'choose'
      : 'verify',
)
// Polling phases share a page; changing the selected method or verification opens a new page.
const page = computed(() =>
  step.value !== 'verify'
    ? step.value
    : props.verification
      ? `verification:${props.verification.selectedMethod}`
      : ['browser', 'credentials', 'phone'].includes(props.phase)
        ? props.phase
        : 'qr',
)
const handoff = computed(() => props.capabilities.qrPresentation === 'handoff')
const canOpenApp = computed(() => !!props.qrContent && ['waiting', 'scanned'].includes(props.phase))
const canRetryQr = computed(
  () => !props.qrUnavailable && props.capabilities.qrPresentation !== 'unavailable',
)
const showQr = computed(
  () => !['browser', 'credentials', 'phone'].includes(props.phase) && !props.verification,
)
const steps = [
  { id: 'choose', label: '选择方式' },
  { id: 'verify', label: '登录与验证' },
  { id: 'complete', label: '完成' },
] as const
const stepHeading = useTemplateRef<HTMLHeadingElement>('stepHeading')
const heading = computed(() =>
  step.value === 'choose' ? '选择登录方式' : step.value === 'complete' ? '登录完成' : '登录与验证',
)
watch(step, async () => {
  await nextTick()
  stepHeading.value?.focus({ preventScroll: true })
})
</script>
<template>
  <section class="login-panel" aria-label="账号登录" :aria-busy="busy">
    <ol class="login-panel__steps" aria-label="登录步骤">
      <li v-for="(item, index) in steps" :key="item.id">
        <button
          type="button"
          class="login-panel__step"
          :aria-current="step === item.id ? 'step' : undefined"
          :disabled="item.id !== 'choose' || step !== 'verify'"
          @click="emit('choose')"
        >
          <span class="login-panel__step-number">{{ index + 1 }}</span
          >{{ item.label }}
        </button>
      </li>
    </ol>
    <div class="settings-form__heading">
      <h4 ref="stepHeading" class="login-panel__heading" tabindex="-1">{{ heading }}</h4>
      <p v-if="authentication.apiBaseUrl" class="settings-form__hint">
        认证服务：{{ authentication.apiBaseUrl }}
      </p>
    </div>
    <div class="login-panel__viewport">
      <DialogPages
        :page="page"
        :returning="step === 'choose'"
        focus-selector="input:not(:disabled), button:not(:disabled)"
      >
        <div class="login-panel__page">
          <AccountLoginMethods
            v-if="step === 'choose'"
            :capabilities="capabilities"
            :authentication="authentication"
            :busy="busy"
            :qr-unavailable="qrUnavailable"
            @qr="emit('qr')"
            @browser="emit('browser')"
            @credentials="emit('credentials')"
            @phone="emit('phone')"
            @without-login="emit('withoutLogin')"
          />
          <div
            class="login-panel__status"
            :class="{ 'login-panel__status--success': step === 'complete' }"
            role="status"
            aria-live="polite"
          >
            <AppIcon :name="step === 'complete' ? 'check' : 'info'" />
            <p>
              {{
                !account.enabled
                  ? '账号已停用，启用后可登录或检测。'
                  : account.platformId.startsWith('external:') &&
                      account.authentication === 'anonymous' &&
                      !account.pending
                    ? '无需登录，可直接获取此来源的公开数据。'
                    : !canLogin(account)
                      ? '账号已登录。检测确认失效后，可以重新登录。'
                      : status || '请选择登录方式。'
              }}
            </p>
          </div>
          <div v-if="step === 'complete'" class="settings-form__footer">
            <p v-if="checkMessage" class="settings-form__hint" role="status">{{ checkMessage }}</p>
            <button
              class="native-settings__button"
              type="button"
              :disabled="busy || !account.enabled"
              @click="emit('check')"
            >
              <AppIcon name="refresh" :size="16" />{{ checking ? '检测中…' : '检测账号状态' }}
            </button>
          </div>
          <template v-else-if="step === 'verify'">
            <AccountCredentialForm
              v-if="phase === 'credentials'"
              :fields="authentication.credentialFields"
              :busy="busy"
              @submit="emit('submitCredentials', $event)"
            />
            <AccountPhoneLoginForm
              v-if="phase === 'phone'"
              :busy="busy"
              :sent="phoneCodeSent"
              :retry-after="retryAfter"
              @send="emit('sendPhoneCode', $event)"
              @submit="emit('submitPhoneCode', $event)"
            />
            <AccountQrLoginPanel
              v-if="showQr"
              :platform-name="platformName(account.platformId)"
              :image="qrImage"
              :handoff="handoff"
              :can-open-app="canOpenApp"
              :busy="busy"
              :opening-app="openingApp"
              :can-retry="canRetryQr"
              :phase="phase"
              @open-app="emit('openQrApp')"
              @regenerate="emit('qr')"
              @error="emit('qrError')"
            />
            <div v-if="phase === 'browser'" class="settings-form__card">
              <div class="settings-form__heading">
                <h4 class="native-settings__section-title">在浏览器中完成后</h4>
                <p class="settings-form__hint">
                  保持账号浏览器窗口打开，回到这里保存登录状态。关闭此面板会结束未完成的验证。
                </p>
              </div>
              <button
                class="settings-form__save"
                type="button"
                :disabled="busy"
                @click="emit('complete')"
              >
                {{ busy ? '正在确认…' : '我已完成登录 / 验证' }}
              </button>
            </div>
            <AccountVerificationPanel
              v-if="verification"
              :verification="verification"
              :busy="busy"
              :retry-after="retryAfter"
              @select="emit('selectVerification', $event)"
              @resend="emit('resendSms')"
              @submit="emit('submitSms', $event)"
            />
          </template>
        </div>
      </DialogPages>
    </div>
  </section>
</template>
<style scoped>
.login-panel,
.login-panel__page {
  display: grid;
  gap: var(--am-space-4);
  min-inline-size: 0;
}
.login-panel__heading {
  margin: 0;
  font-size: var(--am-font-size-sm);
  color: var(--am-color-text);
}
.login-panel__viewport {
  overflow: hidden;
  padding: 2px;
  margin: -2px;
}
.login-panel__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--am-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.login-panel__step {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  inline-size: 100%;
  min-block-size: 44px;
  border: 1px solid transparent;
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
  color: var(--am-color-text-secondary);
  font: inherit;
  font-size: var(--am-font-size-xs);
  line-height: 1.5;
  padding: var(--am-space-2);
  cursor: pointer;
}
.login-panel__step:disabled {
  cursor: default;
  opacity: 1;
}
.login-panel__step:not(:disabled) {
  border-color: var(--am-color-border);
}
.login-panel__step:not(:disabled):hover,
.login-panel__step[aria-current] {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.login-panel__step[aria-current] {
  font-weight: 650;
}
.login-panel__step:focus-visible {
  outline: 2px solid var(--am-color-primary);
  outline-offset: 2px;
}
.login-panel__status {
  display: flex;
  align-items: flex-start;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
  line-height: 1.7;
}
.login-panel__status p {
  margin: 0;
  overflow-wrap: anywhere;
}
.login-panel__status--success {
  color: var(--am-color-primary);
  background: var(--am-color-primary-soft);
}
@container native-settings (max-width: 360px) {
  .login-panel__steps {
    gap: var(--am-space-1);
  }
  .login-panel__step {
    gap: var(--am-space-1);
    padding-inline: var(--am-space-1);
  }
}
</style>
