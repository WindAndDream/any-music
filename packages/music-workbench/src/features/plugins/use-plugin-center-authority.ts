import { computed, effectScope, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import type { EffectScope, MaybeRefOrGetter } from 'vue'

import { useNativePluginAuthority } from './use-native-plugin-authority'
import type { NativePluginAuthorityPort } from './use-native-plugin-authority'

/** One host authority session shared by plugin browsing and protected settings. */
export function usePluginCenterAuthority(
  port: NativePluginAuthorityPort | undefined,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const authority = shallowRef<ReturnType<typeof useNativePluginAuthority>>()
  let scope: EffectScope | undefined
  watch(
    () => Boolean(port && toValue(enabled)),
    (active) => {
      scope?.stop()
      scope = undefined
      authority.value = undefined
      if (active) {
        scope = effectScope()
        authority.value = scope.run(() => useNativePluginAuthority(port, true))
      }
    },
    { immediate: true },
  )
  onScopeDispose(() => scope?.stop())
  return {
    authority,
    installs: computed(() => authority.value?.installs.value ?? []),
    busy: computed(() => authority.value?.busy.value ?? false),
    errorMessage: computed(() => authority.value?.errorMessage.value),
  }
}
