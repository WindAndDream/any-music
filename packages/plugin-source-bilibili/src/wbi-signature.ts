import { md5 } from 'js-md5'

// B 站前端当前使用的固定重排表；只有 img/sub key 会随会话刷新。
const MIXIN_KEY_INDEXES = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const

export type BilibiliQueryValue = string | number | boolean | undefined

/** 从 nav 响应的两个图片文件名派生 32 字符 WBI 混淆密钥。 */
export function createWbiMixinKey(imageUrl: string, subImageUrl: string): string {
  const rawKey = `${readFileStem(imageUrl)}${readFileStem(subImageUrl)}`
  return MIXIN_KEY_INDEXES.map((index) => rawKey[index] ?? '')
    .join('')
    .slice(0, 32)
}

/**
 * 生成 B 站 WBI 查询串。
 * 参数必须先按键排序，并删除 B 站签名算法不接受的五个保留字符。
 */
export function signWbiQuery(
  params: Readonly<Record<string, BilibiliQueryValue>>,
  mixinKey: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const withTimestamp: Record<string, BilibiliQueryValue> = {
    ...params,
    wts: timestampSeconds,
  }
  const query = Object.entries(withTimestamp)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(String(value))}`)
    .join('&')

  return `${query}&w_rid=${md5(`${query}${mixinKey}`)}`
}

function readFileStem(url: string): string {
  const filename = new URL(url).pathname.split('/').pop() ?? ''
  return filename.split('.')[0] ?? ''
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, '')
}
