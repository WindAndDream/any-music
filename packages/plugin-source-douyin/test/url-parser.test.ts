import { describe, expect, it } from 'vitest'

import { parseDouyinImportUrl } from '../src/url-parser'

describe('parseDouyinImportUrl', () => {
  it('recognizes private watch history and rejects another user history locally', () => {
    expect(parseDouyinImportUrl('https://www.douyin.com/user/self?showTab=record')).toMatchObject({
      kind: 'self-history',
    })
    expect(() => parseDouyinImportUrl('https://www.douyin.com/user/other?showTab=record')).toThrow(
      expect.objectContaining({ code: 'access-denied' }),
    )
  })
  it.each([
    'https://www.douyin.com/user/self?showTab=fhttps://www.douyin.com/user/self?showSubTab=video&showTab=likeavorite_collection',
    'https://www.douyin.com/user/self?showTab=like&showTab=favorite_collection',
    'https://www.douyin.com/user/self?showTab=fhttps%3A%2F%2Fwww.douyin.com%2Fuser%2Fself',
  ])('rejects concatenated or ambiguous page links locally: %s', (url) => {
    expect(() => parseDouyinImportUrl(url)).toThrow(
      expect.objectContaining({ code: 'invalid-input' }),
    )
  })
  it('prefers an opened search modal over the search listing', () => {
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/jingxuan/search/%E5%8F%A4%E9%A3%8Edj?modal_id=7625317993723938815&type=general',
      ),
    ).toMatchObject({ kind: 'video', awemeId: '7625317993723938815' })
  })

  it('recognizes search, notes, mixes and public favorites', () => {
    expect(
      parseDouyinImportUrl('https://www.douyin.com/search/%E5%8F%A4%E9%A3%8Edj'),
    ).toMatchObject({
      kind: 'search',
      query: '古风dj',
    })
    expect(parseDouyinImportUrl('https://www.douyin.com/note/7626819482996890441')).toMatchObject({
      kind: 'video',
      pageKind: 'note',
    })
    expect(
      parseDouyinImportUrl('https://www.douyin.com/collection/7588097875960137763/1'),
    ).toMatchObject({ kind: 'mix', mixId: '7588097875960137763' })
    expect(
      parseDouyinImportUrl('https://www.douyin.com/user/MS4wLjABAAAA?showTab=like'),
    ).toMatchObject({ kind: 'user-favorites', secUid: 'MS4wLjABAAAA' })
    expect(
      parseDouyinImportUrl('https://www.douyin.com/user/MS4wLjABAAAA?showSubTab=compilation'),
    ).toMatchObject({ kind: 'user-mixes', secUid: 'MS4wLjABAAAA' })
  })

  it('keeps account collections separate from likes and authored mixes', () => {
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=favorite_collection',
      ),
    ).toMatchObject({ kind: 'self-collected-videos' })
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/user/self?showSubTab=music&showTab=favorite_collection',
      ),
    ).toMatchObject({ kind: 'self-collected-music' })
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/user/self?showSubTab=compilation&showTab=favorite_collection',
      ),
    ).toMatchObject({ kind: 'self-collected-mixes' })
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/user/self?showSubTab=favorite_folder&showTab=favorite_collection',
      ),
    ).toMatchObject({ kind: 'self-collection-folders' })
    expect(
      parseDouyinImportUrl(
        'https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=like',
      ),
    ).toMatchObject({ kind: 'self-favorites' })
    expect(
      parseDouyinImportUrl('https://www.douyin.com/user/self?from_tab_name=main&showTab=recommend'),
    ).toMatchObject({ kind: 'self-recommendations' })
  })
})
