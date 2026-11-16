import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { readonly, shallowRef } from 'vue'

/** `challenge` keeps the page hidden until the website shows a login or security challenge. */
export type AccountPageMode = 'challenge' | 'page'

export interface AccountPageRequest {
  accountId: string
  title: string
  description: string
  mode: AccountPageMode
  /** Optional confirmation, e.g. saving a login the user completed in the page. */
  actionLabel?: string
  onAction?: () => void
  /** The user dismissed the dialog; the owning flow cancels its native page. */
  onClose: () => void
}

export interface AccountPagePresentation extends AccountPageRequest {
  id: number
  state: 'pending' | 'visible'
  /** Size of the isolated challenge, when the page shows only that challenge. */
  width?: number
  height?: number
  busy: boolean
  status: string
}

export interface AccountPageBounds {
  x: number
  y: number
  width: number
  height: number
}

type NativePresentation = {
  accountId: string
  state: 'pending' | 'visible' | 'closed'
  width?: number | null
  height?: number | null
}

const current = shallowRef<AccountPagePresentation>()
let sequence = 0
let listening: Promise<unknown> | undefined

/** Native pages announce when their content becomes visible; the dialog then reserves space. */
function ensureListener() {
  listening ??= listen<NativePresentation>('account-page', ({ payload }) => {
    const value = current.value
    if (!value || value.accountId !== payload.accountId) return
    current.value = {
      ...value,
      state: payload.state === 'visible' ? 'visible' : 'pending',
      width: payload.state === 'visible' ? (payload.width ?? undefined) : undefined,
      height: payload.state === 'visible' ? (payload.height ?? undefined) : undefined,
    }
  }).catch(() => {
    listening = undefined
  })
  return listening
}

/**
 * Open the in-app page dialog before starting the native page, so no presentation event is
 * missed. The returned handle updates or dismisses only this presentation.
 */
export async function openAccountPage(request: AccountPageRequest) {
  await ensureListener()
  const id = ++sequence
  current.value = { ...request, id, state: 'pending', busy: false, status: '' }
  const own = () => current.value?.id === id
  return {
    update(change: Partial<Pick<AccountPagePresentation, 'busy' | 'status' | 'description'>>) {
      if (own()) current.value = { ...current.value!, ...change }
    },
    // The dialog's layout scope hides the native page when this presentation disappears.
    dismiss() {
      if (own()) current.value = undefined
    },
  }
}

export function layoutAccountPage(accountId: string, bounds: AccountPageBounds | null) {
  return invoke('account_page_layout', { accountId, bounds }).catch(() => {})
}

export function useAccountPage() {
  return {
    current: readonly(current),
    close() {
      current.value?.onClose()
    },
    action() {
      const value = current.value
      if (value && !value.busy) value.onAction?.()
    },
  }
}
