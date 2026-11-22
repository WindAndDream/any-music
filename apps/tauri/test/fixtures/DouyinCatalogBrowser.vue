<script setup lang="ts">
import type { CatalogDrawerView } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { invoke } from '@tauri-apps/api/core'
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'

const props = defineProps<{
  drawer: CatalogDrawerView
  feature: UiThemeFeatureMap['catalog']
  selectable: boolean
  verification?: boolean
}>()
const viewport = useTemplateRef<HTMLElement>('viewport')
const ready = shallowRef(false)
const message = shallowRef('')
const lease = crypto.randomUUID()
const isChallenge = computed(() => props.drawer.errorCode === 'verification-required')
const statusMessage = computed(() => {
  if (!props.verification) return props.drawer.errorMessage || '正在连接抖音浏览器…'
  if (props.drawer.isLoading || props.drawer.verificationPhase === 'restoring')
    return '验证已通过，正在加载音乐列表…'
  if (props.drawer.verificationPhase === 'confirming') return '正在确认抖音安全验证结果…'
  if (props.drawer.verificationPhase === 'waiting') return '正在等待抖音显示安全验证…'
  return '正在打开抖音安全验证…'
})
const dark = shallowRef(false)
const paletteTokens = {
  background: '--am-color-background',
  text: '--am-color-text',
  surface: '--am-color-surface',
  muted: '--am-color-text-secondary',
  hover: '--am-color-surface-hover',
  accent: '--am-color-accent',
} as const
type Palette = Record<keyof typeof paletteTokens, string>
const palette = shallowRef<Palette>({
  background: '',
  text: '',
  surface: '',
  muted: '',
  hover: '',
  accent: '',
})
const content = computed(() => {
  const state = props.feature.state
  const favorite = new Set(state.favoriteTrackIds)
  const selected = new Set(state.selectedTrackIds)
  const invalid = new Set(state.invalidTrackIds)
  return {
    rows: (props.verification ? [] : state.tracks.slice(0, 2000)).map((track) => {
      const seconds = Math.max(0, Math.floor((track.durationMs ?? 0) / 1000))
      return {
        id: track.id,
        title: track.title.slice(0, 350),
        artist: track.artists
          .map((artist) => artist.name)
          .join(' / ')
          .slice(0, 250),
        artwork: track.artworkUrl?.slice(0, 2000),
        duration: track.durationMs
          ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
          : '',
        favorite: favorite.has(track.id),
        selected: selected.has(track.id),
        playing: state.currentTrackId === track.id,
        unavailable: invalid.has(track.id),
      }
    }),
    hasMore: props.drawer.hasMore && props.drawer.isSourceEnabled,
    dark: dark.value,
    grid: state.displayMode === 'compact',
    selectable: props.selectable,
    palette: palette.value,
  }
})

type BrowserAction = { type: 'play' | 'select' | 'favorite' | 'actions' | 'more'; id: string }
type Presentation = { ready: boolean; action?: BrowserAction }
let disposed = false
let timer: ReturnType<typeof setTimeout> | undefined
let lastAccount: string | undefined
let lastContent: typeof content.value | undefined

function bounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(innerWidth, rect.right)
  const bottom = Math.min(innerHeight, rect.bottom)
  if (right - left < 64 || bottom - top < 64 || !element.checkVisibility({ checkOpacity: true }))
    return
  for (let target: Element = element; ;) {
    const root = target.getRootNode() as Document | ShadowRoot
    const covered = [0.1, 0.5, 0.9].some((fraction) => {
      const hit = root.elementFromPoint(left + (right - left) * fraction, (top + bottom) / 2)
      return !target.contains(hit)
    })
    if (covered) return
    if (!(root instanceof ShadowRoot)) break
    target = root.host
  }
  const scale = devicePixelRatio
  return {
    left: Math.round(left * scale),
    top: Math.round(top * scale),
    width: Math.round((right - left) * scale),
    height: Math.round((bottom - top) * scale),
  }
}

function release(accountId: string) {
  return invoke('present_douyin_search', {
    request: { accountId, lease, query: props.drawer.input.trim() },
  }).catch(() => {})
}

