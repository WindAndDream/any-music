import type { Track } from '@any-music/core'
import { computed, inject, provide, toValue } from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

type AccountNameResolver = (track: Track) => string | undefined
const accountNameKey: InjectionKey<AccountNameResolver> = Symbol('any-music-track-account-name')

/** Runtime supplies current public labels; this port carries no routing or credential authority. */
export function provideTrackAccountName(resolve: AccountNameResolver): void {
  provide(accountNameKey, resolve)
}

export function useTrackAccountName(track: MaybeRefOrGetter<Track | undefined>) {
  const resolve = inject(accountNameKey, (value: Track) => value.acquisition?.accountName)
  return computed(() => {
    const value = toValue(track)
    return value ? resolve(value) : undefined
  })
}
