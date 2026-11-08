import { expect, it } from 'vitest'

import { VmAdmission } from '../src/admission'
import { resolveVmBudget } from '../src/profile'

it('reserves global maximum memory, rejects excess work and releases idempotently', () => {
  const admission = new VmAdmission(() => 0)
  const leases = [admission.acquire('a'), admission.acquire('b'), admission.acquire('c')]
  expect(() => admission.acquire('d')).toThrow('busy')
  leases[0]!()
  leases[0]!()
  const lease = admission.acquire('d')
  expect(admission.activeCount).toBe(3)
  lease()
  leases[1]!()
  leases[2]!()
  expect(admission.activeCount).toBe(0)
})

it('keeps crash history and backoff attached to the installation across new requests', () => {
  let now = 0
  const admission = new VmAdmission(() => now)
  admission.acquire('a')(true)
  expect(() => admission.acquire('a')).toThrow('budget')
  now += 1000
  admission.acquire('a')(true)
  now += 4000
  admission.acquire('a')(true)
  now += 16000
  expect(() => admission.acquire('a')).toThrow('budget')
  now += 600000
  admission.acquire('a')()
})

it('allows only stricter finite versioned budgets', () => {
  expect(resolveVmBudget({ maxJobs: 10 }).maxJobs).toBe(10)
  expect(() => resolveVmBudget({ executionMs: 1001 })).toThrow()
  expect(() => resolveVmBudget({ heapBytes: NaN })).toThrow()
  expect(() => resolveVmBudget(Object.assign({ executionMs: 10 }, { memoryBytes: 1024 }))).toThrow()
})

it('does not let sequential successful requests reset the subject rate limit', () => {
  let now = 0
  const admission = new VmAdmission(() => now)
  for (let i = 0; i < 60; i++) admission.acquire('a')()
  expect(() => admission.acquire('a')).toThrow('budget')
  now = 60_000
  admission.acquire('a')()
})
