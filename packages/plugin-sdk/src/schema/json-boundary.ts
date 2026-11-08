import { PROTOCOL_REGISTRY } from '../generated/registry.ts'

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolValidationError'
  }
}
const limits = PROTOCOL_REGISTRY.limits
const dangerous = new Set(['__proto__', 'prototype', 'constructor'])
function fail(message: string): never {
  throw new ProtocolValidationError(message)
}

/** Counts encoded bytes without importing browser/Node globals; rejects lone surrogates. */
function stringSize(value: string): number {
  let bytes = 0,
    points = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    points++
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('Invalid Unicode scalar')
      bytes += 4
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('Invalid Unicode scalar')
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3
  }
  if (points > limits.stringCodePoints) fail('String limit exceeded')
  return bytes
}

/** Parse incrementally: duplicate keys and structure limits are checked before allocation. */
export function parseBoundedJson(source: string): unknown {
  if (typeof source !== 'string' || source.length > limits.messageBytes)
    fail('Message byte limit exceeded')
  // Whole encoded JSON can be longer than an individual decoded string.
  let rawBytes = 0
  for (const character of source) {
    const code = character.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) fail('Invalid Unicode scalar')
    rawBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4
    if (rawBytes > limits.messageBytes) fail('Message byte limit exceeded')
  }
  let offset = 0,
    nodes = 0
  const whitespace = () => {
    while (offset < source.length && ' \t\r\n'.includes(source[offset]!)) offset++
  }
  const count = () => {
    if (++nodes > limits.nodes) fail('Node limit exceeded')
  }
  function string(): string {
    const start = offset++
    let closed = false
    while (offset < source.length) {
      const char = source[offset++]
      if (char === '\\') offset++
      else if (char === '"') {
        closed = true
        break
      }
    }
    if (!closed) fail('Unterminated string')
    let result: string
    try {
      result = JSON.parse(source.slice(start, offset)) as string
    } catch {
      fail('Invalid JSON string')
    }
    stringSize(result!)
    return result!
  }
  function value(depth: number): unknown {
    if (depth > limits.depth) fail('Depth limit exceeded')
    count()
    whitespace()
    const char = source[offset]
    if (char === '"') return string()
    if (char === '{') {
      offset++
      whitespace()
      const result: Record<string, unknown> = {},
        keys = new Set<string>()
      if (source[offset] === '}') {
        offset++
        return result
      }
      while (offset < source.length) {
        whitespace()
        if (source[offset] !== '"') fail('Expected JSON key')
        const key = string()
        count()
        if (dangerous.has(key) || keys.has(key)) fail('Duplicate or dangerous JSON key')
        keys.add(key)
        whitespace()
        if (source[offset++] !== ':') fail('Expected colon')
        result[key] = value(depth + 1)
        whitespace()
        const separator = source[offset++]
        if (separator === '}') return result
        if (separator !== ',') fail('Expected object separator')
      }
      fail('Unterminated object')
    }
    if (char === '[') {
      offset++
      whitespace()
      const result: unknown[] = []
      if (source[offset] === ']') {
        offset++
        return result
      }
      while (offset < source.length) {
        result.push(value(depth + 1))
        whitespace()
        const separator = source[offset++]
        if (separator === ']') return result
        if (separator !== ',') fail('Expected array separator')
      }
      fail('Unterminated array')
    }
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (source.startsWith(word, offset)) {
        offset += word.length
        return result
      }
    }
    const token = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)/)?.[0]
    if (!token) fail('Expected JSON value')
    offset += token.length
    const result = Number(token)
    if (!Number.isSafeInteger(result) || Object.is(result, -0))
      fail('Unsafe or noncanonical integer')
    return result
  }
  const result = value(0)
  whitespace()
  if (offset !== source.length) fail('Trailing or noncanonical JSON')
  return result
}

/** In-process DTO checks never invoke getters or toJSON. Untrusted VM values arrive as bytes. */
export function assertJsonValue(input: unknown): void {
  let nodes = 0
  const ancestors = new Set<object>()
  function visit(value: unknown, depth: number): void {
    if (++nodes > limits.nodes || depth > limits.depth) fail('Structure limit exceeded')
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'string') {
      stringSize(value)
      return
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('Unsafe integer')
      return
    }
    if (typeof value !== 'object') fail('Non-JSON value')
    const proto = Object.getPrototypeOf(value)
    if (
      Array.isArray(value)
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      fail('Custom prototype')
    if (ancestors.has(value)) fail('Cyclic value')
    ancestors.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(value).length) fail('Symbol property')
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue
      if (dangerous.has(key) || !('value' in descriptor) || !descriptor.enumerable)
        fail('Unsafe property')
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) fail('Non-JSON array property')
      if (!Array.isArray(value) && ++nodes > limits.nodes) fail('Node limit exceeded')
      stringSize(key)
      visit(descriptor.value, depth + 1)
    }
    if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1)
      fail('Sparse array')
    ancestors.delete(value)
  }
  visit(input, 0)
  if (stringSizeOfJson(input) > limits.messageBytes) fail('Message byte limit exceeded')
}

function stringSizeOfJson(input: unknown): number {
  const source = JSON.stringify(input)
  let size = 0
  for (const char of source) {
    const code = char.codePointAt(0)!
    size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4
  }
  return size
}
