import { createAppErrorState } from '@any-music/core'
import {
  editingStateKey,
  getActionSuccessMessage,
  useEditingSession,
  useSettingsFeedback,
} from '@any-music/ui'
import type { EditingSession } from '@any-music/ui'
import { computed, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import type { NativeProxy } from './account-runtime'
import { normalizeProxyUrl, validateProxyDraft } from './proxy-settings'

interface PendingProxy {
  name: string
  url: string
  draftName: string
  draftUrl: string
}
const proxyDraft = editingStateKey<{
  name: ShallowRef<string>
  url: ShallowRef<string>
  nameTouched: ShallowRef<boolean>
  urlTouched: ShallowRef<boolean>
  pending: ShallowRef<PendingProxy | undefined>
}>('native-proxy-create')

/** 草稿在原生保存后的快照确认成功时清空；失败或其他代理变动不会丢失输入。 */
export function useProxyCreateForm(options: {
  proxies: () => readonly NativeProxy[]
  busy: () => boolean
  add: (name: string, url: string) => void
  editing?: EditingSession
}) {
  const editing = options.editing ?? useEditingSession('settings')
  const { name, url, nameTouched, urlTouched, pending } = editing.state(proxyDraft, () => ({
    name: shallowRef(''),
    url: shallowRef(''),
    nameTouched: shallowRef(false),
    urlTouched: shallowRef(false),
    pending: shallowRef<PendingProxy>(),
  }))
  const validation = computed(() => validateProxyDraft(name.value, url.value, options.proxies()))
  const showFeedback = useSettingsFeedback()
  watch(
    [options.proxies, options.busy],
    ([proxies, busy]) => {
      if (!editing.active || !pending.value) return
      const submitted = pending.value
      const saved = proxies.some((proxy) => {
        try {
          return proxy.name === submitted.name && normalizeProxyUrl(proxy.url) === submitted.url
        } catch {
          return false
        }
      })
      if (saved) {
        if (name.value === submitted.draftName && url.value === submitted.draftUrl) {
          name.value = ''
          url.value = ''
          nameTouched.value = false
          urlTouched.value = false
        }
        showFeedback({ status: 'success', message: getActionSuccessMessage('proxySettings') })
        pending.value = undefined
      } else if (!busy) pending.value = undefined
    },
    { immediate: true },
  )

  function submit() {
    if (!editing.active || options.busy()) return
    nameTouched.value = true
    urlTouched.value = true
    const draft = validation.value
    if (draft.nameError || draft.urlError) {
      showFeedback({
        status: 'error',
        action: 'proxySettings',
        error: createAppErrorState('invalid-input', draft.nameError || draft.urlError),
      })
      return
    }
    pending.value = { name: draft.name, url: draft.url, draftName: name.value, draftUrl: url.value }
    options.add(draft.name, draft.url)
  }

  return {
    name,
    url,
    nameError: computed(() => (nameTouched.value ? validation.value.nameError : '')),
    urlError: computed(() => (urlTouched.value ? validation.value.urlError : '')),
    validateName: () => {
      nameTouched.value = true
    },
    validateUrl: () => {
      urlTouched.value = true
    },
    submit,
  }
}
