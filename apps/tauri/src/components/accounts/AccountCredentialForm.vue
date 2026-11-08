<script setup lang="ts">
import { reactive, watch } from 'vue'

import type { AccountAuthentication } from '../../features/accounts/source-authentication'

const props = defineProps<{ fields: AccountAuthentication['credentialFields']; busy: boolean }>()
const emit = defineEmits<{ submit: [fields: Record<string, string>] }>()
const values = reactive<Record<string, string>>({})
watch(
  () => props.fields,
  () => {
    for (const id of Object.keys(values)) delete values[id]
  },
  { immediate: true },
)
function submit() {
  if (props.busy || props.fields.some((f) => !values[f.id]?.trim())) return
  emit('submit', Object.fromEntries(props.fields.map((f) => [f.id, values[f.id] ?? ''])))
  for (const field of props.fields) if (field.secret) values[field.id] = ''
}
</script>
<template>
  <form class="settings-form settings-form__card" autocomplete="off" @submit.prevent="submit">
    <div class="settings-form__heading">
      <h4>账号凭证</h4>
      <p class="settings-form__hint">凭证仅发送到此来源声明的认证接口，由本机加密保存登录结果。</p>
    </div>
    <label v-for="field in fields" :key="field.id" class="settings-form__field">
      <span>{{ field.label['zh-CN'] }}</span>
      <input
        v-model="values[field.id]"
        :type="field.secret ? 'password' : 'text'"
        :disabled="busy"
        required
        maxlength="4096"
        autocomplete="off"
        :spellcheck="false"
      />
    </label>
    <div class="settings-form__footer">
      <button class="settings-form__save" type="submit" :disabled="busy">验证并登录</button>
    </div>
  </form>
</template>
