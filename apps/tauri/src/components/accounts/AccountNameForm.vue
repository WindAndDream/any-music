<script setup lang="ts">
import type { EditingSession } from '@any-music/ui'
import { computed } from 'vue'

import { useAccountNameDraft } from '../../features/accounts/account-editor-state'
import { accountNameError } from '../../features/accounts/account-presentation'
import type { NativeAccount } from '../../features/accounts/account-runtime'
const props = defineProps<{
  account: NativeAccount
  accounts: NativeAccount[]
  busy: boolean
  editing?: EditingSession
}>()
const emit = defineEmits<{ save: [account: NativeAccount] }>()
const name = useAccountNameDraft(props.account.name, props.editing)
const error = computed(() =>
  accountNameError(props.accounts, props.account.platformId, name.value, props.account.id),
)
</script>
<template>
  <form
    class="settings-form settings-form__card"
    @submit.prevent="!error && emit('save', { ...account, name: name.trim() })"
  >
    <label class="settings-form__field"
      ><span class="settings-form__heading"
        ><strong>自定义名称</strong
        ><small class="settings-form__hint"
          >同一平台的账号名称不能重复，其他平台可使用相同名称。</small
        ></span
      ><input v-model="name" required maxlength="80" :disabled="busy" :aria-invalid="!!error"
    /></label>
    <p v-if="error" class="settings-form__error" role="alert">{{ error }}</p>
    <div class="settings-form__footer">
      <button class="settings-form__save" type="submit" :disabled="busy || !!error">
        保存名称
      </button>
    </div>
  </form>
</template>
