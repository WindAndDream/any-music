import { createAppErrorState } from '@any-music/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import { normalizeCatalogFilterHistorySettings } from '../../src/composables/music-sources/catalog-filter-history-settings'
import { useCatalogFilterHistorySettings } from '../../src/composables/music-sources/use-catalog-filter-history-settings'
import {
  createEditingSession,
  provideEditingSession,
} from '../../src/composables/use-editing-session'
import { useGlobalSettings } from '../../src/composables/use-global-settings'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((stop) => stop()))

/** Real headless owners under a replaceable presentation; no product/browser is launched. */
function mountSession() {
  const editing = createEditingSession()
  const version = shallowRef(0)
  const saved = shallowRef(normalizeCatalogFilterHistorySettings(undefined))
  const save = vi.fn<(value: typeof saved.value) => ReturnType<typeof createAppErrorState> | void>()
  const emit = vi.fn()
  let forms!: ReturnType<typeof useGlobalSettings>
  let filters!: ReturnType<typeof useCatalogFilterHistorySettings>
  const page = defineComponent({
    setup() {
      forms = useGlobalSettings({
        props: {
          plugins: [],
          availabilityByPluginId: {},
          enabledPluginIds: [],
          profile: { id: 'creator', displayName: 'Saved' },
          historyLimit: 100,
          downloadConcurrency: 2,
        },
        emit,
      })
      filters = useCatalogFilterHistorySettings({ settings: () => saved.value, save })
      return () => h('form')
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        return () => h(page, { key: version.value })
      },
    }),
    {},
  )
  cleanup.push(view.unmount, () => editing.dispose())
  return {
    editing,
    version,
    emit,
    save,
    saved,
    get forms() {
      return forms
    },
    get filters() {
      return filters
    },
  }
}

describe('ordinary settings editing lifetime', () => {
  it('preserves unfinished values, filter regions and validation on replacement without writes', async () => {
    const view = mountSession()
    view.forms.profileName.value = 'Unfinished'
    view.forms.historyLimitInput.value = ''
    view.forms.downloadConcurrencyInput.value = '4'
    view.filters.regions.tracks.limits.search = '17'
    view.filters.regions.queue.collapseAfter = ''
    view.forms.submitHistoryLimit()
    await nextTick()
    const error = view.forms.historyError.value
    expect(error).not.toBe('')
    const old = view.forms
    const filterDraft = view.filters.regions
    view.version.value++
    await nextTick()
    expect(view.forms.profileName).toBe(old.profileName)
    expect(view.forms.profileName.value).toBe('Unfinished')
    expect(view.forms.historyLimitInput.value).toBe('')
    expect(view.forms.historyError.value).toBe(error)
    expect(view.forms.downloadConcurrencyInput.value).toBe('4')
    expect(view.filters.regions).toBe(filterDraft)
    expect(view.filters.regions.tracks.limits.search).toBe('17')
    expect(view.filters.regions.queue.collapseAfter).toBe('')
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
    old.submitProfile()
    expect(view.emit).not.toHaveBeenCalled()
    view.forms.submitProfile()
    expect(view.emit).toHaveBeenCalledExactlyOnceWith('updateLocalUserDisplayName', 'Unfinished')
  })

  it('rejects closed-session events immediately and resets only on a real close/reopen', async () => {
    const view = mountSession()
    const oldForms = view.forms
    const oldFilters = view.filters
    oldForms.profileName.value = 'Discard on close'
    oldFilters.regions.queue.limits.search = '19'
    view.editing.clearScope('settings')
    oldForms.submitProfile()
    oldForms.setPluginEnabled('source', true)
    oldForms.checkPlugin('source')
    oldFilters.submitSettings('queue')
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
    view.version.value++
    await nextTick()
    expect(view.forms.profileName.value).toBe('Saved')
    expect(view.filters.regions.queue.limits.search).toBe(12)
    oldForms.submitProfile()
    oldFilters.submitSettings('queue')
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.save).not.toHaveBeenCalled()
  })

  it('validates a region and reports returned or thrown persistence failures', async () => {
    const view = mountSession()
    view.filters.regions.queue.collapseAfter = ''
    view.filters.submitSettings('queue')
    expect(view.save).not.toHaveBeenCalled()
    expect(view.filters.feedbackByContext.queue.errorMessage).toContain('1 至 100')
    view.filters.regions.queue.collapseAfter = '4'
    const failure = createAppErrorState('storage-write-failed', 'Disk rejected')
    view.save.mockReturnValueOnce(failure)
    view.filters.submitSettings('queue')
    expect(view.filters.feedbackByContext.queue.errorMessage).toContain('Disk rejected')
    expect(view.filters.feedbackByContext.queue.statusMessage).toBe('')
    view.save.mockImplementationOnce(() => {
      throw new Error('Storage unavailable')
    })
    view.filters.submitSettings('queue')
    expect(view.filters.feedbackByContext.queue.errorMessage).toContain('Storage unavailable')
    view.save.mockImplementationOnce((value) => {
      view.saved.value = value
    })
    view.filters.submitSettings('queue')
    await nextTick()
    expect(view.saved.value.contexts?.queue?.collapseAfter).toBe(4)
    expect(view.filters.feedbackByContext.queue.errorMessage).toBe('')
    expect(view.filters.feedbackByContext.queue.statusMessage).not.toBe('')
  })
})