function handleAction(action: BrowserAction) {
  const { actions, state } = props.feature
  if (action.type === 'more') {
    if (props.drawer.hasMore && !props.drawer.isLoading) void actions.loadMore(props.drawer.id)
    return
  }
  if (!state.tracks.some((track) => track.id === action.id)) return
  switch (action.type) {
    case 'play':
      void actions.play(
        action.id,
        state.tracks.map((track) => track.id),
      )
      break
    case 'favorite':
      void actions.toggleFavorite(action.id)
      break
    case 'actions':
      actions.showTrackActions(action.id)
      break
    case 'select': {
      const selected = new Set(state.selectedTrackIds)
      if (!selected.delete(action.id)) selected.add(action.id)
      actions.select([...selected])
      break
    }
  }
}

async function sync() {
  if (disposed) return
  const accountId = props.drawer.account?.id
  const element = viewport.value
  try {
    if (lastAccount && lastAccount !== accountId) {
      await release(lastAccount)
      lastAccount = undefined
      lastContent = undefined
      ready.value = false
    }
    if (disposed || !accountId || !element) return
    const style = getComputedStyle(element)
    dark.value = style.colorScheme === 'dark'
    const colors = { ...palette.value }
    for (const token of Object.keys(paletteTokens) as (keyof Palette)[]) {
      colors[token] = style.getPropertyValue(paletteTokens[token]).trim()
    }
    if (
      Object.keys(colors).some(
        (key) => colors[key as keyof Palette] !== palette.value[key as keyof Palette],
      )
    ) {
      palette.value = colors
    }
    const canPresent = props.verification
      ? props.drawer.verificationPhase === 'waiting' ||
        props.drawer.verificationPhase === 'confirming'
      : !props.drawer.isLoading && !props.drawer.isVerifying && !isChallenge.value
    const placement = canPresent ? bounds(element) : undefined
    if (!placement) {
      if (lastAccount) await release(lastAccount)
      lastAccount = undefined
      lastContent = undefined
      ready.value = false
      message.value = ''
      return
    }
    const next = content.value
    lastAccount = accountId
    const result = await invoke<Presentation>('present_douyin_search', {
      request: {
        accountId,
        lease,
        query: props.drawer.input.trim(),
        verification: props.verification,
        bounds: placement,
        content: lastContent !== next ? next : undefined,
      },
    })
    if (disposed) return
    ready.value = result.ready
    message.value = ''
    lastContent = result.ready ? next : undefined
    if (result.action) handleAction(result.action)
  } catch (error) {
    if (disposed) return
    ready.value = false
    message.value =
      typeof error === 'string' ? error.replace(/^[a-z-]+:/, '') : '无法连接抖音浏览器。'
  } finally {
    if (disposed) {
      if (lastAccount) void release(lastAccount)
    } else {
      timer = setTimeout(() => void sync(), 300)
    }
  }
}

onMounted(() => {
  if (props.verification) viewport.value?.focus({ preventScroll: true })
  void sync()
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  if (lastAccount) void release(lastAccount)
})
</script>

<template>
  <div class="catalog-browser" :class="{ 'catalog-browser--verification': verification }">
    <div
      ref="viewport"
      class="catalog-browser__viewport"
      :aria-label="verification ? '抖音官方安全验证' : '抖音浏览器网页'"
      :tabindex="verification ? -1 : undefined"
    >
      <p v-if="!ready" role="status">{{ message || statusMessage }}</p>
      <button
        v-if="
          !verification && !ready && !isChallenge && !drawer.isLoading && drawer.loadedPageCount
        "
        type="button"
        @click="feature.actions.retry(drawer.id)"
      >
        重新加载网页
      </button>
    </div>
  </div>
</template>

<style scoped>
.catalog-browser {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 180px;
}
.catalog-browser--verification {
  min-height: clamp(200px, 60dvh, 480px);
}
.catalog-browser__viewport {
  flex: 1;
  min-height: 160px;
  display: grid;
  place-items: center;
  color: var(--am-color-text-secondary);
  background: var(--am-color-surface-subtle);
}
</style>
