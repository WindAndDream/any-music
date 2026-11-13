import { describe, expect, it } from 'vitest'

import { getImportUrlScopeError } from '../../../src/components/music-sources/source-input-validation'

const bilibiliScopes = [
  { origin: 'https://www.bilibili.com', pathnamePrefix: '/video/' },
  { origin: 'https://space.bilibili.com', pathnamePrefix: '/' },
] as const

describe('getImportUrlScopeError', () => {
  it('accepts an exact origin and declared path prefix', () => {
    expect(
      getImportUrlScopeError(
        ' https://www.bilibili.com/video/BV1xx411c7mD/?from=search ',
        bilibiliScopes,
      ),
    ).toBe('')
  })

  it('rejects deceptive sibling origins before a request can be submitted', () => {
    expect(
      getImportUrlScopeError(
        'https://www.bilibili.com.example.com/video/BV1xx411c7mD',
        bilibiliScopes,
      ),
    ).toBe('该网址不在当前音乐源声明的可导入范围内。')
  })

  it('rejects undeclared paths and malformed URLs', () => {
    expect(getImportUrlScopeError('https://www.bilibili.com/read/cv1', bilibiliScopes)).not.toBe('')
    expect(getImportUrlScopeError('www.bilibili.com/video/BV1xx411c7mD', bilibiliScopes)).toBe(
      '请输入包含 https:// 的完整网址。',
    )
  })

  it('does not show an error before the user enters a URL', () => {
    expect(getImportUrlScopeError('   ', bilibiliScopes)).toBe('')
  })
})
