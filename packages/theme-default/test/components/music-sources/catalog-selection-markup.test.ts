import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const trackRowSource = readFileSync(
  new URL('../../../src/components/music-sources/TrackRow.vue', import.meta.url),
  'utf8',
)
const catalogDrawerSource = readFileSync(
  new URL('../../../src/components/music-sources/CatalogDrawer.vue', import.meta.url),
  'utf8',
)
const operatorPanelSource = readFileSync(
  new URL('../../../src/components/music-sources/CatalogTrackOperatorPanel.vue', import.meta.url),
  'utf8',
)
const operatorLayoutSource = readFileSync(
  new URL('../../../src/components/music-sources/CatalogOperatorPanel.vue', import.meta.url),
  'utf8',
)
const playlistOperatorSource = readFileSync(
  new URL('../../../src/components/library/PlaylistOverviewOperator.vue', import.meta.url),
  'utf8',
)
const sidePanelSource = readFileSync(
  new URL(import.meta.resolve('@any-music/ui/components/SidePanel.vue')),
  'utf8',
)
const shellSource = readFileSync(
  new URL(import.meta.resolve('@any-music/ui/components/MusicAppShell.vue')),
  'utf8',
)
const workbenchStyles = readFileSync(
  new URL('../../../src/styles/_catalog.scss', import.meta.url),
  'utf8',
)
const featurePanelStyles = readFileSync(
  new URL('../../../src/styles/_foundation.scss', import.meta.url),
  'utf8',
)

describe('catalog track selection markup', () => {
  it('connects the artwork and visible checkbox to one native selection input', () => {
    // One change handler prevents a cover tap from toggling twice while both labels expand the target.
    expect(trackRowSource).toContain('const selectionInputId = useId()')
    expect(trackRowSource).toContain('class="track__cover-select"')
    expect(trackRowSource).toContain(':for="selectionInputId"')
    expect(trackRowSource).toContain(':id="selectionInputId"')
    expect(trackRowSource.match(/@change="emit\('select', track\.id\)"/g)).toHaveLength(1)
  })

  it('keeps the compact card action named instead of exposing an unlabeled icon', () => {
    expect(trackRowSource).toMatch(
      /class="track__inline-actions"[\s\S]*?<AppIcon name="more"[\s\S]*?<span>操作<\/span>/,
    )
  })

  it('pins the visible checkbox to the artwork corner without leaving a pointer focus ring', () => {
    expect(featurePanelStyles).toMatch(
      /\.track__select\s*\{[\s\S]*?inset-block-start:\s*0;[\s\S]*?inset-inline-end:\s*0;/,
    )
    expect(featurePanelStyles).toContain('.track__select:has(.track__checkbox:focus-visible)')
    expect(featurePanelStyles).not.toContain('.track__select:focus-within')
    expect(featurePanelStyles).toMatch(
      /\.track--selected\s*\{[\s\S]*?border-color:\s*var\(--am-color-primary\);/,
    )
  })

  it('keeps the read-only catalog operator limited to confirmed collection actions', () => {
    expect(operatorPanelSource).toContain('<span>加入歌单</span>')
    expect(operatorPanelSource).toContain("'下载处理中…' : '下载已选'")
    expect(operatorPanelSource).toContain('<span>添加喜欢</span>')
    expect(operatorPanelSource).not.toContain('删除已选歌曲')
    expect(catalogDrawerSource).toContain('useTrackBatchActions({')
    expect(catalogDrawerSource).toContain('@download-selected="batchActions.downloadSelected"')
    expect(catalogDrawerSource).toContain(
      '@add-to-playlist="batchActions.requestAddSelectedToPlaylist"',
    )
  })

  it('slides the action bar over all bottom controls while keeping system navigation above it', () => {
    expect(sidePanelSource).not.toContain('side-panel__scrim')
    expect(sidePanelSource).toContain('block-size: 100%;')
    expect(workbenchStyles).toContain(
      'block-size: calc(100% + var(--am-shell-mobile-navigation-offset));',
    )
    expect(shellSource).toContain('mobileNavigationHeight.value = element.offsetHeight')
    expect(sidePanelSource).toContain('transform: translateY(100%);')
    expect(sidePanelSource).toContain(
      'transition: opacity var(--am-motion-slow) var(--am-ease-standard);',
    )
    expect(workbenchStyles).toContain('z-index: var(--am-z-operator);')
    expect(shellSource).toContain('z-index: var(--am-z-drawer);')
    expect(operatorPanelSource).toContain('aria-label="将已选歌曲加入歌单"')
    expect(operatorPanelSource).toContain('<CatalogOperatorPanel')
    expect(playlistOperatorSource).toContain('<CatalogOperatorPanel')
    expect(operatorLayoutSource).toContain('grid-template-rows: repeat(2, 44px);')
    expect(operatorPanelSource).not.toContain('catalog-actions__scope')
  })

  it('reserves real scroll space above the bottom-anchored player with coordinated reduced-motion-aware transitions', () => {
    expect(workbenchStyles).toContain(
      'transition: padding-block-start var(--am-motion-slow) var(--am-ease-emphasized);',
    )
    expect(workbenchStyles).toContain('.catalog-player-stage--operator-open')
    expect(workbenchStyles).toContain('var(--am-player-block-size, 0px)')
    expect(workbenchStyles).not.toContain('.catalog-player-stage--list-operator-open')
    expect(workbenchStyles).toContain(
      'padding-block-end: max(var(--am-catalog-page-padding), var(--am-space-6));',
    )
    expect(shellSource).toContain('scroll-padding-block-end: var(--am-space-6);')
    expect(workbenchStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.catalog-player-stage,/,
    )
  })
})
