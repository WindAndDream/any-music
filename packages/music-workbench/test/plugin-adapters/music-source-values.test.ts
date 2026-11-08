import { AppError } from '@any-music/core'
import type { AppErrorCode } from '@any-music/core'
import { expect, it } from 'vitest'

import { errorFromWire } from '../../src/plugin-adapters/music-source-values'

it.each([
  'not-authenticated',
  'account-unavailable',
  'verification-required',
  'pagination-unavailable',
  'network-error',
  'unsupported-url',
] satisfies AppErrorCode[])('preserves the independent %s failure fact', (code) => {
  const restored = errorFromWire({ code, message: 'private details', isRetryable: false })
  expect(restored.code).toBe(code)
  expect(restored.message).toBe(new AppError(code).message)
})
