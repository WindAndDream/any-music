<script setup lang="ts">
import type { AccountOperationPolicy } from '@any-music/account-pool'
import { computed, shallowRef, watch } from 'vue'

import { ACCOUNT_PLATFORMS } from '../../features/accounts/account-presentation'
import type { NativeAccount, AccountOperation } from '../../features/accounts/account-runtime'
const props = defineProps<{
  accounts: NativeAccount[]
  getPolicy: (platform: string, operation: AccountOperation) => AccountOperationPolicy
}>()
const emit = defineEmits<{
  save: [platform: string, operation: AccountOperation, policy: AccountOperationPolicy]
}>()
const platform = shallowRef('bilibili')
const operation = shallowRef<AccountOperation>('search')
const mode = shallowRef<'serial' | 'parallel'>('serial')
const selection = shallowRef<'random' | 'shuffle'>('shuffle')
const accountIds = shallowRef<string[]>([])
const allAccounts = shallowRef(true)
const available = computed(() =>
  props.accounts.filter((a) => a.platformId === platform.value && a.enabled),
)
const serialSearch = computed(() => platform.value === 'douyin' && operation.value === 'search')
watch(
  [platform, operation],
  () => {
    const policy = props.getPolicy(platform.value, operation.value)
    mode.value = policy.mode
    selection.value = policy.selection
    allAccounts.value = policy.accountIds === undefined
    accountIds.value = [...(policy.accountIds ?? [])]
  },
  { immediate: true },
)
function save() {
  emit('save', platform.value, operation.value, {
    ...props.getPolicy(platform.value, operation.value),
    mode: serialSearch.value ? 'serial' : mode.value,
    selection: selection.value,
    concurrency: serialSearch.value ? 1 : 2,
    accountIds: allAccounts.value
      ? undefined
      : accountIds.value.filter((id) => available.value.some((account) => account.id === id)),
  })
}
</script>
<template>
  <details class="settings-form__card">
    <summary>随机选择账号的请求方式</summary>
    <p class="settings-form__hint">
      仅在选择“随机”时应用。手动切换账号后，新操作使用指定账号，已有列表保持原账号。
    </p>
    <form class="settings-form" @submit.prevent="save">
      <div class="native-settings__grid">
        <label class="settings-form__field"
          ><span>平台</span
          ><select v-model="platform">
            <option v-for="source in ACCOUNT_PLATFORMS" :key="source.id" :value="source.id">
              {{ source.name }}
            </option>
          </select></label
        >
        <label class="settings-form__field"
          ><span>操作</span
          ><select v-model="operation">
            <option value="search">搜索</option>
            <option value="import">导入</option>
            <option value="playback">播放与下载解析</option>
            <option value="session">检查登录状态</option>
          </select></label
        >
        <label class="settings-form__field"
          ><span>账号顺序</span
          ><select v-model="selection">
            <option value="shuffle">随机且不重复</option>
            <option value="random">随机</option>
          </select></label
        >
        <label class="settings-form__field"
          ><span>尝试方式</span
          ><select v-model="mode" :disabled="serialSearch">
            <option value="serial">依次尝试</option>
            <option value="parallel">最多两个账号同时尝试</option>
          </select></label
        >
      </div>
      <p v-if="serialSearch" class="settings-form__hint">
        抖音搜索按账号依次尝试，遇到安全验证时暂停。
      </p>
      <label class="native-settings__checkbox"
        ><input v-model="allAccounts" type="checkbox" />使用全部可用账号</label
      >
      <fieldset v-if="!allAccounts" class="native-settings__choices">
        <legend>参与账号</legend>
        <label v-for="account in available" :key="account.id" class="native-settings__checkbox"
          ><input v-model="accountIds" type="checkbox" :value="account.id" />{{
            account.name
          }}</label
        >
        <p v-if="!available.length" class="settings-form__hint">此平台没有启用的账号。</p>
      </fieldset>
      <div class="settings-form__footer">
        <button class="settings-form__save" type="submit">保存请求方式</button>
      </div>
    </form>
  </details>
</template>
