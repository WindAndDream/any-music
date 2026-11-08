import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const config = JSON.parse(
  readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
)
const directives = new Map<string, string[]>(
  config.app.security.csp.split(';').map((directive: string) => {
    const [name, ...values] = directive.trim().split(/\s+/)
    return [name!, values]
  }),
)

describe('trusted host audio encoding policy', () => {
  it('allows the bundled MP3 worker and WASM while retaining local script and frame boundaries', () => {
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('frame-src')).toEqual(["'none'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
  })
})
