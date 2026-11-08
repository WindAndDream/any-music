import type { InjectionKey } from 'vue'

/** Theme-private admission: no production provider until C03 runtime acceptance. */
export const studioVirtualFavoritesCanaryKey: InjectionKey<boolean> = Symbol(
  'studio-virtual-favorites-canary',
)
