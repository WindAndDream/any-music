import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { compile } from 'sass'
import { describe, expect, it } from 'vitest'
import { compileStyle, parse } from 'vue/compiler-sfc'

function compileSfcStyles(path: string) {
  const url =
    path === 'product-workbench/ProductTopBar'
      ? new URL('../../../src/components/shell/ProductTopBar.vue', import.meta.url)
      : path === 'product-workbench/AppShellPreferencesPanel'
        ? new URL('../../../src/components/settings/AppShellPreferencesPanel.vue', import.meta.url)
        : path.startsWith('music-sources/Queue') ||
            path.startsWith('music-sources/Catalog') ||
            path.startsWith('downloads/') ||
            path.startsWith('library/')
          ? new URL(`../../../src/components/${path}.vue`, import.meta.url)
          : new URL(import.meta.resolve(`@any-music/ui/components/${path}.vue`))
  const { descriptor } = parse(readFileSync(url, 'utf8'))
  return compileStyle({
    source: descriptor.styles.map((style) => style.content).join('\n'),
    filename: fileURLToPath(url),
    preprocessLang: descriptor.styles[0]?.lang === 'scss' ? 'scss' : undefined,
    id: 'sidebar-layout',
  }).rawResult!.root
}

const topBarStyles = compileSfcStyles('product-workbench/ProductTopBar')
const shellStyles = compileSfcStyles('MusicAppShell')
const catalogListStyles = compileSfcStyles('music-sources/CatalogDrawerList')
const catalogListHeaderStyles = compileSfcStyles('music-sources/CatalogDrawerListHeader')
const catalogDetailsStyles = compileSfcStyles('music-sources/CatalogDrawerDetails')
const catalogCardStyles = compileSfcStyles('music-sources/CatalogDrawerCard')
const catalogHeadingHandleStyles = compileSfcStyles('music-sources/CatalogHeadingHandle')
const trackListStyles = compileSfcStyles('music-sources/TrackCardGrid')
const queueStyles = compileSfcStyles('music-sources/QueuePanel')
const queueRowStyles = compileSfcStyles('music-sources/QueueTrackRow')
const downloadRowStyles = compileSfcStyles('downloads/DownloadTrackRow')
const playlistTileStyles = compileSfcStyles('library/ClassicPlaylistTile')
const queueViewStyles = compileSfcStyles('music-sources/QueueViewControls')
const preferencesStyles = compileSfcStyles('product-workbench/AppShellPreferencesPanel')
const operatorStyles = compileSfcStyles('SidePanel')
const trackOperatorStyles = compileSfcStyles('music-sources/CatalogOperatorPanel')
const listOperatorStyles = compileSfcStyles('music-sources/CatalogDrawerOperatorPanel')
const operatorActionStyles = compileSfcStyles('music-sources/CatalogOperatorActions')
const sessionStyles = compileSfcStyles('music-sources/SessionBadge')
const sharedStyles = compileStyle({
  source:
    compile(fileURLToPath(new URL(import.meta.resolve('@any-music/ui/styles')))).css +
    compile(
      fileURLToPath(new URL('../../../src/styles/index.scss', import.meta.url)),
    ).css.replaceAll(':where(.am-theme-default) ', ''),
  filename: 'shared-layout.css',
  id: 'shared-layout',
}).rawResult!.root

