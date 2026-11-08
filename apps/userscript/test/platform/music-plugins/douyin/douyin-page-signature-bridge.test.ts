import { describe, expect, it, vi } from 'vitest'

import {
  DOUYIN_SIGNATURE_BEGIN_EVENT,
  DOUYIN_SIGNATURE_RESULT_EVENT,
  installDouyinMainWorldSignatureBridge,
} from '@/platform/music-plugins/douyin/douyin-page-signature-bridge'

describe('Douyin same-site signature bridge', () => {
  it('captures the main-world BDMS result and aborts before the signing probe reaches transport', async () => {
    const networkUrls: string[] = []
    const runtime = {
      URL,
      Request,
      DOMException,
      fetch: vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
        networkUrls.push(String(input))
        return new Response('{}')
      }),
    }
    const document = new EventTarget() as EventTarget &
      Pick<Document, 'location' | 'createElement' | 'head' | 'documentElement'>
    const injectedSources: string[] = []
    Object.assign(document, {
      location: { hostname: 'www.douyin.com' },
      createElement: () => ({ textContent: '', remove: vi.fn() }),
      head: {
        append(script: { textContent: string }) {
          injectedSources.push(script.textContent)
          // document-start 注入脚本会立刻进入主世界；测试以显式参数模拟该执行上下文。
          Function(
            'window',
            'document',
            'location',
            'CustomEvent',
            'URL',
            'setTimeout',
            'clearTimeout',
            script.textContent,
          )(
            runtime,
            document,
            { origin: 'https://www.douyin.com' },
            CustomEvent,
            URL,
            setTimeout,
            clearTimeout,
          )
        },
      },
      documentElement: { append: vi.fn() },
    })

    installDouyinMainWorldSignatureBridge(document as unknown as Document)

    const capturedFetch = runtime.fetch
    // 模拟页面随后加载的 BDMS：它包装 document-start 保存的底层 fetch，并追加动态安全字段。
    runtime.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const signedUrl = new URL(String(input))
      signedUrl.searchParams.set('msToken', 'main-world-ms-token')
      signedUrl.searchParams.set('a_bogus', 'main-world-a-bogus')
      return capturedFetch(signedUrl, init)
    })
    const result = new Promise<Record<string, string>>((resolve) => {
      document.addEventListener(
        DOUYIN_SIGNATURE_RESULT_EVENT,
        (event) => resolve(JSON.parse(String((event as CustomEvent).detail))),
        { once: true },
      )
    })

    document.dispatchEvent(
      new CustomEvent(DOUYIN_SIGNATURE_BEGIN_EVENT, {
        detail: JSON.stringify({
          id: 'probe-1',
          url: 'https://www.douyin.com/aweme/v1/web/general/search/stream/?aid=6383&count=10',
          method: 'GET',
          body: '',
        }),
      }),
    )

    await expect(result).resolves.toMatchObject({
      id: 'probe-1',
      msToken: 'main-world-ms-token',
      aBogus: 'main-world-a-bogus',
    })
    expect(networkUrls).toEqual([])
    expect(injectedSources[0]).not.toContain("document.createElement('iframe')")
  })

  it('defers the sandboxed signer on unrelated hosts until the first signing request', () => {
    const appendedFrames: unknown[] = []
    const frame = {
      hidden: false,
      setAttribute: vi.fn(),
      referrerPolicy: '',
      src: '',
      contentWindow: undefined,
    }
    const runtime = new EventTarget()
    const document = new EventTarget() as EventTarget &
      Pick<Document, 'location' | 'createElement' | 'documentElement' | 'defaultView'>
    Object.assign(document, {
      location: { hostname: 'example.com' },
      defaultView: runtime,
      createElement: () => frame,
      documentElement: { append: (node: unknown) => appendedFrames.push(node) },
    })

    installDouyinMainWorldSignatureBridge(document as unknown as Document)
    expect(appendedFrames).toEqual([])

    document.dispatchEvent(
      new CustomEvent(DOUYIN_SIGNATURE_BEGIN_EVENT, {
        detail: JSON.stringify({
          id: 'probe-2',
          url: 'https://www.douyin.com/aweme/v1/web/general/search/stream/?aid=6383',
          method: 'GET',
        }),
      }),
    )

    expect(appendedFrames).toEqual([frame])
    expect(frame.src).toMatch(/^data:text\/html/)
  })
})
