import { describe, expect, it } from 'vitest'

import {
  clearDouyinPageBridgeSessionTask,
  createDouyinPageBridgeSuccess,
  createDouyinPageBridgeUrl,
  parseDouyinPageBridgeMessage,
  parseDouyinPageBridgeTask,
  readDouyinPageBridgeSessionTask,
  saveDouyinPageBridgeSessionTask,
} from '@/platform/music-plugins/douyin/douyin-page-bridge'
import type { DouyinPageBridgeTask } from '@/platform/music-plugins/douyin/douyin-page-bridge'

const task: DouyinPageBridgeTask = {
  version: 1,
  taskId: '9a655c99-47a2-4dc2-b896-c9e384f5972d',
  kind: 'self-favorites',
  cursor: 18,
}

describe('Douyin protected-page bridge protocol', () => {
  it('round-trips a task through a self-page fragment without exposing it to the server URL', () => {
    const url = createDouyinPageBridgeUrl(task)

    expect(new URL(url).searchParams.get('showTab')).toBe('like')
    expect(new URL(url).search).not.toContain(task.taskId)
    expect(parseDouyinPageBridgeTask(url)).toEqual(task)
    expect(
      parseDouyinPageBridgeTask(url.replace('showTab=like', 'showTab=favorite_collection')),
    ).toBeUndefined()
  })

  it('targets the recommendation tab for recommendation fallback tasks', () => {
    const recommendationTask: DouyinPageBridgeTask = {
      ...task,
      kind: 'self-recommendations',
    }
    const url = createDouyinPageBridgeUrl(recommendationTask)

    expect(new URL(url).searchParams.get('showTab')).toBe('recommend')
    expect(parseDouyinPageBridgeTask(url)).toEqual(recommendationTask)
  })

  it('keeps a short session task across same-tab login or verification redirects only', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
    saveDouyinPageBridgeSessionTask(storage, task, 20_000)

    expect(
      readDouyinPageBridgeSessionTask(storage, 'https://www.douyin.com/verify', 10_000),
    ).toEqual(task)
    expect(
      readDouyinPageBridgeSessionTask(storage, 'https://example.com/verify', 10_000),
    ).toBeUndefined()
    expect(readDouyinPageBridgeSessionTask(storage, 'https://www.douyin.com/verify', 20_000)).toBe(
      undefined,
    )

    saveDouyinPageBridgeSessionTask(storage, task, 30_000)
    clearDouyinPageBridgeSessionTask(storage)
    expect(
      readDouyinPageBridgeSessionTask(storage, 'https://www.douyin.com/', 10_000),
    ).toBeUndefined()
  })

  it('projects only stable mapping fields before publishing a temporary GM value', () => {
    const message = createDouyinPageBridgeSuccess(task, {
      status_code: 0,
      aweme_list: [
        {
          aweme_id: 'liked-1',
          desc: '喜欢作品',
          author: { sec_uid: 'author-1', nickname: '作者' },
          video: {
            duration: 12_000,
            cover: { url_list: ['https://image.example/cover.jpg'] },
            play_addr: { url_list: ['https://media.example/short-lived.mp4'] },
            bit_rate: [
              {
                bit_rate: 128_000,
                play_addr: { url_list: ['https://media.example/bitrate.mp4'] },
              },
            ],
          },
          music: {
            id_str: 'music-1',
            title: '配乐',
            play_url: { url_list: ['https://media.example/short-lived.mp3'] },
          },
          images: [
            {
              url_list: ['https://image.example/note.jpg'],
              download_url_list: ['https://media.example/download.jpg'],
            },
          ],
        },
      ],
      has_more: 1,
      max_cursor: 36,
    })
    const serialized = JSON.stringify(message)

    expect(message).toMatchObject({
      status: 'success',
      page: {
        aweme_list: [
          {
            aweme_id: 'liked-1',
            video: { duration: 12_000 },
            music: { id_str: 'music-1' },
          },
        ],
        max_cursor: 36,
      },
    })
    expect(serialized).not.toContain('play_addr')
    expect(serialized).not.toContain('play_url')
    expect(serialized).not.toContain('bit_rate')
    expect(serialized).not.toContain('download_url')
    expect(serialized).not.toContain('short-lived')
  })

  it('rejects stale or mismatched result messages', () => {
    const message = createDouyinPageBridgeSuccess(task, {
      aweme_list: [{ aweme_id: 'liked-1' }],
    })

    expect(parseDouyinPageBridgeMessage(message, task)).toEqual(message)
    expect(
      parseDouyinPageBridgeMessage(message, {
        ...task,
        taskId: '8108f581-56b4-4911-8191-65ca8e81a6ab',
      }),
    ).toBeUndefined()
    expect(parseDouyinPageBridgeMessage({ ...message, cursor: -1 }, task)).toBeUndefined()
  })
})
