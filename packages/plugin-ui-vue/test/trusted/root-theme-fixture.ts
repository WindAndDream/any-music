import { UI_THEME_REQUIRED_VIEWS } from '@any-music/ui/theme'
import type { UiThemeDefinition, UiThemeRootProps, UiThemeViews } from '@any-music/ui/theme'
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import type {
  LoadedRootTheme,
  ThemeApplicationComposition,
} from '../../src/trusted/theme-contracts'
import { BUILT_IN_UI_THEMES } from '../../src/trusted/theme-directory'

const View = defineComponent({
  props: { feature: { type: Object, required: true } },
  render: () => h('section'),
})
export const rootProps = {
  features: { type: Object as PropType<UiThemeRootProps['features']>, required: true as const },
  views: { type: Object as PropType<UiThemeRootProps['views']>, required: true as const },
  form: { type: String as PropType<UiThemeRootProps['form']>, required: true as const },
}
export function rootTheme(id: string): LoadedRootTheme {
  const Root = defineComponent({
    props: rootProps,
    setup(props) {
      return () =>
        h(id === 'default' ? 'main' : 'article', { 'data-test-theme': id }, [
          h('button', { onClick: () => props.features.catalog.actions.submit() }, 'Search'),
        ])
    },
  })
  return {
    definition: {
      id,
      contractVersion: 1,
      Root,
      views: Object.fromEntries(
        UI_THEME_REQUIRED_VIEWS.map((key) => [key, View]),
      ) as unknown as UiThemeViews,
    } satisfies UiThemeDefinition,
    css: `button { color: ${id === 'default' ? 'red' : 'blue'}; }`,
  }
}
export function rootComposition(
  load: (id: string) => Promise<LoadedRootTheme> = async (id) => rootTheme(id),
  fallback = rootTheme('default'),
): ThemeApplicationComposition {
  return {
    themes: BUILT_IN_UI_THEMES.map((descriptor) => ({
      descriptor,
      load: () => load(descriptor.id),
    })),
    fallback: { descriptor: BUILT_IN_UI_THEMES[0]!, loaded: fallback },
  }
}