/** 读取实际 CSS 的宽度分支，验证布局契约；不模拟浏览器尺寸、焦点或渲染。 */
function readLayout(
  styles: typeof topBarStyles,
  selectors: readonly string[],
  viewportWidth: number,
  containerWidth: number | Readonly<Record<string, number>> = viewportWidth,
  reducedMotion = false,
): Record<string, string> {
  const declarations: Record<string, string> = {}
  styles.walkRules((rule) => {
    // Sass 规范化字符串引号，SFC CSS 保留原引号；这里只比较相同的选择器与布局值。
    if (!rule.selectors.some((selector) => selectors.includes(selector.replace(/"/g, "'")))) return
    let parent: typeof rule.parent | typeof styles.parent = rule.parent
    while (parent) {
      if (parent.type === 'atrule' && (parent.name === 'media' || parent.name === 'container')) {
        if (parent.params.includes('(prefers-reduced-motion: reduce)') && !reducedMotion) return
        const width =
          parent.name === 'media'
            ? viewportWidth
            : typeof containerWidth === 'number'
              ? containerWidth
              : containerWidth[parent.params.split(' ')[0]!]
        if (width === undefined) return
        for (const [, bound, value] of parent.params.matchAll(
          /\((max|min)-width:\s*([\d.]+)px\)/g,
        )) {
          if (bound === 'max' ? width > Number(value) : width < Number(value)) return
        }
      }
      parent = parent.parent
    }
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value.replace(/\s+/g, ' ').replace(/"/g, "'")
    })
  })
  return declarations
}

describe('Classic shell and current page layout integration', () => {
  it('keeps download and playlist motion surfaces composited through dragging and landing', () => {
    expect(
      readLayout(downloadRowStyles, ['.download-track__surface--moving'], 1200)['will-change'],
    ).toBe('transform')
    expect(readLayout(playlistTileStyles, ['.playlist-tile--moving'], 1200)['will-change']).toBe(
      'transform',
    )
    expect(
      readLayout(downloadRowStyles, ['.download-track__surface--moving :deep(.track-card)'], 1200)[
        'content-visibility'
      ],
    ).toBe('visible')
    for (const [styles, selector] of [
      [downloadRowStyles, '.download-track__surface'],
      [playlistTileStyles, '.playlist-tile'],
    ] as const) {
      expect(readLayout(styles, [selector], 1200).transition).toContain(
        'transform var(--am-motion-normal)',
      )
      expect(readLayout(styles, [selector], 1200, 1200, true).transition).toBe('none')
    }
  })
  it('matches collection removal colors to the music-list delete action', () => {
    const removal = readLayout(
      trackOperatorStyles,
      ['.catalog-actions :deep(button.catalog-actions__remove)'],
      1200,
    )
    const deletion = readLayout(
      listOperatorStyles,
      ['.catalog-list-actions button.catalog-list-actions__remove'],
      1200,
    )
    for (const property of ['color', 'background', 'border-color']) {
      expect(removal[property]).toBe(deletion[property])
    }
    expect(removal.color).toBe('var(--am-color-danger)')
  })
  it.each([320, 390, 600, 768, 1440])(
    'keeps queue padding aligned and bounds horizontal overflow at %ipx',
    (width) => {
      const queue = readLayout(queueStyles, ['.listen-queue'], width)
      expect(queue['inline-size']).toBe('100%')
      expect(queue['min-inline-size']).toBe('0')
      expect(queue['overflow-x']).toBe('clip')
      expect(queue.background).toBe('var(--am-color-background)')
      const surface = readLayout(queueStyles, ['.listen-queue__surface'], width)
      expect(surface.background).toBe('var(--am-color-surface-subtle)')
      expect(surface.padding).toBe('var(--am-space-4) var(--am-space-3)')
      expect(surface['inline-size']).toBe('100%')
      expect(surface.padding).toBe(
        readLayout(catalogListStyles, ['.catalog-drawers'], width).padding,
      )
      expect(
        readLayout(sharedStyles, ['.product-view[data-active-view=queue]'], width).padding,
      ).toBe('0')
      expect(
        readLayout(sharedStyles, ['.product-view[data-active-view=favorites]'], width).padding,
      ).toBe('0')
      expect(
        readLayout(sharedStyles, ['.product-view[data-active-view=downloads]'], width).padding,
      ).toBe('0')
      expect(readLayout(trackListStyles, ['.list'], width).padding).toBe('0')
      const controls = readLayout(queueViewStyles, ['.queue-view-controls'], width)
      expect(controls['max-inline-size']).toBe('100%')
      expect(controls.position).toBe('sticky')
      expect(controls['grid-template-columns']).toBe('minmax(0, 1fr) auto')
      expect(
        readLayout(queueViewStyles, ['.queue-view-controls__arrangement'], width)['justify-self'],
      ).toBe('start')
      expect(readLayout(queueViewStyles, ['.queue-view-controls__segments'], width).padding).toBe(
        'var(--am-space-1)',
      )
      expect(readLayout(queueViewStyles, ['.queue-view-controls__segments'], width).display).toBe(
        width <= 760 ? 'grid' : 'flex',
      )
      const cover = readLayout(queueRowStyles, ['.queue-track__cover-control'], width)
      expect(cover.background).toBe('transparent')
      expect(cover['inline-size']).toBe('100%')
      expect(cover['block-size']).toBe('100%')
      expect(cover['touch-action']).toBeUndefined()
      expect(
        readLayout(queueRowStyles, ['.queue-track .queue-track__surface .track__actions'], width)[
          'padding-inline-start'
        ],
      ).toBeUndefined()
    },
  )
  it.each([320, 600, 1440])(
    'uses the incoming collection height throughout forward and back transitions at %ipx',
    (width) => {
      for (const styles of [queueStyles, sharedStyles]) {
        for (const reducedMotion of [false, true]) {
          const results = readLayout(
            styles,
            ['.listen-queue__results'],
            width,
            width,
            reducedMotion,
          )
          expect(results.display).toBe('grid')
          expect(results.position).toBe('relative')
          expect(readLayout(styles, ['.listen-queue__content'], width).position).toBe('relative')
          expect(results['grid-template-columns']).toBe('minmax(0, 1fr)')
          expect(
            readLayout(
              styles,
              ['.listen-queue__results', '.listen-queue--empty .listen-queue__results'],
              width,
            ).display,
          ).toBe('grid')
          for (const direction of ['forward', 'back']) {
            for (const phase of ['enter', 'leave']) {
              const list = readLayout(
                styles,
                ['.listen-queue__list', `.queue-view-${direction}-${phase}-active`],
                width,
                width,
                reducedMotion,
              )
              expect(list['grid-area']?.replace(/\s/g, '')).toBe('1/1')
              if (phase === 'leave') {
                expect(list.position).toBe('absolute')
                expect(list.inset).toBe('0')
                expect(list.overflow).toBe('clip')
              } else {
                expect(list.position).not.toBe('absolute')
              }
              expect(list.display).not.toBe('none')
              if (reducedMotion) expect(list.transition).toBe('none')
            }
          }
        }
      }
    },
  )
  it('keeps desktop list states and discovery in one sticky row, and pins the compact mobile header', () => {
    const desktop = readLayout(catalogListHeaderStyles, ['.catalog-drawers__state-toolbar'], 1440)
    expect(desktop.position).toBe('sticky')
    expect(desktop['grid-template-columns']).toBe('minmax(0, 1fr) auto')
    expect(
      readLayout(catalogListHeaderStyles, ['.catalog-drawers__title-actions'], 1440)['grid-column'],
    ).toBe('2')
    for (const width of [768, 390, 320]) {
      const mobile = readLayout(catalogListHeaderStyles, ['.catalog-drawers__header'], width)
      expect(mobile.position).toBe('sticky')
      expect(mobile['grid-template-areas']).toBe("'intro actions' 'states states'")
      expect(
        readLayout(catalogListHeaderStyles, ['.catalog-drawers__description'], width).display,
      ).toBe('none')
    }
    expect(
      readLayout(catalogListHeaderStyles, ['.catalog-drawers__state-options > button'], 390)[
        'white-space'
      ],
    ).toBe('nowrap')
    expect(
      readLayout(operatorActionStyles, ['.catalog-operator-actions__content'], 390)['inline-size'],
    ).toBe('max-content')
  })

  it.each([480, 300])('aligns all list-details groups in a %ipx dialog', (width) => {
    for (const selector of [
      '.catalog-list-details__summary',
      '.catalog-list-details__account',
      '.catalog-list-details__request',
    ]) {
      expect(
        readLayout(catalogDetailsStyles, [selector], 390, { 'am-dialog': width })[
          'grid-template-columns'
        ],
      ).toBe(width <= 340 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))')
    }
    expect(
      readLayout(catalogDetailsStyles, ['.catalog-list-details__progress'], 390)['grid-column'],
    ).toBe('1 / -1')
  })
  it('limits side-dependent CSS to the system shell and mobile navigation trigger', () => {
    for (const styles of [preferencesStyles, operatorStyles, sharedStyles]) {
      styles.walkRules((rule) => {
        expect(rule.selector).not.toMatch(/data-(?:sidebar-side|side|mobile-artwork-side)/)
      })
    }
    topBarStyles.walkRules((rule) => {
      if (rule.selector.includes('data-sidebar-side')) {
        expect(rule.selector).toContain("[data-mobile-layout='true']")
      }
    })
  })

  it.each([1600, 900, 768, 700, 600, 390, 320])(
    'aligns the mobile trigger with its drawer at %ipx',
    (width) => {
      const isMobile = width <= 768
      for (const side of ['left', 'right']) {
        for (const hasSource of [false, true]) {
          const selectors = ['.product-top-bar']
          const mobileSelector = ".product-top-bar[data-mobile-layout='true']"
          const rightSelector = `${mobileSelector}[data-sidebar-side='right']`
          if (isMobile) selectors.push(mobileSelector)
          if (isMobile && side === 'right') selectors.push(rightSelector)
          if (!hasSource) {
            const withoutSource = '.product-top-bar--without-source'
            selectors.push(withoutSource)
            if (isMobile) selectors.push(`${withoutSource}[data-mobile-layout='true']`)
            if (isMobile && side === 'right') {
              selectors.push(
                `${withoutSource}[data-mobile-layout='true'][data-sidebar-side='right']`,
              )
            }
          }
          const layout = readLayout(topBarStyles, selectors, width)
          const contentAreas = hasSource ? 'copy source' : 'copy'
          expect(layout['grid-template-areas']).toBe(
            isMobile
              ? side === 'right'
                ? `'${contentAreas} menu'`
                : `'menu ${contentAreas}'`
              : `'${contentAreas} actions'`,
          )
          const contentColumns = hasSource ? 'minmax(0, 1fr) minmax(0, auto)' : 'minmax(0, 1fr)'
          expect(layout['grid-template-columns']).toBe(
            isMobile
              ? side === 'right'
                ? `${contentColumns} 40px`
                : `40px ${contentColumns}`
              : !hasSource
                ? 'minmax(0, 1fr) auto'
                : width > 960
                  ? 'minmax(0, 1fr) minmax(160px, 240px) auto'
                  : 'minmax(0, 1fr) minmax(0, 180px) auto',
          )
        }
      }
      expect(
        readLayout(topBarStyles, ['.product-top-bar__copy'], width)['text-align'],
      ).toBeUndefined()
      expect(readLayout(topBarStyles, ['.product-top-bar__source'], width).display).toBe('flex')
    },
  )

  it.each([
    [1384, 1286],
    [1384, 1110],
    [1024, 926],
    [1024, 750],
    [900, 626],
    [1384, 480],
  ])('adapts the desktop top bar at viewport %ipx and header %ipx', (viewport, header) => {
    const containers = { 'am-shell': viewport - 26, 'am-top-bar': header }
    const layout = readLayout(topBarStyles, ['.product-top-bar'], viewport, containers)
    expect(layout['grid-template-areas']).toBe(
      header <= 720 ? "'copy copy' 'source actions'" : "'copy source actions'",
    )
    expect(
      readLayout(topBarStyles, ['.product-top-bar__actions'], viewport, containers).display,
    ).toBe('flex')
  })

  it.each([2200, 1600, 1286, 1110, 750, 600, 480])(
    'lets the music-list grid allocate columns without a fixed limit (%ipx)',
    (list) => {
      const containers = { 'am-catalog-list': list }
      const grid = readLayout(catalogListStyles, ['.catalog-drawers__grid'], 1384, containers)
      expect(grid['grid-template-columns']).toBe('repeat(auto-fill, minmax(min(100%, 300px), 1fr))')
    },
  )

  it('keeps the music-list surface as wide as the song page on an ultrawide display', () => {
    expect(
      readLayout(sharedStyles, ['.catalog-page--lists > .catalog-drawers'], 1920)['inline-size'],
    ).toBe('100%')
    expect(
      readLayout(catalogListStyles, ['.catalog-drawers__grid'], 1920, {
        'am-catalog-list': 1568,
      })['grid-template-columns'],
    ).toBe('repeat(auto-fill, minmax(min(100%, 300px), 1fr))')
  })

  it('shrinks only card internals when sidebar expansion narrows a column', () => {
    const collapsed = { 'am-catalog-list': 1180, 'am-catalog-card': 382 }
    const expanded = { 'am-catalog-list': 1004, 'am-catalog-card': 324 }
    expect(readLayout(catalogCardStyles, ['.catalog-card__actions'], 1384, collapsed).display).toBe(
      'flex',
    )
    expect(readLayout(catalogCardStyles, ['.catalog-card__actions'], 1384, expanded).display).toBe(
      'grid',
    )
    expect(
      readLayout(catalogListStyles, ['.catalog-drawers'], 1384, expanded)['grid-template-columns'],
    ).toBe('minmax(0, 1fr)')
  })

  it('animates desktop sidebar space, respects reduced motion and remembers offscreen sizes', () => {
    const shell = ['.music-app-shell', '.music-app-shell--sidebar-transition']
    expect(readLayout(shellStyles, shell, 1384).transition).toBe(
      'grid-template-columns var(--am-motion-normal) var(--am-ease-emphasized)',
    )
    expect(readLayout(shellStyles, shell, 1384, 1384, true).transition).toBe('none')
    expect(readLayout(shellStyles, shell, 768).transition).toBe('none')
    expect(readLayout(shellStyles, ['.music-app-shell__header'], 1384).container).toBe(
      'am-top-bar / inline-size',
    )
    expect(readLayout(shellStyles, ['.music-app-shell__content'], 1384).container).toBe(
      'am-content / inline-size',
    )
    const card = readLayout(catalogCardStyles, ['.catalog-card'], 1384)
    expect(card['content-visibility']).toBe('auto')
    expect(card['contain-intrinsic-block-size']).toBe('auto 280px')
    expect(
      readLayout(catalogListStyles, ['.catalog-drawers__cell'], 1384)['content-visibility'],
    ).toBeUndefined()
    expect(
      readLayout(sharedStyles, ['.list .track-card'], 1384)['contain-intrinsic-block-size'],
    ).toBe('auto 320px')
    expect(
      readLayout(
        sharedStyles,
        ['.list .track-card', ".list__items[data-mobile-columns='1'] .track-card"],
        390,
      )['contain-intrinsic-block-size'],
    ).toBe('auto 140px')
  })

  it.each([
    [1200, 950],
    [1200, 720],
    [768, 768],
    [440, 440],
    [390, 390],
    [320, 320],
  ])('keeps track action buttons compact at viewport %ipx and panel %ipx', (viewport, panel) => {
    const button = readLayout(
      trackOperatorStyles,
      [
        '.catalog-actions :deep(.catalog-operator-actions__content button)',
        '.catalog-actions__buttons :deep(.catalog-operator-actions__content button)',
      ],
      viewport,
      panel,
    )
    expect(button['block-size']).toBe('44px')
    expect(button['align-self']).toBe('center')
    const actions = readLayout(trackOperatorStyles, ['.catalog-actions__buttons'], viewport, panel)
    expect(
      readLayout(operatorActionStyles, ['.catalog-operator-actions'], viewport, panel).display,
    ).toBe('grid')
    expect(actions['block-size']).toBeUndefined()
    expect(
      readLayout(trackOperatorStyles, ['.catalog-actions__manage'], viewport, panel)[
        'justify-content'
      ],
    ).toBe('flex-end')
    expect(
      readLayout(listOperatorStyles, ['.catalog-list-actions__manage'], viewport, panel)[
        'justify-content'
      ],
    ).toBe('flex-end')
    expect(
      readLayout(listOperatorStyles, ['.catalog-list-actions__buttons'], viewport, panel)[
        'min-inline-size'
      ],
    ).toBe('0')
    expect(
      readLayout(listOperatorStyles, ['.catalog-list-actions'], viewport, panel)[
        'grid-template-rows'
      ],
    ).toBe('repeat(2, 44px)')
    if (panel <= 768) {
      expect(button['min-inline-size']).toBe('112px')
      expect(
        readLayout(trackOperatorStyles, ['.catalog-actions'], viewport, panel)[
          'grid-template-rows'
        ],
      ).toBe('repeat(2, 44px)')
    }
    expect(
      readLayout(trackOperatorStyles, ['.catalog-actions__manage'], viewport, panel)[
        'padding-inline-start'
      ],
    ).toBe('52px')
    const close = readLayout(
      operatorStyles,
      ['.side-panel__header', '.side-panel__surface--stacked-actions .side-panel__header'],
      viewport,
      panel,
    )
    expect(close['inset-block-start']).toBe('calc(50% - 48px)')
    expect(close.transform).toBe('none')
    expect(
      readLayout(operatorActionStyles, ['.catalog-operator-actions--overflow'], viewport, panel)[
        'grid-template-columns'
      ],
    ).toBe('minmax(0, 1fr) 44px')
    const contentSelector = '.catalog-operator-actions__content'
    const endSelector = `.catalog-operator-actions--end ${contentSelector}`
    const overflowSelector = `.catalog-operator-actions--overflow ${contentSelector}`
    const content = readLayout(operatorActionStyles, [contentSelector], viewport, panel)
    expect(content['justify-content']).toBe('center')
    expect(content.gap).toBe('var(--am-space-3)')
    expect(
      readLayout(operatorActionStyles, [contentSelector, endSelector], viewport, panel)[
        'justify-content'
      ],
    ).toBe('flex-end')
    expect(
      readLayout(
        operatorActionStyles,
        [contentSelector, endSelector, overflowSelector],
        viewport,
        panel,
      )['justify-content'],
    ).toBe('flex-start')
  })

  it.each([320, 390, 480, 600, 768])(
    'keeps the mobile account label visible at %ipx while allowing truncation beside refresh',
    (width) => {
      const label = readLayout(
        sessionStyles,
        ['.session--compact .session__label', '.session--heading .session__label'],
        width,
      )
      expect(label['min-inline-size']).toBe('0')
      expect(label['font-size']).toBe('var(--am-font-size-md)')
      const truncation = readLayout(sharedStyles, ['.session__label'], width, {
        'am-workbench': width,
        'am-catalog-list': width - 32,
      })
      expect(truncation.display).not.toBe('none')
      expect(truncation['text-overflow']).toBe('ellipsis')
      expect(truncation['white-space']).toBe('nowrap')
    },
  )

  it.each([
    [5120, 4846],
    [3840, 3566],
    [3697, 3697],
    [3696, 3696],
    [3697, 2047],
    [3696, 2046],
    [2560, 2300],
    [2046, 1760],
    [1600, 1500],
    [1440, 1000],
    [900, 600],
    [600, 600],
    [390, 390],
  ])(
    'keeps context above the sticky back/actions row at viewport %ipx and content %ipx',
    (viewport, content) => {
      expect(
        readLayout(sharedStyles, ['.catalog-page__heading'], viewport, content)[
          'grid-template-areas'
        ],
      ).toBe("'context context' 'back actions'")
      expect(
        readLayout(sharedStyles, ['.catalog-page__back'], viewport, content)['justify-self'],
      ).toBe('start')
      expect(
        readLayout(sharedStyles, ['.catalog-page__actions'], viewport, content)['justify-content'],
      ).toBe('flex-end')
      expect(
        readLayout(sharedStyles, ['.catalog-page__context-title'], viewport, content)[
          'grid-column'
        ],
      ).toBe('1')
      expect(
        readLayout(sharedStyles, ['.catalog-page__context-summary'], viewport, content)[
          'grid-column'
        ],
      ).toBe('2')
      expect(
        readLayout(sharedStyles, ['.catalog-page__back-label'], viewport, content).display,
      ).toBe(content <= 600 ? 'none' : undefined)
    },
  )

  it.each([1600, 600, 390, 320])(
    'keeps the collapse handle on the bottom edge without taking action space at %ipx',
    (width) => {
      const layout = readLayout(
        sharedStyles,
        ['.catalog-page__heading', '.catalog-page__heading--collapsed'],
        width,
        { 'am-catalog-heading': width },
      )
      expect(layout['grid-template-areas']).toBe("'back actions'")
      expect(layout['grid-template-columns']).toBe('auto minmax(0, 1fr)')
      const handle = readLayout(
        catalogHeadingHandleStyles,
        ['.catalog-page__heading .catalog-page__collapse-handle'],
        width,
      )
      expect(handle.position).toBe('absolute')
      expect(handle['inset-inline-start']).toBe('50%')
      expect(handle['inset-block-end']).toBe('-12px')
      expect(
        readLayout(catalogHeadingHandleStyles, ['.catalog-page__collapse-mark'], width).visibility,
      ).toBe(width <= 768 ? 'hidden' : undefined)
    },
  )

  it('queries the sticky header independently of the list and player widths', () => {
    const containers = { 'am-workbench': 1110, 'am-catalog-heading': 580, 'am-player': 1110 }
    expect(readLayout(sharedStyles, ['.catalog-page__back-label'], 1384, containers).display).toBe(
      'none',
    )
    expect(
      readLayout(sharedStyles, ['.catalog-page__context'], 1384, containers)[
        'grid-template-columns'
      ],
    ).toBe('minmax(0, 0.42fr) minmax(0, 1fr)')
    expect(readLayout(sharedStyles, ['.catalog-operator-launcher'], 1384, containers).display).toBe(
      'flex',
    )
  })

  it('shows grab cursors in heading drag areas without disabling text selection or callouts', () => {
    const mobileSelectors = [
      '.catalog-page__heading',
      '.catalog-page__heading[data-mobile-layout=true]',
    ]
    const mobile = readLayout(sharedStyles, mobileSelectors, 390)
    expect(mobile.cursor).toBe('grab')
    expect(mobile['touch-action']).toBe('pan-x')
    expect(mobile['user-select']).toBeUndefined()
    expect(mobile['-webkit-user-select']).toBeUndefined()
    expect(mobile['-webkit-touch-callout']).toBeUndefined()
    expect(
      readLayout(sharedStyles, [...mobileSelectors, '.catalog-page__heading:active'], 390).cursor,
    ).toBe('grabbing')
    expect(readLayout(sharedStyles, ['.catalog-page__heading button'], 390).cursor).toBe('pointer')
    const desktop = readLayout(sharedStyles, ['.catalog-page__heading'], 1600)
    expect(desktop.cursor).toBe('grab')
    expect(desktop['user-select']).toBeUndefined()
    expect(desktop['-webkit-touch-callout']).toBeUndefined()
  })

  it('keeps the collapse target inside heading padding when an error notice follows it', () => {
    const handle = readLayout(
      catalogHeadingHandleStyles,
      [
        '.catalog-page__heading .catalog-page__collapse-handle',
        '.catalog-page__heading:has(+ .catalog-drawer__message) .catalog-page__collapse-handle',
      ],
      390,
    )
    expect(handle['inset-block-end']).toBe('0')
    expect(handle['block-size']).toBe('8px')
  })

  it.each([1, 2])(
    'keeps mobile selection at the lower right and statistics at the lower left in %i columns',
    (columns) => {
      const selector = `.list__items[data-mobile-columns='${columns}']`
      const selection = readLayout(sharedStyles, [`${selector} .track__select`], 390)
      expect(selection['inset-inline-start']).toBe('auto')
      expect(selection['inset-inline-end']).toBe('var(--am-space-3)')
      expect(selection['inset-block-start']).toBe('auto')
      expect(selection['inset-block-end']).toBe('var(--am-space-3)')
      expect(selection['justify-content']).toBe('center')
      const statistics = readLayout(sharedStyles, [`${selector} .track__statistics`], 390)
      expect(statistics['inset-inline-start']).toBe('var(--am-space-1)')
      expect(statistics['inset-inline-end']).toBe('auto')
      if (columns === 1) {
        expect(
          readLayout(sharedStyles, [`${selector} .track-card-summary`], 390)[
            'grid-template-columns'
          ],
        ).toBe('minmax(0, 1fr) 104px')
        expect(
          readLayout(sharedStyles, [`${selector} .track-card-summary`], 390)['grid-template-areas'],
        ).toBe("'body media'")
        expect(
          readLayout(sharedStyles, [`${selector} .track-card-summary__media`], 390)['grid-area'],
        ).toBe('media')
        expect(
          readLayout(sharedStyles, [`${selector} .track-card-summary__body`], 390)['grid-area'],
        ).toBe('body')
      }
    },
  )

  it('keeps operator close controls and preference toggles in fixed positions', () => {
    expect(readLayout(operatorStyles, ['.side-panel__surface'], 1440)['grid-template-areas']).toBe(
      "'header content'",
    )
    expect(readLayout(operatorStyles, ['.side-panel__surface'], 1440)['padding-inline']).toBe(
      'var(--am-space-5)',
    )
    expect(
      readLayout(operatorStyles, ['.side-panel__header'], 1440)['border-inline-end'],
    ).toBeUndefined()
    expect(readLayout(operatorStyles, ['.side-panel__header'], 390)['inset-inline-start']).toBe(
      'var(--am-space-3)',
    )
    expect(
      readLayout(operatorStyles, ['.side-panel'], 390)['--am-operator-close-inset-start'],
    ).toBe('52px')
    expect(readLayout(operatorStyles, ['.side-panel__header'], 390)['inset-block-start']).toBe(
      '50%',
    )
    expect(readLayout(operatorStyles, ['.side-panel__header'], 390).transform).toBe(
      'translateY(-50%)',
    )
    expect(readLayout(operatorStyles, ['.side-panel__content'], 390)['align-content']).toBe(
      'center',
    )
    expect(readLayout(operatorStyles, ['.side-panel__content'], 390)['padding-inline-start']).toBe(
      'calc(var(--am-space-3) + var(--am-operator-close-inset-start))',
    )
    expect(
      readLayout(preferencesStyles, ['.shell-preferences__toggle-button'], 390)['grid-column'],
    ).toBe('1')
    expect(
      readLayout(preferencesStyles, ['.shell-preferences__toggle-copy'], 390)['grid-column'],
    ).toBe('2')
  })

  it('still moves the desktop sidebar and mobile drawer to the selected side', () => {
    const rightRoot = ".music-app-shell[data-sidebar-side='right']"
    const left = readLayout(shellStyles, ['.music-app-shell'], 1440)
    const right = readLayout(shellStyles, ['.music-app-shell', rightRoot], 1440)
    expect(left['grid-template']).toContain("'sidebar content'")
    expect(right['grid-template']).toContain("'content sidebar'")
    const drawerSelector = '.music-app-shell__sidebar'
    const leftDrawer = readLayout(shellStyles, [drawerSelector], 390)
    const rightDrawer = readLayout(
      shellStyles,
      [drawerSelector, `${rightRoot} ${drawerSelector}`],
      390,
    )
    expect(leftDrawer.transform).toBe('translateX(-100%)')
    expect(rightDrawer.transform).toBe('translateX(100%)')
    expect(rightDrawer['inset-inline']).toBe('auto 0')
  })

  it.each(['left', 'right'] as const)(
    'hides the %s drawer immediately at the mobile breakpoint and animates only drawer toggles',
    (side) => {
      const sidebar = '.music-app-shell__sidebar'
      const selectors = [sidebar, `.music-app-shell[data-sidebar-side='${side}'] ${sidebar}`]
      for (const width of [768, 767, 390]) {
        const hidden = readLayout(shellStyles, selectors, width)
        expect(hidden.visibility).toBe('hidden')
        expect(hidden.opacity).toBe('0')
        expect(hidden['pointer-events']).toBe('none')
        expect(hidden.transition).toBe('none')
      }
      const animated = [...selectors, `.music-app-shell--mobile-drawer-transition ${sidebar}`]
      const closing = readLayout(shellStyles, animated, 390)
      expect(closing.transition).toContain('transform var(--am-motion-slow)')
      expect(closing.transition).toContain('visibility 0s linear var(--am-motion-slow)')
      const open = readLayout(
        shellStyles,
        [...animated, `.music-app-shell.music-app-shell--mobile-drawer-open ${sidebar}`],
        390,
      )
      expect(open.visibility).toBe('visible')
      expect(open.opacity).toBe('1')
      expect(open.transform).toBe('translateX(0)')
      expect(open['transition-delay']).toBe('0s')
      expect(readLayout(shellStyles, animated, 390, 390, true).transition).toBe('none')
      expect(readLayout(shellStyles, animated, 769).transition).toBeUndefined()
    },
  )
})
