/**
 * 抖音网页请求签名（a_bogus）。
 *
 * 已知落差（2026-10-03 实站复测，证据见 apps/tauri/test/fixtures/douyin-login-risk-capture.json）：
 * 本实现产出的值被 passport 端点拒绝（业务码 4031），而在同一台机器、同一 Cookie 下，
 * 由现役 Web SecSDK 亲签的值能被接受，因此拒绝原因与本模块的输入口径无关——
 * 九种输入口径与三种浏览器指纹均已试过。
 *
 * 已定位的边界：服务端接受的载荷为 140–144 字节，本实现为 124 字节；服务端只校验
 * 解码后前 4 字节（即字符串开头约 6 个字符），其中仍有被容忍的位置（第 4 位可改、
 * 第 5 位致命），所以不是简单前缀比对。该段不吃查询串也不吃时钟，只随客户端随机
 * 材料变化，性质更接近客户端证明字段而非请求摘要。
 *
 * 要校准它需要现役 secsdk 的源码（三个 bundle 均字符串混淆，无字母表亦无 a_bogus
 * 字面量）或大规模经验搜索。**在重新校准之前，不要假设本模块足以让 passport 请求通过。**
 */
import { createSm3Hash } from './sm3'

/**
 * 便于契约测试固定时间与随机数；生产请求始终省略这些字段。
 *
 * 算法常量按 Apache-2.0 项目 RandallAnjie/Douyin-API 的纯 JS 端口复核，
 * 其上游为 Evil0ctal/Douyin_TikTok_Download_API。这里只保留抖音网页请求所需路径。
 */
export interface DouyinSignatureOptions {
  /** 必须与最终请求头一致；省略时保留旧固定向量的 UA。 */
  userAgent?: string
  /** 当前窗口真实尺寸组合；省略时保留旧固定向量的浏览器指纹。 */
  browserFingerprint?: string
  randomOne?: number
  randomTwo?: number
  randomThree?: number
  startTimeMs?: number
  endTimeMs?: number
}

const DEFAULT_USER_AGENT_CODE = [
  76, 98, 15, 131, 97, 245, 224, 133, 122, 199, 241, 166, 79, 34, 90, 191, 128, 126, 122, 98, 66,
  11, 14, 40, 49, 110, 110, 173, 67, 96, 138, 252,
]
const DEFAULT_BROWSER_FINGERPRINT =
  '1536|742|1536|864|0|0|0|0|1536|864|1536|864|1536|742|24|24|MacIntel'
const SIGNATURE_ALPHABET = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe'
const USER_AGENT_ALPHABET = 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe'

function rc4(key: readonly number[], data: readonly number[]): number[] {
  const state = Array.from({ length: 256 }, (_, index) => index)
  let right = 0
  for (let left = 0; left < state.length; left += 1) {
    right = (right + state[left]! + key[left % key.length]!) % 256
    ;[state[left], state[right]] = [state[right]!, state[left]!]
  }

  const output = Array.from({ length: data.length }, () => 0)
  let left = 0
  right = 0
  for (let index = 0; index < data.length; index += 1) {
    left = (left + 1) % 256
    right = (right + state[left]!) % 256
    ;[state[left], state[right]] = [state[right]!, state[left]!]
    output[index] = data[index]! ^ state[(state[left]! + state[right]!) % 256]!
  }
  return output
}

function sm3Bytes(value: string | readonly number[]): number[] {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const hex = createSm3Hash(bytes)
  return Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  )
}

function doubleSm3(value: string): number[] {
  return sm3Bytes(sm3Bytes(`${value}cus`))
}

function createRandomList(
  input: number,
  leftMask: number,
  rightMask: number,
  first: number,
  second: number,
  third: number,
  fourth: number,
): number[] {
  const random = input || Math.random() * 10_000
  const integer = Math.trunc(random)
  const low = integer & 0xff
  const high = integer >> 8
  return [
    (low & leftMask) | first,
    (low & rightMask) | second,
    (high & leftMask) | third,
    (high & rightMask) | fourth,
  ]
}

