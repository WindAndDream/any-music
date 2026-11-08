import type { CustomTrackDefinition, LibraryTrackRecord } from '@any-music/core'
import { provideConfirmationDialog } from '@any-music/ui/library'
import { UI_CONTRIBUTIONS } from '@any-music/ui/library'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import CustomTrackPanel from '../../../src/components/library/CustomTrackPanel.vue'

describe('host published-work view', () => {
  it('renders published works and core actions with no optional feature contributions', async () => {
    const record: LibraryTrackRecord = {
      track: {
        id: 'local:custom:one',
        title: '已发布作品',
        artists: [{ name: '创作者' }],
        durationMs: 1_000,
        source: { pluginId: 'local-custom', resourceId: 'one', mediaKind: 'custom' },
      },
      customTags: [],
      addedAtMs: 1,
      updatedAtMs: 1,
    }
    const definition: CustomTrackDefinition = {
      trackId: record.track.id,
      version: 1,
      materialCollectionId: '',
      recipe: [{ sourceTrackId: 'leaf', startMs: 0, endMs: 1_000 }],
      compiledSegments: [
        { sourceTrackId: 'leaf', startMs: 0, endMs: 1_000, virtualStartMs: 0, virtualEndMs: 1_000 },
      ],
      creator: { id: 'creator', displayName: '创作者' },
      sourceCredits: [],
      createdAtMs: 1,
    }
    const app = createSSRApp({
      setup() {
        provideConfirmationDialog()
        return () =>
          h(CustomTrackPanel, {
            records: [record],
            customTracks: [definition],
            materialCollections: [],
            platformNames: new Map<string, string>(),
            favoriteTrackIds: new Set<string>(),
            errorMessage: '',
            exportBusy: false,
            exportMessage: '',
          })
      },
    })
    app.provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
    const html = await renderToString(app)
    expect(html).toContain('已发布作品')
    expect(html).toContain('创作者')
    expect(html).toContain('播放</button>')
    expect(html).toContain('待听</button>')
    expect(html).toMatch(/>\s*下载\s*<\/button>/)
    expect(html).not.toContain('作为素材')
  })
})
