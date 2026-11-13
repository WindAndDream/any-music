import { describe, expect, it, vi } from 'vitest'

vi.mock('$', () => ({ unsafeWindow: {} }))

import {
  DOUYIN_SIGNATURE_BEGIN_EVENT,
  DOUYIN_SIGNATURE_RESULT_EVENT,
} from '@/platform/music-plugins/douyin/douyin-page-signature-bridge'
import { createDouyinPageSignatureProvider } from '@/platform/music-plugins/douyin/douyin-page-signer'

describe('Douyin page signature provider', () => {
  it('awaits the current-page BDMS bridge result without invoking transport itself', async () => {
    const document = new EventTarget()
    let probeId = ''
    document.addEventListener(DOUYIN_SIGNATURE_BEGIN_EVENT, (event) => {
      probeId = JSON.parse(String((event as CustomEvent).detail)).id
    })
    document.addEventListener(DOUYIN_SIGNATURE_BEGIN_EVENT, () => {
      document.dispatchEvent(
        new CustomEvent(DOUYIN_SIGNATURE_RESULT_EVENT, {
          detail: JSON.stringify({
            id: probeId,
            msToken: 'page-ms-token',
            aBogus: 'page-a-bogus',
            timestamp: '1234567890',
            webSignature: 'page-web-signature',
            webExpire: '1234567990',
          }),
        }),
      )
    })
    const provider = createDouyinPageSignatureProvider({
      document: document as unknown as Document,
      CustomEvent,
    })

    await expect(
      provider({
        url: 'https://www.douyin.com/aweme/v1/web/general/search/stream/?aid=6383',
        method: 'GET',
      }),
    ).resolves.toEqual({
      msToken: 'page-ms-token',
      aBogus: 'page-a-bogus',
      timestamp: '1234567890',
      webSignature: 'page-web-signature',
      webExpire: '1234567990',
    })
  })

  it('allows the isolated bridge to sign a Douyin target from another host', async () => {
    const document = new EventTarget()
    document.addEventListener(DOUYIN_SIGNATURE_BEGIN_EVENT, (event) => {
      const { id } = JSON.parse(String((event as CustomEvent).detail)) as { id: string }
      document.dispatchEvent(
        new CustomEvent(DOUYIN_SIGNATURE_RESULT_EVENT, {
          detail: JSON.stringify({ id, msToken: '', aBogus: 'sandbox-a-bogus' }),
        }),
      )
    })
    const provider = createDouyinPageSignatureProvider({
      document: document as unknown as Document,
      CustomEvent,
    })

    await expect(
      provider({
        url: 'https://www.douyin.com/aweme/v1/web/general/search/stream/',
        method: 'GET',
      }),
    ).resolves.toMatchObject({ msToken: '', aBogus: 'sandbox-a-bogus' })
  })

  it('does not sign a non-Douyin target', async () => {
    const provider = createDouyinPageSignatureProvider({
      document: new EventTarget() as unknown as Document,
      CustomEvent,
    })

    await expect(
      provider({ url: 'https://www.bilibili.com/x/web-interface/search/type', method: 'GET' }),
    ).resolves.toBeUndefined()
  })
})
