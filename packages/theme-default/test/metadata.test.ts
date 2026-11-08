import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { assertUiThemeDefinition, assertUiThemeDescriptor } from '@any-music/ui/theme'
import { compile } from 'sass'
import { describe, expect, it } from 'vitest'
import { compileStyle } from 'vue/compiler-sfc'

import { descriptor } from '../src'
import { definition } from '../src/vue'

describe('classic theme admission', () => {
  it('keeps build metadata lightweight and preserves the existing identity and settings schema', () => {
    expect(descriptor).toEqual({
      id: 'default',
      title: '经典',
      contractVersion: 1,
      settingsSchemaVersion: 1,
      forms: ['desktop', 'mobile'],
    })
    for (const form of descriptor.forms)
      expect(() => assertUiThemeDescriptor(descriptor, form)).not.toThrow()
    const metadata = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(metadata).not.toMatch(/import\s+(?!type)|\.vue|\.scss/)
  })

  it('covers every required region and both optional editors in desktop and mobile forms', () => {
    expect(Object.keys(definition.views)).toEqual(
      expect.arrayContaining(['shell', 'navigation', 'player', 'catalog']),
    )
    for (const form of descriptor.forms)
      expect(() =>
        assertUiThemeDefinition(descriptor, definition, form, ['tags', 'composer']),
      ).not.toThrow()
  })

  it('scopes extracted chrome CSS and preserves reduced motion without copying tokens or host rules', () => {
    const css = compile(fileURLToPath(new URL('../src/styles/index.scss', import.meta.url))).css
    const result = compileStyle({ source: css, filename: 'classic.css', id: 'classic' })
    result.rawResult!.root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return
      expect(
        rule.selectors.every((selector) => selector.startsWith(':where(.am-theme-default)')),
      ).toBe(true)
    })
    expect(css).toContain(':where(.am-theme-default).product-workbench')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toMatch(/--am-color-[\w-]+:|\.session|\.settings|\.module-recovery/)
  })
})