function byteAt(value: number, shift: number): number {
  // 位运算会把毫秒时间戳截成 32 位，必须用除法保留高位。
  return Math.floor(value / 2 ** shift) % 256
}

function createPayload(
  query: string,
  method: string,
  startTimeMs: number,
  endTimeMs: number,
  userAgentCode: readonly number[],
  browserFingerprint: string,
): number[] {
  const queryHash = doubleSm3(query)
  const methodHash = doubleSm3(method)
  const browserCodes = Array.from(browserFingerprint, (character) => character.charCodeAt(0))
  const payload = [
    44,
    byteAt(endTimeMs, 24),
    0,
    0,
    0,
    0,
    24,
    queryHash[21]!,
    methodHash[21]!,
    0,
    userAgentCode[23]!,
    byteAt(endTimeMs, 16),
    0,
    0,
    0,
    1,
    0,
    239,
    queryHash[22]!,
    methodHash[22]!,
    userAgentCode[24]!,
    byteAt(endTimeMs, 8),
    0,
    0,
    0,
    0,
    byteAt(endTimeMs, 0),
    0,
    0,
    14,
    byteAt(startTimeMs, 24),
    byteAt(startTimeMs, 16),
    0,
    byteAt(startTimeMs, 8),
    byteAt(startTimeMs, 0),
    3,
    Math.floor(endTimeMs / 2 ** 32),
    1,
    Math.floor(startTimeMs / 2 ** 32),
    1,
    browserFingerprint.length,
    0,
    0,
    0,
  ]
  const checksum = payload.reduce((result, value) => result ^ value, 0)
  return rc4([121], [...payload, ...browserCodes, checksum])
}

function encodePayload(bytes: readonly number[], alphabet = SIGNATURE_ALPHABET): string {
  const output: string[] = []
  const shifts = [18, 12, 6, 0]
  const masks = [0xfc0000, 0x03f000, 0x0fc0, 0x3f]
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index
    const value =
      (bytes[index]! << 16) |
      (remaining > 1 ? bytes[index + 1]! << 8 : 0) |
      (remaining > 2 ? bytes[index + 2]! : 0)
    for (let part = 0; part < shifts.length; part += 1) {
      if (part === 2 && remaining < 2) break
      if (part === 3 && remaining < 3) break
      output.push(alphabet[(value & masks[part]!) >> shifts[part]!]!)
    }
  }
  return `${output.join('')}${'='.repeat((4 - (output.length % 4)) % 4)}`
}

/** 为最终 URL 中完全相同的已编码查询串生成 a_bogus。 */
export function createDouyinABogus(
  query: string,
  method = 'GET',
  options: DouyinSignatureOptions = {},
): string {
  const startTimeMs = options.startTimeMs ?? Date.now()
  const endTimeMs = options.endTimeMs ?? startTimeMs + Math.floor(Math.random() * 5) + 4
  const userAgentCode = options.userAgent
    ? createUserAgentCode(options.userAgent)
    : DEFAULT_USER_AGENT_CODE
  const browserFingerprint = options.browserFingerprint ?? DEFAULT_BROWSER_FINGERPRINT
  const prefix = [
    ...createRandomList(options.randomOne ?? Math.random(), 170, 85, 1, 2, 5, 45 & 170),
    ...createRandomList(options.randomTwo ?? Math.random(), 170, 85, 1, 0, 0, 0),
    ...createRandomList(options.randomThree ?? Math.random(), 170, 85, 1, 0, 5, 0),
  ]
  return encodePayload([
    ...prefix,
    ...createPayload(query, method, startTimeMs, endTimeMs, userAgentCode, browserFingerprint),
  ])
}

/** UA 摘要是 RC4(\0\1\x0e) + 抖音自定义 Base64 + 单次 SM3，不能使用固定浏览器常量。 */
function createUserAgentCode(userAgent: string): number[] {
  const encrypted = rc4([0, 1, 14], [...new TextEncoder().encode(userAgent)])
  return sm3Bytes(encodePayload(encrypted, USER_AGENT_ALPHABET))
}
