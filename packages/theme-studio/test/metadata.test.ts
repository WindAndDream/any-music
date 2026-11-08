import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  assertUiThemeDefinition,
  assertUiThemeDescriptor,
  UI_THEME_REQUIRED_VIEWS,
} from '@any-music/ui/theme'
import vue from '@vitejs/plugin-vue'
import { compile } from 'sass'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { compileStyle } from 'vue/compiler-sfc'

import { descriptor } from '../src'
import { definition } from '../src/vue'

describe('Studio package boundary and coverage', () => {
  it('provides lightweight metadata and complete required and specialist coverage on both forms', () => {
    expect(descriptor.id).toBe('studio')
    expect(Object.keys(definition.views).toSorted()).toEqual(
      [...UI_THEME_REQUIRED_VIEWS, 'tags', 'composer'].toSorted(),
    )
    for (const form of ['desktop', 'mobile'] as const) {
      expect(() => assertUiThemeDescriptor(descriptor, form)).not.toThrow()
      expect(() =>
        assertUiThemeDefinition(descriptor, definition, form, ['tags', 'composer']),
      ).not.toThrow()
      for (const key of UI_THEME_REQUIRED_VIEWS) {
        const views = { ...definition.views }
        Reflect.deleteProperty(views, key)
        expect(() => assertUiThemeDefinition(descriptor, { ...definition, views }, form)).toThrow(
          'Incomplete theme definition',
        )
      }
    }
    const metadata = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(metadata).not.toMatch(/import\s+(?!type)|\.vue|\.scss/)
  })

  it('scopes every style rule without redefining neutral tokens or using classic selectors', () => {
    const css = compile(fileURLToPath(new URL('../src/styles/index.scss', import.meta.url))).css
    const result = compileStyle({ source: css, filename: 'studio.css', id: 'studio' })
    result.rawResult!.root.walkRules((rule) => {
      expect(
        rule.selectors.every((selector) => selector.startsWith(':where(.am-theme-studio)')),
      ).toBe(true)
    })
    expect(css).toContain('@container')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).not.toMatch(/am-theme-default|classic-|--am-color-[\w-]+:/)
  })

  it('builds a real standalone consumer with independent CSS and no classic/business/runtime modules', async () => {
    const result = await build({
      configFile: false,
      plugins: [vue()],
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./fixtures/consumer.ts', import.meta.url)),
          formats: ['es'],
        },
      },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) =>
      'output' in entry ? entry.output : [],
    )
    const modules = outputs.flatMap((output) =>
      output.type === 'chunk' ? Object.keys(output.modules) : [],
    )
    expect(modules.some((id) => id.includes('StudioRoot.vue'))).toBe(true)
    expect(modules.join('\n')).not.toMatch(
      /theme-default|DefaultTrackRow|music-workbench|plugin-source-|@tauri-apps/,
    )
    const css = outputs
      .flatMap((output) =>
        output.type === 'asset' && output.fileName.endsWith('.css') ? [output.source] : [],
      )
      .join('\n')
    expect(css).toContain('.am-theme-studio')
    expect(css).not.toMatch(/am-theme-default|classic-/)
  })
})
