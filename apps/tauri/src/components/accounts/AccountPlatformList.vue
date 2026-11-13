<script setup lang="ts">
import { AppIcon } from '@any-music/ui'
import { computed } from 'vue'

import { isSignedIn } from '../../features/accounts/account-presentation'
import type { NativeAccount } from '../../features/accounts/account-runtime'
import { getAccountState } from '../../features/accounts/account-state'

const props = defineProps<{
  accounts: NativeAccount[]
  platforms: readonly { id: string; name: string }[]
  selection?: NativeAccount['platformId']
  busy?: boolean
  choosing?: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
const platforms = computed(() =>
  props.platforms.map((platform) => {
    const accounts = props.accounts.filter((account) => account.platformId === platform.id)
    const active = accounts.filter((account) => account.enabled)
    const signedIn = active.filter(isSignedIn).length
    const disabled = accounts.filter((account) => !account.enabled).length
    const signedOut = active.filter(
      (account) => getAccountState(account).login === 'signed-out',
    ).length
    const verification = active.filter(
      (account) => getAccountState(account).verification === 'required',
    ).length
    const unknown = active.filter((account) => getAccountState(account).login === 'unknown').length
    const disconnected = active.filter(
      (account) => getAccountState(account).connection === 'unavailable',
    ).length
    return {
      id: platform.id,
      name: platform.name,
      summary: `${accounts.length} 个账号 · ${signedIn} 个已登录${signedOut ? ` · ${signedOut} 个未登录` : ''}${verification ? ` · ${verification} 个需要验证` : ''}${unknown ? ` · ${unknown} 个登录待确认` : ''}${disconnected ? ` · ${disconnected} 个连接不可用` : ''}${disabled ? ` · ${disabled} 个已停用` : ''}`,
    }
  }),
)
</script>
<template>
  <div class="native-settings__entries" :aria-label="choosing ? '可选平台' : '账号平台'">
    <button
      v-for="platform in platforms"
      :key="platform.id"
      class="native-settings__entry"
      type="button"
      :disabled="busy"
      :aria-pressed="choosing ? selection === platform.id : undefined"
      :aria-haspopup="choosing ? undefined : 'dialog'"
      @click="emit('select', platform.id)"
    >
      <AppIcon name="music" /><span
        ><strong>{{ platform.name }}</strong
        ><small>{{ platform.summary }}</small></span
      >
      <AppIcon :name="choosing && selection === platform.id ? 'check' : 'arrow-right'" :size="18" />
    </button>
  </div>
</template>
