import { createAppErrorState } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'

import { usePluginCenterView } from '../../src/composables/plugins/use-plugin-center-view'
import { useCollectionDisplaySettings } from '../../src/composables/use-collection-display-settings'
import {
  createEditingSession,
  provideEditingSession,
} from '../../src/composables/use-editing-session'
import { provideSettingsFeedback } from '../../src/composables/use-settings-feedback'
import { getTrackDisplayPreferences } from '../../src/product/track-display-preferences'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'

describe('default collection display settings', () => {
  it('saves the selected region, reports write failures, and rejects old callbacks after replacement or close', () => {
    const owner = createEditingSession()
    const props = reactive({ suspended: false, setDefault: vi.fn() })
    let settings!: ReturnType<typeof useCollectionDisplaySettings>
    let feedback!: ReturnType<typeof provideSettingsFeedback>
    const Consumer = defineComponent({
      setup() {
        settings = useCollectionDisplaySettings(props)
        return () => h('div')
      },
    })
    const Root = defineComponent({
      setup() {
        provideEditingSession(owner)
        feedback = provideSettingsFeedback()
        return () => h(Consumer)
      },
    })
    const first = mountCatalogComponent(Root, {})
    settings.select('queue', 'tracks')
    settings.expanded.value = 'queue'
    settings.update({ mobileColumns: 2 })
    expect(props.setDefault).toHaveBeenCalledWith('queue', 'tracks', { mobileColumns: 2 })
    expect(feedback.notice.value?.message).toBe('默认展示方式已保存。')
    props.setDefault.mockReturnValueOnce(
      createAppErrorState('storage-write-failed', '磁盘空间不足。'),
    )
    settings.update({ itemStyle: 'minimal' })
    expect(feedback.notice.value?.tone).toBe('error')
    props.suspended = true
    settings.update({ mobileColumns: 1 })
    expect(props.setDefault).toHaveBeenCalledTimes(2)
    props.suspended = false
    const stale = settings.update
    first.unmount()
    const second = mountCatalogComponent(Root, {})
    expect(settings.expanded.value).toBe('queue')
    expect(settings.open.value).toBe(true)
    stale({ itemStyle: 'default' })
    expect(props.setDefault).toHaveBeenCalledTimes(2)
    owner.clearScope('settings')
    settings.update({ mobileColumns: 1 })
    expect(props.setDefault).toHaveBeenCalledTimes(2)
    second.unmount()
    owner.dispose()
  })

  it('uses configured defaults for unseen platform regions and keeps explicit region choices', () => {
    const defaults = { displayMode: 'compact' as const, mobileColumns: 2 as const }
    const state = {
      displayMode: 'standard' as const,
      mobileColumns: 1 as const,
      defaultDisplayPreferences: defaults,
      displayPreferences: {
        'platform:custom': { displayMode: 'comfortable' as const, mobileColumns: 1 as const },
      },
    }
    expect(getTrackDisplayPreferences(state, 'platform:unseen')).toEqual(defaults)
    expect(getTrackDisplayPreferences(state, 'platform:custom').displayMode).toBe('comfortable')
  })

  it('uses plugin defaults until a local display choice is made', () => {
    const defaults = reactive({ display: 'list' as 'list' | 'grid' })
    const plugins = usePluginCenterView([], () => defaults.display)
    expect(plugins.display.value).toBe('list')
    defaults.display = 'grid'
    expect(plugins.display.value).toBe('grid')
    plugins.display.value = 'list'
    defaults.display = 'list'
    defaults.display = 'grid'
    expect(plugins.display.value).toBe('list')
  })
})
