import { defineComponent, h, onMounted, onScopeDispose, shallowRef } from 'vue'
import type { PropType } from 'vue'

import { useMeasuredVirtualList } from '../../../src/virtual-scroll'
import type { FixedVirtualListItem } from '../../../src/virtual-scroll'

export interface MeasuredListFixtureItem {
  key: string
  title: string
  revision: number
}

const MeasuredListUnit = /* @__PURE__ */ defineComponent({
  props: {
    row: {
      type: Object as PropType<FixedVirtualListItem<MeasuredListFixtureItem>>,
      required: true,
    },
    count: { type: Number, required: true },
    observe: {
      type: Function as PropType<(key: string | number, element: HTMLElement) => () => void>,
      required: true,
    },
    measurementElement: Function as PropType<(key: string, node: HTMLElement) => HTMLElement>,
  },
  setup(props, { slots }) {
    const element = shallowRef<HTMLElement | null>(null)
    let release: (() => void) | undefined
    onMounted(() => {
      const target =
        props.measurementElement?.(props.row.item.key, element.value!) ?? element.value!
      release = props.observe(props.row.key, target)
    })
    onScopeDispose(() => release?.())
    return () =>
      h(
        'li',
        {
          ref: element,
          'data-occurrence': props.row.key,
          'aria-posinset': props.row.index + 1,
          'aria-setsize': props.count,
          // Natural height is essential: the engine size is only an offset/extent estimate.
          style: { position: 'absolute', top: `${props.row.start}px`, width: '100%' },
        },
        slots.default?.() ?? props.row.item.title,
      )
  },
})

/** Keyed natural-height consumer. Node tests inject rects; this is never a production list. */
export const MeasuredListConsumer = /* @__PURE__ */ defineComponent({
  props: {
    items: { type: Array as PropType<readonly MeasuredListFixtureItem[]>, required: true },
    scrollElement: { type: Object as PropType<HTMLElement>, required: true },
    listElement: { type: Object as PropType<HTMLElement>, required: true },
    cacheLimit: { type: Number, default: 32 },
    measurementElement: Function as PropType<(key: string, node: HTMLElement) => HTMLElement>,
  },
  setup(props, { slots }) {
    const result = useMeasuredVirtualList({
      items: () => props.items,
      getItemKey: (item) => item.key,
      getContentGeneration: (item) => item.revision,
      estimatedItemSize: 20,
      cacheLimit: props.cacheLimit,
      scrollElement: () => props.scrollElement,
      listElement: () => props.listElement,
    })
    return () =>
      h(
        'ol',
        {
          'data-logical-count': result.count.value,
          'data-cached-heights': result.measurements.cacheSize.value,
          style: {
            position: 'relative',
            height: `${result.totalSize.value}px`,
            margin: 0,
            padding: 0,
            listStyle: 'none',
          },
        },
        result.virtualItems.value.map((row) =>
          h(
            MeasuredListUnit,
            {
              key: row.key,
              row,
              count: result.count.value,
              observe: result.measurements.observeItem,
              measurementElement: props.measurementElement,
            },
            { default: () => slots.default?.(row) ?? row.item.title },
          ),
        ),
      )
  },
})
