import { defineComponent, h } from 'vue'
import type { PropType, SlotsType } from 'vue'

import type {
  UiThemeDefinition,
  UiThemeFeatureMap,
  UiThemeHostSlots,
  UiThemeRootProps,
  UiThemeViewId,
  UiThemeViews,
} from '../../../src/theme'

function view<Key extends UiThemeViewId>(id: Key) {
  return defineComponent({
    props: { feature: { type: Object as PropType<UiThemeFeatureMap[Key]>, required: true } },
    setup(props) {
      return () =>
        h(
          'section',
          { 'data-view': id, 'data-availability': props.feature.availability.status },
          props.feature.status.status,
        )
    },
  })
}
const CatalogView = defineComponent({
  props: { feature: { type: Object as PropType<UiThemeFeatureMap['catalog']>, required: true } },
  setup(props) {
    return () =>
      h('section', { 'data-view': 'catalog' }, [
        h('p', props.feature.state.searchQuery),
        h(
          'button',
          {
            onClick: () => props.feature.actions.submit(),
            disabled: props.feature.availability.status !== 'available',
          },
          'Search',
        ),
      ])
  },
})

/** Complete declaration, with no default-theme or product component imports. */
export const views = {
  shell: view('shell'),
  navigation: view('navigation'),
  player: view('player'),
  catalog: CatalogView,
  queue: view('queue'),
  favorites: view('favorites'),
  playlists: view('playlists'),
  'custom-tracks': view('custom-tracks'),
  history: view('history'),
  downloads: view('downloads'),
  plugins: view('plugins'),
  settings: view('settings'),
  overlays: view('overlays'),
  tags: view('tags'),
  composer: view('composer'),
} satisfies UiThemeViews

const rootProps = {
  features: { type: Object as PropType<UiThemeRootProps['features']>, required: true as const },
  views: { type: Object as PropType<UiThemeViews>, required: true as const },
  form: { type: String as PropType<UiThemeRootProps['form']>, required: true as const },
}
const RailRoot = defineComponent({
  props: rootProps,
  slots: Object as SlotsType<UiThemeHostSlots>,
  setup(props, { slots }) {
    return () =>
      h('main', { 'data-layout': 'rail' }, [
        h('aside', [h(props.views.navigation, { feature: props.features.navigation })]),
        h('article', [h(props.views.catalog, { feature: props.features.catalog })]),
        h('footer', [h(props.views.player, { feature: props.features.player })]),
        slots['source-identity']?.({ sourceId: props.features.catalog.state.sourceId }),
      ])
  },
})
const DeckRoot = defineComponent({
  props: rootProps,
  slots: Object as SlotsType<UiThemeHostSlots>,
  setup(props, { slots }) {
    return () =>
      h('main', { 'data-layout': 'deck' }, [
        h('header', [h(props.views.player, { feature: props.features.player })]),
        h('nav', [h(props.views.navigation, { feature: props.features.navigation })]),
        h('div', [h(props.views.catalog, { feature: props.features.catalog })]),
        slots['source-identity']?.({ sourceId: props.features.catalog.state.sourceId }),
      ])
  },
})
export const railTheme = {
  id: 'default',
  contractVersion: 1,
  Root: RailRoot,
  views,
} satisfies UiThemeDefinition
export const deckTheme = {
  id: 'studio',
  contractVersion: 1,
  Root: DeckRoot,
  views,
} satisfies UiThemeDefinition
