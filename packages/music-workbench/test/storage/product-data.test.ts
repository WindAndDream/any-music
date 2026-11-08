import { describe, expect, it, vi } from 'vitest'

import { jsonText, PRODUCT_DATA_LIMITS } from '#workbench/storage/product-data'

describe('product JSON validation', () => {
  it.each(['object', 'array'] as const)(
    'rejects own %s accessors without invoking their getter or setter',
    (kind) => {
      const get = vi.fn(() => 'must not run')
      const set = vi.fn()
      const input = kind === 'array' ? [] : {}
      Object.defineProperty(input, kind === 'array' ? '0' : 'hidden', { get, set })
      expect(() => jsonText(input)).toThrow('accessors')
      expect(get).not.toHaveBeenCalled()
      expect(set).not.toHaveBeenCalled()
    },
  )

  it('checks non-enumerable data and array properties even when JSON would omit them', () => {
    const hidden = Object.defineProperty({}, 'hidden', { value: undefined })
    const array = Object.defineProperty([], 'hidden', { value: () => {} })
    expect(() => jsonText(hidden)).toThrow('must be JSON')
    expect(() => jsonText(array)).toThrow('must be JSON')
  })

  it('accepts shared records and null prototypes while rejecting cycles and custom prototypes', () => {
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, {
      '10': null,
      '2': '😀\n\u0000',
      value: [true, 0, -0, 1.5],
    })
    expect(jsonText({ first: shared, second: shared })).toBe(
      JSON.stringify({ first: shared, second: shared }),
    )
    const cyclic: Record<string, unknown> = {}
    Object.defineProperty(cyclic, 'hidden', { value: cyclic })
    expect(() => jsonText(cyclic)).toThrow('Cyclic')
    expect(() => jsonText({ date: new Date() })).toThrow('plain objects')
  })

  it.each([undefined, () => {}, Symbol('data'), 1n, NaN, Infinity, -Infinity])(
    'rejects non-JSON values before serialization: %s',
    (value) => {
      expect(() => jsonText({ value })).toThrow('must be JSON')
    },
  )

  it('keeps complete depth and UTF-8 byte limits', () => {
    let input: unknown = null
    for (let index = 0; index < PRODUCT_DATA_LIMITS.depth; index++) input = { child: input }
    expect(() => jsonText(input)).not.toThrow()
    expect(() => jsonText({ child: input })).toThrow('depth budget')
    const text = { value: '😀中文' }
    const size = new TextEncoder().encode(JSON.stringify(text)).length
    expect(jsonText(text, size)).toBe(JSON.stringify(text))
    expect(() => jsonText(text, size - 1)).toThrow('byte budget')
  })
})
