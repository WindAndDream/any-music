import { describe, expect, it } from 'vitest'

import { PluginCatalog, PluginCatalogError } from '../src/index'

describe('generic plugin catalog', () => {
  it('validates updates atomically while preserving built-in removal protection', () => {
    const builtin = { descriptor: { id: 'core', name: 'Core' } }
    const catalog = new PluginCatalog([builtin])
    catalog.install({ descriptor: { id: 'other', name: 'Other' } })
    const snapshot = catalog.plugins
    expect(() => catalog.replace({ descriptor: { id: 'core', name: ' OTHER ' } })).toThrow(
      PluginCatalogError,
    )
    expect(catalog.plugins).toBe(snapshot)
    catalog.replace({ descriptor: { id: 'core', name: 'Updated core' } })
    expect(catalog.get('core')?.descriptor.name).toBe('Updated core')
    expect(() => catalog.remove('core')).toThrow(PluginCatalogError)
    expect(() =>
      catalog.install({ descriptor: { id: 'released-name', name: 'Core' } }),
    ).not.toThrow()
  })
  it('hosts non-music plugins and protects built-ins', () => {
    const builtin = { descriptor: { id: 'export', name: 'Export' }, run: () => 'document' }
    const catalog = new PluginCatalog([builtin])
    expect(catalog.get('export')?.run()).toBe('document')
    expect(() => catalog.remove('export')).toThrow(PluginCatalogError)
    expect(() => catalog.install({ ...builtin })).toThrow(PluginCatalogError)
  })

  it('normalizes names and releases the installed name even if a plugin mutates its descriptor', () => {
    const catalog = new PluginCatalog()
    const plugin = { descriptor: { id: 'one', name: '  ＥＸＰＯＲＴ   Audio ' } }
    catalog.install(plugin)
    expect(() => catalog.install({ descriptor: { id: 'two', name: 'export audio' } })).toThrow(
      PluginCatalogError,
    )
    plugin.descriptor.name = 'changed'
    catalog.remove('one')
    expect(() => catalog.install({ descriptor: { id: 'two', name: 'export audio' } })).not.toThrow()
  })

  it('exposes immutable snapshots without allowing callers to alter membership', () => {
    const catalog = new PluginCatalog()
    const snapshot = catalog.plugins
    catalog.install({ descriptor: { id: 'one', name: 'One' } })
    expect(snapshot).toEqual([])
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(catalog.plugins).toHaveLength(1)
  })
})
