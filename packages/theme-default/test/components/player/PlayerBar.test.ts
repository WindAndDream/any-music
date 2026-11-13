import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { compile } from 'sass'
import { describe, expect, it } from 'vitest'
import { compileStyle, parse } from 'vue/compiler-sfc'

function compileSfcStyles(path: URL) {
  const { descriptor } = parse(readFileSync(path, 'utf8'))
  const source = descriptor.styles.map((style) => style.content).join('\n')
  return compileStyle({ source, filename: fileURLToPath(path), id: 'player-layout' }).rawResult!
    .root
}

// 合并真实共享样式与消费端 SFC，捕捉“组件测试通过，但旧全局列定义仍被继承”的回归。
const sharedStyles = compileStyle({
  source: compile(fileURLToPath(new URL('../../../../ui/src/styles/index.scss', import.meta.url)))
    .css,
  filename: 'shared-player-styles.css',
  id: 'shared-player-layout',
}).rawResult!.root
const playerStyles = compileSfcStyles(
  new URL('../../../src/components/player/PlayerBar.vue', import.meta.url),
)
const pagerStyles = compileSfcStyles(
  new URL('../../../../ui/src/components/music-sources/PlayerControlPager.vue', import.meta.url),
)
const actionStyles = compileSfcStyles(
  new URL('../../../src/components/player/PlayerControlActions.vue', import.meta.url),
)

interface LayoutContext {
  viewportWidth: number
  playerWidth: number
}

/** 只读取本次布局契约涉及的选择器与宽度条件，不模拟浏览器渲染或像素尺寸。 */
function readLayoutDeclarations(
  styles: typeof playerStyles | (typeof playerStyles)[],
  selectors: readonly string[],
  context: LayoutContext,
): Record<string, string> {
  const declarations: Record<string, string> = {}
  const priorities: Record<string, number> = {}
  for (const sheet of Array.isArray(styles) ? styles : [styles]) {
    sheet.walkRules((rule) => {
      const matchingSelectors = rule.selectors.filter((selector) => selectors.includes(selector))
      if (!matchingSelectors.length) return
      // 本测试选中的规则只使用类选择器；相同优先级才由资源顺序决定。
      const priority = Math.max(
        ...matchingSelectors.map((selector) => (selector.match(/\.[\w-]+/g) ?? []).length),
      )
      let parent: typeof rule.parent | typeof sheet.parent = rule.parent
      while (parent) {
        if (parent.type === 'atrule' && (parent.name === 'media' || parent.name === 'container')) {
          const width = parent.name === 'container' ? context.playerWidth : context.viewportWidth
          const conditions = parent.params.matchAll(/\((max|min)-width:\s*([\d.]+)px\)/g)
          for (const [, bound, value] of conditions) {
            if (bound === 'max' ? width > Number(value) : width < Number(value)) return
          }
        }
        parent = parent.parent
      }
      rule.walkDecls((declaration) => {
        if ((priorities[declaration.prop] ?? -1) > priority) return
        priorities[declaration.prop] = priority
        declarations[declaration.prop] = declaration.value.replace(/\s+/g, ' ')
      })
    })
  }
  return declarations
}

