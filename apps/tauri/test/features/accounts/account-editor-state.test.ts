import { createEditingSession } from '@any-music/ui'
import { describe, expect, it } from 'vitest'

import {
  useAccountConnectionDraft,
  useAccountNameDraft,
} from '@/features/accounts/account-editor-state'
import type { NativeAccount } from '@/features/accounts/account-runtime'

const account = {
  id: 'account',
  name: 'Saved name',
  proxyId: 'primary',
  backupProxyIds: ['backup'],
} as NativeAccount

describe('native account editor cells', () => {
  it('preserves unsaved name and ordered connections across presentations, then resets on real navigation', () => {
    const editing = createEditingSession()
    const name = useAccountNameDraft(account.name, editing)
    const connection = useAccountConnectionDraft(account, editing)
    name.value = 'Unsubmitted name'
    connection.primary.value = 'another'
    connection.backups.value = ['second', 'first']
    expect(useAccountNameDraft(account.name, editing).value).toBe('Unsubmitted name')
    expect(useAccountConnectionDraft(account, editing).primary.value).toBe('another')
    expect(useAccountConnectionDraft(account, editing).backups.value).toEqual(['second', 'first'])
    expect(account).toMatchObject({
      name: 'Saved name',
      proxyId: 'primary',
      backupProxyIds: ['backup'],
    })
    editing.reset()
    expect(useAccountNameDraft(account.name, editing).value).toBe('Saved name')
    expect(useAccountConnectionDraft(account, editing).backups.value).toEqual(['backup'])
    editing.dispose()
  })
})
