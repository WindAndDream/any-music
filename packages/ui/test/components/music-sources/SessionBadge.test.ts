import { createAppErrorState } from '@any-music/core'
import type { MusicSourceSession } from '@any-music/core'
import SessionBadge from '@any-music/ui/components/music-sources/SessionBadge.vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from './catalog-test-renderer'

describe('SessionBadge compact account', () => {
  it.each([{}, { compact: true }, { compact: true, prominent: true }])(
    'offers account creation instead of stale session actions when no account exists %j',
    (presentation) => {
      const add = vi.fn()
      const refresh = vi.fn()
      const view = mountCatalogComponent(SessionBadge, {
        ...presentation,
        session: { status: 'signed-out' },
        refreshing: true,
        switchable: true,
        accountLabel: '随机',
        accountMissing: true,
        onAddAccount: add,
        onRefresh: refresh,
      })
      expect(view.root.textContent).toContain('无账号')
      expect(view.root.textContent).toContain('添加')
      expect(view.root.textContent).not.toContain('随机')
      expect(view.root.textContent).not.toContain('登录')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '添加账号'),
        'onClick',
      )
      expect(add).toHaveBeenCalledOnce()
      expect(refresh).not.toHaveBeenCalled()
      view.unmount()
    },
  )
  it('shows the random selection label instead of the last checked account', () => {
    const view = mountCatalogComponent(SessionBadge, {
      session: { status: 'signed-in', user: { id: '1', name: '旧账号' } },
      refreshing: false,
      switchable: true,
      accountLabel: '随机',
    })
    expect(view.root.textContent).toContain('随机')
    expect(view.root.textContent).not.toContain('旧账号')
    view.unmount()
  })
  it('opens account selection independently of refreshing the session', () => {
    const select = vi.fn()
    const refresh = vi.fn()
    const view = mountCatalogComponent(SessionBadge, {
      session: { status: 'signed-in', user: { id: '1', name: '桌面账号' } },
      refreshing: false,
      switchable: true,
      onSelectAccount: select,
      onRefresh: refresh,
    })
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-haspopup'] === 'dialog'),
      'onClick',
    )
    expect(select).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态'),
      'onClick',
    )
    expect(refresh).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('gives the prominent name space without a username prefix while retaining the complete accessible name', () => {
    const name = '这是一个超出标题行可用宽度的平台用户名'
    const onRefresh = vi.fn()
    const view = mountCatalogComponent(SessionBadge, {
      compact: true,
      prominent: true,
      session: { status: 'signed-in', user: { id: '1', name } },
      refreshing: false,
      onRefresh,
    })
    const label = findCatalogElement(view.root, (node) => node.props.role === 'heading')
    expect(label.props.title).toBe(name)
    expect(label.props['aria-label']).toBe(`用户名：${name}，已登录`)
    expect(label.props['aria-level']).toBe(2)
    const accountParts = label.parent!.children.filter(
      (node) => node.tag === 'span' || node.tag === 'button',
    )
    expect(accountParts).toHaveLength(3)
    expect(accountParts[0]!.props.class).toBe('session__dot')
    expect(accountParts[0]!.props['aria-hidden']).toBe('true')
    expect(accountParts[1]).toBe(label)
    expect(accountParts[2]!.props['aria-label']).toBe('刷新平台用户状态')
    expect(view.root.textContent).not.toContain('用户名 ·')
    expect(view.root.textContent).not.toContain('已登录')
    dispatchCatalogEvent(accountParts[2]!, 'onClick')
    expect(onRefresh).toHaveBeenCalledOnce()
    view.unmount()
  })

  it.each([{}, { compact: true }, { compact: true, prominent: true, switchable: true }])(
    'shows only the custom name in account presentation %j',
    (presentation) => {
      const view = mountCatalogComponent(SessionBadge, {
        ...presentation,
        session: {
          status: 'signed-in',
          user: { id: '1', name: '平台原名', customName: ' 常用账号 ' },
        },
        refreshing: true,
      })
      expect(view.root.textContent).toContain('常用账号')
      expect(view.root.textContent).not.toContain('平台原名')
      expect(
        findCatalogElement(view.root, (node) => node.props.title === '常用账号').textContent,
      ).toContain('常用账号')
      view.unmount()
    },
  )

  it('falls back to the platform username for an empty custom name', () => {
    const view = mountCatalogComponent(SessionBadge, {
      compact: true,
      prominent: true,
      session: { status: 'signed-in', user: { id: '1', name: '平台原名', customName: ' ' } },
      refreshing: false,
    })
    expect(view.root.textContent).toContain('平台原名')
    view.unmount()
  })

  it('keeps the username visible while refreshing and restores the named refresh control', async () => {
    const refreshing = shallowRef(false)
    const onRefresh = vi.fn(() => {
      refreshing.value = true
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(SessionBadge, {
            compact: true,
            session: { status: 'signed-in', user: { id: '1', name: '很长的平台用户名' } },
            refreshing: refreshing.value,
            onRefresh,
          }),
      }),
      {},
    )
    expect(view.root.textContent).toContain('很长的平台用户名已登录')
    const icon = findCatalogElement(
      view.root,
      (node) => node.tag === 'svg' && String(node.props.class).includes('session__refresh-icon'),
    )
    expect(String(icon.props.class)).not.toContain('session__refresh-icon--spinning')
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态'),
      'onClick',
    )
    await nextTick()
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(view.root.textContent).toContain('很长的平台用户名检查中…')
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '正在刷新平台用户状态')
        .props.disabled,
    ).toBe(true)
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '正在刷新平台用户状态')
        .props['aria-busy'],
    ).toBe(true)
    expect(String(icon.props.class)).toContain('session__refresh-icon--spinning')
    refreshing.value = false
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态').props
        .disabled,
    ).toBe(false)
    expect(String(icon.props.class)).not.toContain('session__refresh-icon--spinning')
    view.unmount()
  })

  it.each([
    [{ status: 'checking' }, '检查中…', false],
    [{ status: 'not-required' }, '无需登录', false],
    [{ status: 'signed-out' }, '未登录', true],
    [
      { status: 'expired', error: createAppErrorState('unknown', '请重新登录') },
      '登录已失效',
      true,
    ],
    [
      { status: 'expired', error: createAppErrorState('unknown', '请重新登录') },
      '常用账号',
      true,
      '常用账号',
    ],
    [
      { status: 'unavailable', error: createAppErrorState('unknown', '请求失败') },
      '状态不可用',
      false,
    ],
  ] satisfies [MusicSourceSession, string, boolean, string?][])(
    'renders session %j as %s and retains recovery actions',
    (session, label, canLogin, accountLabel?: string) => {
      const onLogin = vi.fn()
      const onRefresh = vi.fn()
      const view = mountCatalogComponent(SessionBadge, {
        compact: true,
        session,
        accountLabel,
        switchable: Boolean(accountLabel),
        refreshing: false,
        onLogin,
        onRefresh,
      })
      expect(view.root.textContent).toContain(label)
      if (canLogin) {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.textContent.trim() === '登录',
          ),
          'onClick',
        )
        expect(onLogin).toHaveBeenCalledOnce()
      } else
        expect(() =>
          findCatalogElement(
            view.root,
            (node) => node.tag === 'button' && node.textContent.trim() === '登录',
          ),
        ).toThrow()
      if (session.status === 'expired') {
        expect(view.root.textContent).toContain('登录已失效')
        expect(() =>
          findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态'),
        ).toThrow()
        expect(onRefresh).not.toHaveBeenCalled()
      } else {
        dispatchCatalogEvent(
          findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态'),
          'onClick',
        )
        expect(onRefresh).toHaveBeenCalledOnce()
      }
      view.unmount()
    },
  )
})