describe('PlayerBar layout contract', () => {
  it.each([320, 390, 576, 1200])(
    '操作区 %ipx 的按钮排列不受父子组件样式资源加载顺序影响',
    (width) => {
      const context = { viewportWidth: width, playerWidth: width }
      for (const styles of [
        [playerStyles, actionStyles],
        [actionStyles, playerStyles],
      ]) {
        const layout = readLayoutDeclarations(
          styles,
          ['.player-actions', '.player__mobile-actions', '.player .player__mobile-actions'],
          context,
        )
        expect(layout['justify-content']).toBe(width <= 576 ? 'space-around' : 'flex-end')
        // 详情层通过 Teleport 离开 .player，操作类与子组件根类位于同一元素。
        const detailLayout = readLayoutDeclarations(
          styles,
          [
            '.player-actions',
            '.player__now-playing-actions',
            '.player__now-playing .player__now-playing-actions',
          ],
          context,
        )
        expect(detailLayout['justify-content']).toBe(width <= 576 ? 'center' : 'flex-end')
      }
    },
  )

  it.each([320, 390])('手机 %ipx 的详情页在顶部保留下拉收起，滚动后恢复双向原生滚动', (width) => {
    const context = { viewportWidth: width, playerWidth: width }
    const panel = readLayoutDeclarations(playerStyles, ['.player__now-playing'], context)

    // pan-down 按滚动方向命名：允许手指上划浏览内容，下划留给播放器拖动。
    expect(panel['touch-action']).toBe('pan-down')
    expect(panel['overflow-y']).toBe('auto')
    const scrolledPanel = readLayoutDeclarations(
      playerStyles,
      ['.player__now-playing', '.player__now-playing--scrolled'],
      context,
    )
    expect(scrolledPanel['touch-action']).toBe('pan-y')
  })

  it('宽屏覆盖旧共享列定义，让两侧等宽并把播放区对齐整栏中心', () => {
    const context = { viewportWidth: 1440, playerWidth: 1200 }
    const layout = {
      ...readLayoutDeclarations(sharedStyles, ['.player'], context),
      ...readLayoutDeclarations(playerStyles, ['.player'], context),
    }

    expect(layout['grid-template-columns']).toBe(
      'minmax(0, 1fr) minmax(260px, 1.5fr) minmax(0, 1fr)',
    )
    expect(layout.gap).toBe('var(--am-space-4)')
    const transportLayout = readLayoutDeclarations(playerStyles, ['.player__transport'], context)
    expect(transportLayout['justify-self']).toBe('center')
    expect(transportLayout['inline-size']).toBe('100%')
    // 三层中性包装都必须透传布局，否则全部控制会再被塞进第一列。
    for (const selector of ['.player-control-pager', '.player-control-pager__playback']) {
      expect(readLayoutDeclarations(pagerStyles, [selector], context).display).toBe('contents')
    }
    expect(readLayoutDeclarations(playerStyles, ['.player__playback-page'], context).display).toBe(
      'contents',
    )
  })

  it.each([
    [1440, 960, "'track extras' auto 'transport transport' auto / minmax(0, 1fr) auto"],
    [1000, 700, "'track extras' auto 'transport transport' auto / minmax(0, 1fr) auto"],
    [900, 480, "'track' auto 'transport' auto 'extras' auto / minmax(0, 1fr)"],
  ])('桌面视口 %ipx、播放器 %ipx 沿用原容器布局', (viewportWidth, playerWidth, template) => {
    const context = { viewportWidth, playerWidth }
    expect(readLayoutDeclarations(playerStyles, ['.player'], context)['grid-template']).toBe(
      template,
    )
    expect(
      readLayoutDeclarations(playerStyles, ['.player__transport'], context)['justify-self'],
    ).toBe('center')
    expect(readLayoutDeclarations(playerStyles, ['.player__playback-page'], context).display).toBe(
      'contents',
    )
  })

  it('只有手机把分页器变为单列控制栏内的滑动视口，并调整按钮形状', () => {
    const context = { viewportWidth: 390, playerWidth: 390 }
    expect(readLayoutDeclarations(playerStyles, ['.player'], context)['grid-template']).toBe(
      'auto / minmax(0, 1fr)',
    )
    expect(readLayoutDeclarations(playerStyles, ['.player__playback-page'], context).display).toBe(
      'grid',
    )
    const pagerLayout = readLayoutDeclarations(
      pagerStyles,
      ['.player-control-pager', '.player-control-pager--mobile'],
      context,
    )
    expect(pagerLayout.display).toBe('grid')
    expect(pagerLayout.overflow).toBe('clip')
    // 等宽两侧让移动播放组始终对齐整栏中心，曲名长短不推动播放组。
    expect(
      readLayoutDeclarations(playerStyles, ['.player__playback-page'], context)['grid-template'],
    ).toBe("'track transport spare' auto / minmax(0, 1fr) auto minmax(0, 1fr)")
    const transportLayout = readLayoutDeclarations(playerStyles, ['.player__transport'], context)
    expect(transportLayout['inline-size']).toBe('auto')
    expect(transportLayout['max-inline-size']).toBe('none')
    expect(transportLayout['justify-self']).toBe('center')
    expect(transportLayout['align-items']).toBe('center')
    expect(
      readLayoutDeclarations(actionStyles, ['.player-actions__button'], context)['border-radius'],
    ).toBe('var(--am-radius-md)')
    expect(
      readLayoutDeclarations(actionStyles, ['.player-actions__button'], {
        viewportWidth: 1200,
        playerWidth: 960,
      })['border-radius'],
    ).toBe('var(--am-radius-pill)')
  })
})
