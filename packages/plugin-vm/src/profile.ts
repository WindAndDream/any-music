/** S11 has no data, network, storage or native capabilities. Mobile admission is closed. */
export { VM_PROFILE_HASH } from './profile-identity'
export const VM_PROFILE = Object.freeze({
  id: 'am-quickjs-noeval-desktop-v1',
  runtimeProfileVersion: 1,
  budgetProfileVersion: 1,
  engineVersion: '0.31.0-am1',
  heapBytes: 32 * 1024 * 1024,
  memoryBytes: 128 * 1024 * 1024,
  stackBytes: 256 * 1024,
  executionMs: 1000,
  interruptChecks: 10_000,
  deadlineMs: 30_000,
  jobBatch: 64,
  maxJobs: 10_000,
  messageBytes: 262_144,
  timers: 32,
  idleMs: 300_000,
  maxInstances: 8,
  totalMemoryBytes: 384 * 1024 * 1024,
  globalTasks: 16,
  callsPerMinute: 60,
  globalCallsPerMinute: 240,
  crashes: 3,
  crashWindowMs: 600_000,
  restartDelaysMs: [1000, 4000, 16_000] as readonly number[],
})

export type VmBudget = Record<
  'heapBytes' | 'executionMs' | 'deadlineMs' | 'jobBatch' | 'maxJobs' | 'timers',
  number
>

export function resolveVmBudget(input: Partial<VmBudget> = {}): VmBudget {
  const keys = ['heapBytes', 'executionMs', 'deadlineMs', 'jobBatch', 'maxJobs', 'timers'] as const
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !keys.includes(key as keyof VmBudget))
      throw new Error('Invalid VM budget')
  }
  // Snapshot every effective value once, including inherited and non-enumerable properties.
  // Validate that snapshot so changing getters cannot substitute unchecked budgets.
  const result = Object.fromEntries(
    keys.map((key) => [key, key in input ? input[key] : VM_PROFILE[key]]),
  ) as VmBudget
  for (const key of keys) {
    const value = result[key]
    if (!Number.isSafeInteger(value) || value < 1 || value > VM_PROFILE[key])
      throw new Error('Invalid VM budget')
  }
  if (result.heapBytes < 512 * 1024) throw new Error('VM startup heap minimum')
  return result
}
