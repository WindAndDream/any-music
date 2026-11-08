import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import { useFixedVirtualList, useVirtualScrollContext } from '../../../src/virtual-scroll'

export interface FixedListFixtureItem {
  key: string
  title: string
}
const consumerProps = {
  items: { type: Array as PropType<readonly FixedListFixtureItem[]>, required: true as const },
  scrollElement: { type: Object as PropType<HTMLElement>, required: true as const },
  listElement: { type: Object as PropType<HTMLElement>, required: true as const },
  itemSize: { type: Number, default: 20 },
}

/** Actual keyed rendering consumer for Node allocation tests and isolated production bundling. */
export const FixedListConsumer = /* @__PURE__ */ defineComponent({
  props: consumerProps,
  setup(props, { slots }) {
    const { virtualItems, totalSize, count } = useFixedVirtualList({
      items: () => props.items,
      getItemKey: (item) => item.key,
      scrollElement: () => props.scrollElement,
      listElement: () => props.listElement,
      itemSize: () => props.itemSize,
    })
    return () =>
      h(
        'ol',
        {
          'data-logical-count': count.value,
          style: {
            height: `${totalSize.value}px`,
            position: 'relative',
            margin: 0,
            padding: 0,
            listStyle: 'none',
          },
        },
        virtualItems.value.map((item) =>
          h(
            'li',
            {
              key: item.key,
              'data-occurrence': item.key,
              'aria-posinset': item.index + 1,
              'aria-setsize': count.value,
              style: {
                position: 'absolute',
                top: `${item.start}px`,
                height: `${item.size}px`,
                width: '100%',
              },
            },
            slots.default?.(item) ?? item.item.title,
          ),
        ),
      )
  },
})

/** Equivalent unwindowed fixture; neither fixture is a production product entry. */
export const FullListConsumer = /* @__PURE__ */ defineComponent({
  props: consumerProps,
  setup(props) {
    useVirtualScrollContext({
      scrollElement: () => props.scrollElement,
      listElement: () => props.listElement,
    })
    return () =>
      h(
        'ol',
        props.items.map((item) => h('li', { key: item.key }, item.title)),
      )
  },
})
