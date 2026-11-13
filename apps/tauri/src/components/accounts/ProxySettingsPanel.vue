<script setup lang="ts">
import ProxyCreateForm from '@any-music/ui/components/settings/ProxyCreateForm.vue'
import ProxyManagementList from '@any-music/ui/components/settings/ProxyManagementList.vue'
import { computed } from 'vue'

import type { NativeAccount, NativeProxy } from '../../features/accounts/account-runtime'
import { useProxyCreateForm } from '../../features/accounts/use-proxy-create-form'

const props = defineProps<{
  proxies: NativeProxy[]
  accounts: NativeAccount[]
  busy: boolean
  error?: string
}>()
const emit = defineEmits<{ add: [name: string, url: string]; remove: [id: string] }>()
const { name, url, nameError, urlError, validateName, validateUrl, submit } = useProxyCreateForm({
  proxies: () => props.proxies,
  busy: () => props.busy,
  add: (proxyName, proxyUrl) => emit('add', proxyName, proxyUrl),
})
// Only public display data enters the shared UI; native identity and persistence stay here.
const rows = computed(() =>
  props.proxies.map((proxy) => ({
    id: proxy.id,
    name: proxy.name,
    url: proxy.url,
    protocol: proxy.url.split('://')[0]?.toUpperCase() ?? '',
    accountNames: props.accounts
      .filter(
        (account) => account.proxyId === proxy.id || account.backupProxyIds?.includes(proxy.id),
      )
      .map((account) => account.name),
  })),
)
</script>

<template>
  <section class="settings-form native-settings">
    <p v-if="error" class="settings-form__error" role="alert">{{ error }}</p>
    <div class="settings-sections">
      <ProxyCreateForm
        v-model:name="name"
        v-model:url="url"
        :busy="busy"
        :name-error="nameError"
        :url-error="urlError"
        @add="submit"
        @validate-name="validateName"
        @validate-url="validateUrl"
      />
      <ProxyManagementList :proxies="rows" :busy="busy" @remove="emit('remove', $event)" />
    </div>
  </section>
</template>
