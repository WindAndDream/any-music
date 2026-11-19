import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../src-tauri/src/browser/douyin_browser/official-search-page.js', import.meta.url),
  'utf8',
)

function nextStep(
  url: string,
  options: { received?: boolean; rows?: number; challenge?: boolean } = {},
) {
  return runInNewContext(`(${source})("音乐", received, challenge)`, {
    location: new URL(url),
    received: options.received ?? false,
    challenge: options.challenge ?? false,
    document: { querySelector: () => ({ childElementCount: options.rows ?? 0 }) },
  })
}

it('submits on the official homepage and keeps an unready result hidden', () => {
  const home = 'https://www.douyin.com/jingxuan'
  const result = `${home}/search/${encodeURIComponent('音乐')}?type=general`
  expect(nextStep(home)).toBe('submit')
  expect(nextStep(result)).toBeNull()
  expect(nextStep(result, { received: true })).toBe('show')
  expect(nextStep(result, { rows: 1 })).toBe('show')
  expect(nextStep(`${home}/search/another-query`, { received: true, rows: 1 })).toBeNull()
})

it('shows an official challenge before rows are ready and ignores other origins', () => {
  expect(nextStep('https://www.douyin.com/jingxuan', { challenge: true })).toBe('challenge')
  expect(nextStep('https://login.douyin.com/')).toBe('challenge')
  expect(nextStep('https://example.invalid/jingxuan', { challenge: true })).toBeNull()
})
