/**
 * 抖音 a_bogus 使用的纯 TypeScript SM3。
 *
 * 浏览器 WebCrypto 尚未提供 SM3，因此签名适配器需要一个无 Node、无 DOM 的实现。
 * 该模块只接受字节并返回十六进制摘要，避免把平台签名细节扩散到通用工具包。
 */
const INITIAL_VECTOR = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
]

function rotateLeft(value: number, distance: number): number {
  const amount = distance % 32
  return ((value << amount) | (value >>> (32 - amount))) >>> 0
}

function permutationZero(value: number): number {
  return (value ^ rotateLeft(value, 9) ^ rotateLeft(value, 17)) >>> 0
}

function permutationOne(value: number): number {
  return (value ^ rotateLeft(value, 15) ^ rotateLeft(value, 23)) >>> 0
}

function roundConstant(round: number): number {
  return round < 16 ? 0x79cc4519 : 0x7a879d8a
}

function booleanFunctionF(round: number, left: number, middle: number, right: number): number {
  return (
    (round < 16 ? left ^ middle ^ right : (left & middle) | (left & right) | (middle & right)) >>> 0
  )
}

function booleanFunctionG(round: number, left: number, middle: number, right: number): number {
  return (round < 16 ? left ^ middle ^ right : (left & middle) | (~left & right)) >>> 0
}

function compress(vector: readonly number[], block: readonly number[]): number[] {
  const words = Array.from({ length: 68 }, () => 0)
  for (let index = 0; index < 16; index += 1) {
    words[index] =
      ((block[index * 4]! << 24) |
        (block[index * 4 + 1]! << 16) |
        (block[index * 4 + 2]! << 8) |
        block[index * 4 + 3]!) >>>
      0
  }
  for (let index = 16; index < 68; index += 1) {
    words[index] =
      (permutationOne(
        (words[index - 16]! ^ words[index - 9]! ^ rotateLeft(words[index - 3]!, 15)) >>> 0,
      ) ^
        rotateLeft(words[index - 13]!, 7) ^
        words[index - 6]!) >>>
      0
  }

  const expanded = Array.from({ length: 64 }, () => 0)
  for (let index = 0; index < 64; index += 1) {
    expanded[index] = (words[index]! ^ words[index + 4]!) >>> 0
  }

  let [a, b, c, d, e, f, g, h] = vector as number[]
  for (let round = 0; round < 64; round += 1) {
    const ss1 = rotateLeft(
      ((rotateLeft(a!, 12) + e!) >>> 0) + rotateLeft(roundConstant(round), round),
      7,
    )
    const ss2 = (ss1 ^ rotateLeft(a!, 12)) >>> 0
    const tt1 =
      ((booleanFunctionF(round, a!, b!, c!) + d!) >>> 0) + ((ss2 + expanded[round]!) >>> 0)
    const tt2 = ((booleanFunctionG(round, e!, f!, g!) + h!) >>> 0) + ((ss1 + words[round]!) >>> 0)
    d = c
    c = rotateLeft(b!, 9)
    b = a
    a = tt1 >>> 0
    h = g
    g = rotateLeft(f!, 19)
    f = e
    e = permutationZero(tt2 >>> 0)
  }

  return [a!, b!, c!, d!, e!, f!, g!, h!].map((value, index) => (value ^ vector[index]!) >>> 0)
}

/** 计算 SM3 十六进制摘要；测试向量来自 GB/T 32905 的公开示例。 */
export function createSm3Hash(message: readonly number[] | Uint8Array): string {
  const bitLength = message.length * 8
  const padded = Array.from(message)
  padded.push(0x80)
  while (padded.length % 64 !== 56) padded.push(0)
  for (let index = 0; index < 8; index += 1) {
    const shift = 8 * (7 - index)
    padded.push(Math.floor(bitLength / 2 ** shift) & 0xff)
  }

  let vector = [...INITIAL_VECTOR]
  for (let offset = 0; offset < padded.length; offset += 64) {
    vector = compress(vector, padded.slice(offset, offset + 64))
  }
  return vector.map((value) => value.toString(16).padStart(8, '0')).join('')
}
