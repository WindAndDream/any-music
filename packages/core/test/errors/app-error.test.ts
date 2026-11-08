import { describe, expect, it } from 'vitest'

import {
  APP_ERROR_DEFINITIONS,
  AppError,
  formatAppErrorMessage,
  MusicSourceError,
  normalizeAppError,
  sanitizeAppErrorState,
  toAppErrorState,
} from '../../src'

describe('global error catalog', () => {
  it('assigns every semantic code a unique, planned status code', () => {
    const definitions = Object.values(APP_ERROR_DEFINITIONS)
    const statusCodes = definitions.map((definition) => definition.statusCode)

    expect(new Set(statusCodes).size).toBe(statusCodes.length)
    expect(statusCodes.every((statusCode) => /^AM-[1-8]\d{3}$/.test(statusCode))).toBe(true)
  })

  it('uses the catalog default while preserving subclass context', () => {
    const error = new MusicSourceError('rate-limited', '')

    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({
      code: 'rate-limited',
      statusCode: 'AM-3004',
      message: '请求过于频繁，请稍后重试。',
      isRetryable: true,
    })
  })

  it('distinguishes user verification from retryable pagination failures', () => {
    expect(new MusicSourceError('verification-required', '')).toMatchObject({
      code: 'verification-required',
      statusCode: 'AM-3005',
      message: '音乐源要求完成人工验证后再重试。',
      isRetryable: true,
    })
    expect(new MusicSourceError('pagination-unavailable', '')).toMatchObject({
      code: 'pagination-unavailable',
      statusCode: 'AM-3006',
      message: '音乐源暂时无法继续加载后续内容，请稍后重试。',
      isRetryable: true,
    })
  })

  it('normalizes unknown boundary failures into a serializable state', () => {
    const cause = new TypeError('响应连接已断开。')
    const error = normalizeAppError(cause, 'network-error')

    expect(error.cause).toBe(cause)
    expect(toAppErrorState(error)).toEqual({
      code: 'network-error',
      statusCode: 'AM-4001',
      message: '响应连接已断开。',
      category: 'network',
      severity: 'error',
      isRetryable: true,
    })
  })

  it('falls back to a managed message and formats the support code consistently', () => {
    const state = toAppErrorState(undefined, 'storage-read-failed', '工作区读取失败。')

    expect(formatAppErrorMessage(state)).toBe('工作区读取失败。（错误码：AM-5001）')
    expect(formatAppErrorMessage(state, { includeStatusCode: false })).toBe('工作区读取失败。')
  })

  it('rebuilds persisted states from the managed catalog', () => {
    expect(
      sanitizeAppErrorState({
        code: 'download-failed',
        statusCode: 'AM-9999',
        message: '第 2 次下载失败。',
        category: 'common',
      }),
    ).toEqual({
      code: 'download-failed',
      statusCode: 'AM-7201',
      message: '第 2 次下载失败。',
      category: 'download',
      severity: 'error',
      isRetryable: true,
    })
    expect(sanitizeAppErrorState({ code: 'made-up' })).toBeUndefined()
  })
})
