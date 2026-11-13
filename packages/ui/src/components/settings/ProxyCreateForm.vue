<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ busy: boolean; nameError: string; urlError: string }>()
const name = defineModel<string>('name', { required: true })
const url = defineModel<string>('url', { required: true })
const emit = defineEmits<{ add: []; validateName: []; validateUrl: [] }>()
const formId = useId()
</script>

<template>
  <form
    class="settings-form proxy-create"
    novalidate
    :aria-labelledby="`${formId}-title`"
    :aria-busy="busy"
    @submit.prevent="emit('add')"
  >
    <div class="settings-form__card">
      <div class="settings-form__heading">
        <h4 :id="`${formId}-title`" class="proxy-create__title">添加代理</h4>
        <p :id="`${formId}-url-hint`" class="settings-form__hint">
          支持 HTTP、HTTPS、SOCKS5 和 SOCKS5h。请填写“协议://主机:端口”；IPv6
          使用方括号，暂不支持用户名和密码。
        </p>
      </div>
      <div class="settings-form__fields">
        <label class="settings-form__field">
          <span>代理名称</span>
          <input
            v-model="name"
            :disabled="busy"
            required
            maxlength="80"
            autocomplete="off"
            placeholder="例如：本地代理"
            :aria-invalid="!!nameError"
            :aria-describedby="nameError ? `${formId}-name-error` : undefined"
            @blur="emit('validateName')"
          />
          <span
            v-if="nameError"
            :id="`${formId}-name-error`"
            class="settings-form__error"
            role="alert"
            >{{ nameError }}</span
          >
        </label>
        <label class="settings-form__field">
          <span>代理地址</span>
          <input
            v-model="url"
            :disabled="busy"
            required
            type="text"
            inputmode="url"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            placeholder="http://127.0.0.1:7897"
            :aria-invalid="!!urlError"
            :aria-describedby="`${formId}-url-hint${urlError ? ` ${formId}-url-error` : ''}`"
            @blur="emit('validateUrl')"
          />
          <span
            v-if="urlError"
            :id="`${formId}-url-error`"
            class="settings-form__error"
            role="alert"
            >{{ urlError }}</span
          >
        </label>
      </div>
      <div class="settings-form__footer">
        <button class="settings-form__save" :disabled="busy" type="submit">添加代理</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.proxy-create__title {
  margin: 0;
  font-size: var(--am-font-size-sm);
}
.proxy-create input[aria-invalid='true'] {
  border-color: var(--am-color-danger);
}
.proxy-create .settings-form__save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
