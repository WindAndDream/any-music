<script setup lang="ts">
import { computed, shallowRef } from 'vue'
const props = defineProps<{ busy: boolean; sent: boolean; retryAfter: number }>()
const emit = defineEmits<{ send: [phone: string]; submit: [code: string] }>()
const phone = shallowRef('')
const code = shallowRef('')
const validPhone = computed(() => /^\+?\d{6,20}$/.test(phone.value))
function submit() {
  if (props.busy || !/^\d{4,10}$/.test(code.value)) return
  emit('submit', code.value)
  code.value = ''
}
</script>
<template>
  <form class="settings-form settings-form__card" autocomplete="off" @submit.prevent="submit">
    <label class="settings-form__field"
      ><span>手机号（含国家或地区代码）</span
      ><input
        v-model="phone"
        type="tel"
        inputmode="tel"
        :disabled="busy || sent"
        required
        maxlength="21"
        autocomplete="off"
        placeholder="例如 +8613800000000"
    /></label>
    <button
      class="native-settings__button"
      type="button"
      :disabled="busy || !validPhone || retryAfter > 0"
      @click="emit('send', phone)"
    >
      {{ retryAfter > 0 ? `${retryAfter} 秒后重发` : sent ? '重新发送验证码' : '获取验证码' }}
    </button>
    <label v-if="sent" class="settings-form__field"
      ><span>短信验证码</span
      ><input
        v-model="code"
        :disabled="busy"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        minlength="4"
        maxlength="10"
        required
    /></label>
    <div v-if="sent" class="settings-form__footer">
      <button
        class="settings-form__save"
        type="submit"
        :disabled="busy || !/^\d{4,10}$/.test(code)"
      >
        验证并登录
      </button>
    </div>
  </form>
</template>
