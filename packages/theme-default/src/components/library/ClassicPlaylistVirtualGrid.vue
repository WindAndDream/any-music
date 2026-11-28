<script setup lang="ts">
import type { MusicPlaylist } from '@any-music/core'
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { createVirtualGridReorderGeometry } from '@any-music/ui/virtual-scroll'
import type {
  GridReorderGeometryFactory,
  useMeasuredVirtualGrid,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'
import { useTemplateRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps<{
  playlists: readonly MusicPlaylist[]
  state: UiThemeFeatureMap['playlists']['state']
  scrollElement: HTMLElement | null
  offsetElements: readonly Element[]
  revision: unknown
  editingId?: string
  animate: boolean
  getReorderStyle: (kind: 'track', id: string) => CSSProperties | undefined
}>()
defineSlots<{ default(props: { playlist: MusicPlaylist; index: number }): unknown }>()
const grid = useTemplateRef<{
  element: HTMLElement | null
  result: ReturnType<typeof useMeasuredVirtualGrid<MusicPlaylist>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}>('grid')

function contentGeneration(playlist: MusicPlaylist) {
  return JSON.stringify([
    playlist.name,
    playlist.trackIds.length,
    playlist.coverId && props.state.coverUrls[playlist.coverId],
    props.state.customTagsByPlaylistId?.get(playlist.id),
  ])
}

const createGeometry: GridReorderGeometryFactory<'track' | 'platform'> = (input) => {
  const surface = grid.value
  const element = surface?.element
  const viewport = props.scrollElement
  if (input.kind !== 'track' || !surface || !element || !viewport) return
  const { result } = surface
  const { ready, listOffset, listWidth } = result.context.metrics.value
  if (!ready) return
  const mountedCell = (id: string) =>
    [...element.children].find((cell) => (cell as HTMLElement).dataset.queueDropId === id) as
      | HTMLElement
      | undefined
  const sourceElement = mountedCell(input.sourceId)
  if (!sourceElement) return
  const rect = element.getBoundingClientRect()
  const columns = result.columns.value
  const getDirection = () =>
    element.ownerDocument.defaultView?.getComputedStyle(element).direction === 'rtl' ? 'rtl' : 'ltr'
  const direction = getDirection()
  return createVirtualGridReorderGeometry(input, {
    geometry: result.geometry.value,
    getGeometry: () => result.geometry.value,
    getGeometryRevision: () => result.layoutRevision.value,
    columns,
    direction,
    listWidth,
    origin: { left: rect.left - input.bounds.left, top: rect.top - input.bounds.top },
    sourceElement,
    mountedIds: () => result.virtualItems.value.map((row) => row.item.id),
    getMountedElement: mountedCell,
    getRevision: () => result.virtualItems.value,
    isValid: () => {
      const metrics = result.context.metrics.value
      const top =
        element.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top -
        viewport.clientTop +
        viewport.scrollTop
      return (
        grid.value === surface &&
        element.isConnected &&
        props.scrollElement === viewport &&
        metrics.ready &&
        metrics.listWidth === listWidth &&
        result.columns.value === columns &&
        Math.abs(top - listOffset) <= 1 &&
        getDirection() === direction
      )
    },
  })
}
const continuity = usePresentationContinuity({
  register: false,
  element: () => grid.value?.element ?? null,
  region: 'playlist:overview',
  scrollElement: () => props.scrollElement,
  geometry: () => {
    const result = grid.value?.result
    return result
      ? { ...result.geometry.value, listOffset: result.context.metrics.value.listOffset }
      : undefined
  },
  refresh: () => grid.value?.result.context.refresh(),
  beforeRestore: () => {
    grid.value?.retention?.cancelNavigation()
    return grid.value?.anchor.suspend()
  },
  retain: (id) => grid.value?.retention?.retain(id, 'navigation'),
  revision: () => props.revision,
})
watch(
  [
    () => props.editingId,
    () => grid.value?.retention,
    () => grid.value?.result.context.metrics.value.ready,
  ],
  ([id, retention, ready], _previous, onCleanup) => {
    const release = id && ready ? retention?.retain(id, 'popover') : undefined
    if (release) onCleanup(release)
  },
  { immediate: true, flush: 'post' },
)

defineExpose({
  continuity,
  createGeometry,
  retainItem: (_kind: 'track' | 'platform', id: string) =>
    grid.value?.retention?.retain(id, 'reorder'),
  focusItem: (_kind: 'track' | 'platform', id: string, signal: AbortSignal) =>
    grid.value?.retention?.focusItem(id, {
      signal,
      target: (element) => element.querySelector<HTMLElement>('[data-queue-handle]'),
    }) ?? Promise.resolve(false),
})
</script>

<template>
  <VirtualTrackCardGrid
    ref="grid"
    :items="playlists"
    :get-item-key="(playlist) => playlist.id"
    :get-content-generation="contentGeneration"
    :estimated-item-size="220"
    :scroll-element="scrollElement"
    :offset-elements="offsetElements"
    :display-mode="state.displayMode"
    :mobile-columns="state.mobileColumns"
    :anchor-reset-key="revision"
    :animate="animate"
    :reorder="{
      attributePrefix: 'queue',
      kind: 'track',
      getItemId: (row) => row.item.id,
      getItemStyle: (id) => getReorderStyle('track', id),
    }"
    interaction
    anchor
  >
    <template #default="{ row }"><slot :playlist="row.item" :index="row.index" /></template>
  </VirtualTrackCardGrid>
</template>
