<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import type { LoginVerification } from '../../features/accounts/account-login'

const props = defineProps<{ verification: LoginVerification; busy: boolean; retryAfter: number }>()
const emit = defineEmits<{ select: [id: string]; resend: []; submit: [code: string] }>()
const code = shallowRef('')
const showMethods = shallowRef(false)
const codeInput = useTemplateRef<HTMLInputElement>('codeInput')
const canSubmit = computed(() => /^[0-9]{6}$/.test(code.value) && !props.busy)
watch(
  () => props.verification.selectedMethod,
  async () => {
    code.value = ''
    showMethods.value = false
    await nextTick()
    codeInput.value?.focus()
  },
)
function choose(id: string) {
  code.value = ''
  showMethods.value = false
  if (id !== props.verification.selectedMethod) emit('select', id)
}
function submit() {
  if (!canSubmit.value) return
  emit('submit', code.value)
  code.value = ''
}
function changeMethod() {
  code.value = ''
  showMethods.value = true
}
function resend() {
  code.value = ''
  emit('resend')
}
</script>

<template>
  <section
    class="verification-panel settings-form__card"
    aria-label="抖音二次验证"
    :aria-busy="busy"
  >
    <div class="native-settings__heading">
      <h4>完成安全验证</h4>
      <p class="settings-form__hint">抖音要求确认账号身份，选择平台提供的验证方式继续。</p>
    </div>
    <div v-if="!verification.selectedMethod || showMethods" class="verification-panel__methods">
      <button
        v-for="method in verification.methods"
        :key="method.id"
        class="native-settings__button"
        type="button"
        :disabled="busy || (method.inApp && retryAfter > 0 && !verification.selectedMethod)"
        @click="choose(method.id)"
      >
        {{ method.label }}{{ method.inApp ? '' : '（使用系统浏览器）' }}
      </button>
      <p v-if="retryAfter > 0 && !verification.selectedMethod" role="status">
        请在 {{ retryAfter }} 秒后重试发送短信。
      </p>
    </div>
    <form v-else-if="verification.selectedMethod === 'mobile_sms_verify'" @submit.prevent="submit">
      <p>验证码已发送至 {{ verification.maskedMobile || '绑定手机号' }}。</p>
      <div class="settings-form">
        <label class="settings-form__field">
          <span>短信验证码</span>
          <input
            ref="codeInput"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            pattern="[0-9]{6}"
            placeholder="6 位数字"
            :disabled="busy"
            required
          />
        </label>
        <button class="settings-form__save" type="submit" :disabled="!canSubmit">验证并继续</button>
        <button
          class="native-settings__button"
          type="button"
          :disabled="busy || retryAfter > 0"
          @click="resend"
        >
          {{ retryAfter > 0 ? `${retryAfter} 秒后重发` : '重新发送验证码' }}
        </button>
        <button
          class="native-settings__button"
          type="button"
          :disabled="busy"
          @click="changeMethod"
        >
          选择其他验证方式
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.verification-panel__methods {
  display: grid;
  gap: var(--am-space-2);
}
.verification-panel form {
  display: grid;
  gap: var(--am-space-3);
}
.verification-panel form > p {
  margin: 0;
  line-height: 1.7;
}
</style>
