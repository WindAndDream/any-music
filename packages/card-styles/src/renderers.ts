import type { CollectionItemStyle } from '@any-music/ui/library'
import type { Component } from 'vue'

import MinimalTrackCard from './components/MinimalTrackCard.vue'

type CardKind = 'track'

/** One registration serves every theme; inline actions stay theme-owned. */
const renderers: Record<Exclude<CollectionItemStyle, 'default'>, Record<CardKind, Component>> = {
  minimal: { track: MinimalTrackCard },
}

export function resolveCardStyle(
  kind: CardKind,
  style: CollectionItemStyle = 'default',
): Component | null {
  return style === 'default' ? null : (renderers[style]?.[kind] ?? null)
}
