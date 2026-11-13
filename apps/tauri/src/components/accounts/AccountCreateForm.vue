<script setup lang="ts">
import { AppIcon } from '@any-music/ui'
import { computed } from 'vue'

import { accountNameError, platformName } from '../../features/accounts/account-presentation'
import type { NativeAccount } from '../../features/accounts/account-runtime'
const props = defineProps<{
  busy: boolean
  accounts: NativeAccount[]
  platform: NativeAccount['platformId']
  platformLabel?: string
}>()
const emit = defineEmits<{ add: [platform: string, name: string]; selectPlatform: [] }>()
const name = defineModel<string>('name', { required: true })
const error = computed(() =>
  name.value ? accountNameError(props.accounts, props.platform, name.value) : '',
)
</script>
<template>
  <form
    class="settings-form settings-form__card"
    @submit.prevent="!error && emit('add', platform, name.trim())"
  >
    <div class="settings-form__heading">
      <h4>账号信息</h4>
      <p class="settings-form__hint">
        选择平台并填写名称，登录成功后才会添加到账号列表。各账号的登录状态与连接设置独立保存。
      </p>
    </div>
    <div class="native-settings__grid">
      <div class="settings-form__field">
        <span>平台</span>
        <button
          class="native-settings__button account-create__platform"
          type="button"
          :disabled="busy"
          aria-haspopup="dialog"
          aria-label="选择平台"
          @click="emit('selectPlatform')"
        >
          <span>{{ platformLabel ?? platformName(platform) }}</span
          ><AppIcon name="arrow-right" :size="16" />
        </button>
      </div>
      <label class="settings-form__field"
        ><span>账号名称</span
        ><input
          v-model="name"
          :disabled="busy"
          required
          maxlength="80"
          placeholder="给账号起一个名字"
      /></label>
    </div>
    <p v-if="error" class="settings-form__error" role="alert">{{ error }}</p>
    <div class="settings-form__footer">
      <button class="settings-form__save" type="submit" :disabled="busy || !!error || !name.trim()">
        添加并登录
      </button>
    </div>
  </form>
</template>
<style scoped>
.account-create__platform {
  inline-size: 100%;
  justify-content: space-between;
  text-align: start;
}
</style>
