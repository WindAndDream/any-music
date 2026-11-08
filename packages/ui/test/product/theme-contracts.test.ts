import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import type { UiThemeDescriptor } from '../../src/theme'
import {
  assertUiThemeDefinition,
  assertUiThemeDescriptor,
  UI_THEME_REQUIRED_VIEWS,
} from '../../src/theme'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../components/music-sources/catalog-test-renderer'
import { deckTheme, railTheme } from '../fixtures/themes/compliant-themes'
import { createThemeFeatures } from '../fixtures/themes/theme-features'

const descriptor: UiThemeDescriptor = {
  id: 'default',
  title: 'Classic',
  contractVersion: 1,
  forms: ['desktop', 'mobile'],
  settingsSchemaVersion: 1,
}

describe('complete theme contract', () => {
  it('accepts two independent layouts with all required and optional views', () => {
    for (const definition of [railTheme, deckTheme])
      for (const form of ['desktop', 'mobile'] as const)
        expect(() =>
          assertUiThemeDefinition({ ...descriptor, id: definition.id }, definition, form, [
            'tags',
            'composer',
          ]),
        ).not.toThrow()
  })

  it('rejects every missing required view instead of silently using a classic component', () => {
    for (const key of UI_THEME_REQUIRED_VIEWS) {
      const views = { ...railTheme.views }
      Reflect.deleteProperty(views, key)
      expect(() => assertUiThemeDefinition(descriptor, { ...railTheme, views }, 'desktop')).toThrow(
        'Incomplete theme definition',
      )
    }
  })

  it('requires specialized coverage only when the host enables that capability', () => {
    const { tags: _tags, composer: _composer, ...views } = railTheme.views
    const definition = { ...railTheme, views }
    expect(() => assertUiThemeDefinition(descriptor, definition, 'mobile')).not.toThrow()
    for (const key of ['tags', 'composer'] as const)
      expect(() => assertUiThemeDefinition(descriptor, definition, 'mobile', [key])).toThrow()
  })

  it('rejects incompatible metadata/forms and malformed root/view batches', () => {
    for (const value of [
      null,
      {},
      { ...descriptor, id: '../external' },
      { ...descriptor, id: '' },
      { ...descriptor, id: 'host' },
      { ...descriptor, id: 'x'.repeat(65) },
      { ...descriptor, contractVersion: 2 },
      { ...descriptor, forms: ['watch'] },
      { ...descriptor, forms: ['desktop', 'desktop'] },
      { ...descriptor, settingsSchemaVersion: 2 },
      { ...descriptor, title: '' },
      { ...descriptor, forms: ['desktop'] },
    ])
      expect(() => assertUiThemeDescriptor(value, 'mobile')).toThrow('Incompatible build theme')
    for (const value of [
      null,
      { ...railTheme, id: 'studio' },
      { ...railTheme, contractVersion: 2 },
      { ...railTheme, Root: {} },
      { ...railTheme, views: { ...railTheme.views, player: null } },
      { ...railTheme, views: { ...railTheme.views, arbitrary: railTheme.Root } },
    ])
      expect(() => assertUiThemeDefinition(descriptor, value, 'desktop')).toThrow()
  })

  it('renders both layouts with the same readonly feature input, named operation and host slot', () => {
    const submit = vi.fn()
    const features = createThemeFeatures(submit)
    for (const definition of [railTheme, deckTheme]) {
      const app = defineComponent({
        setup: () => () =>
          h(
            definition.Root,
            { features, views: definition.views, form: 'mobile' },
            {
              'source-identity': ({ sourceId }: { sourceId: string }) =>
                h('strong', `Host identity: ${sourceId}`),
            },
          ),
      })
      const mounted = mountCatalogComponent(app, {})
      expect(mounted.root.textContent).toContain('kept query')
      expect(mounted.root.textContent).toContain('Host identity: bilibili')
      expect(
        findCatalogElement(mounted.root, (node) => node.props['data-view'] === 'player').props[
          'data-availability'
        ],
      ).toBe('unavailable')
      dispatchCatalogEvent(
        findCatalogElement(mounted.root, (node) => node.tag === 'button'),
        'onClick',
      )
      mounted.unmount()
    }
    expect(submit).toHaveBeenCalledTimes(2)
  })
})
