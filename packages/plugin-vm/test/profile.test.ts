import { expect, it } from 'vitest'

import { resolveVmBudget, VM_PROFILE } from '../src/profile'
import type { VmBudget } from '../src/profile'

const budgetKeys = [
  'heapBytes',
  'executionMs',
  'deadlineMs',
  'jobBatch',
  'maxJobs',
  'timers',
] as const

it('uses the fixed defaults for omitted budgets', () => {
  const defaults = Object.fromEntries(budgetKeys.map((key) => [key, VM_PROFILE[key]]))
  expect(resolveVmBudget()).toEqual(defaults)
  expect(resolveVmBudget({})).toEqual(defaults)
})

it.each(budgetKeys)('accepts the fixed or stricter %s without changing the input', (key) => {
  expect(resolveVmBudget({ [key]: VM_PROFILE[key] })[key]).toBe(VM_PROFILE[key])
  const value = key === 'heapBytes' ? 512 * 1024 : 1
  const input = Object.freeze({ [key]: value })
  expect(resolveVmBudget(input)[key]).toBe(value)
  expect(input).toEqual({ [key]: value })
})

it.each(budgetKeys)('rejects increased %s from inherited or non-enumerable properties', (key) => {
  const value = VM_PROFILE[key] + 1
  const inherited = Object.create({ [key]: value }) as Partial<VmBudget>
  const nonEnumerable = Object.defineProperty({}, key, { value })
  expect(() => resolveVmBudget(inherited)).toThrow('Invalid VM budget')
  expect(() => resolveVmBudget(nonEnumerable)).toThrow('Invalid VM budget')
})

it.each(budgetKeys)('validates the first %s getter value and reads it only once', (key) => {
  let reads = 0
  const input = Object.defineProperty({}, key, {
    enumerable: true,
    get: () => (++reads === 1 ? VM_PROFILE[key] + 1 : 1),
  })
  expect(() => resolveVmBudget(input)).toThrow('Invalid VM budget')
  expect(reads).toBe(1)
})

it.each(budgetKeys)('keeps a valid %s getter snapshot without rereading the input', (key) => {
  let reads = 0
  const value = key === 'heapBytes' ? 512 * 1024 : 1
  const input = Object.defineProperty({}, key, {
    enumerable: true,
    get: () => (++reads === 1 ? value : VM_PROFILE[key] + 1),
  })
  expect(resolveVmBudget(input)[key]).toBe(value)
  expect(reads).toBe(1)
})

it.each(budgetKeys)('rejects invalid explicit %s values instead of defaulting them', (key) => {
  for (const value of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    null,
    undefined,
  ]) {
    const input = { [key]: value } as Partial<VmBudget>
    expect(() => resolveVmBudget(input)).toThrow('Invalid VM budget')
  }
})

it('rejects unsupported keys even when they are hidden or symbols', () => {
  for (const input of [
    { memoryBytes: VM_PROFILE.memoryBytes },
    Object.defineProperty({}, 'memoryBytes', { value: VM_PROFILE.memoryBytes }),
    { [Symbol('executionMs')]: 1 },
  ]) {
    expect(() => resolveVmBudget(input)).toThrow('Invalid VM budget')
  }
})

it('keeps the startup heap minimum after validating inherited values', () => {
  const minimum = 512 * 1024
  expect(resolveVmBudget(Object.create({ heapBytes: minimum })).heapBytes).toBe(minimum)
  expect(() => resolveVmBudget(Object.create({ heapBytes: minimum - 1 }))).toThrow(
    'VM startup heap minimum',
  )
})
