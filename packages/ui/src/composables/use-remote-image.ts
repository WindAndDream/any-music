import {
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type Ref,
} from 'vue'

export interface RemoteImageLease {
  url: string
  release?: () => void
}
export type RemoteImageResolver = (url: string, signal?: AbortSignal) => Promise<RemoteImageLease>
const imageResolverKey: InjectionKey<RemoteImageResolver> = Symbol('any-music:remote-image')

export function provideRemoteImageResolver(resolver?: RemoteImageResolver): void {
  if (resolver) provide(imageResolverKey, resolver)
}

/** Keep lazy loading effective even when a runtime must acquire bytes before producing a URL. */
export function useRemoteImage(
  source: () => string,
  element: Readonly<Ref<HTMLImageElement | null>>,
  eager: () => boolean,
) {
  const resolver = inject(imageResolverKey, undefined)
  const url = shallowRef<string | undefined>(resolver ? undefined : source())
  let generation = 0
  let release: (() => void) | undefined
  let observer: IntersectionObserver | undefined
  watch(
    [source, element],
    ([src, img], _, onCleanup) => {
      const current = ++generation
      release?.()
      release = undefined
      observer?.disconnect()
      observer = undefined
      url.value = resolver ? undefined : src
      if (!resolver || !img) return
      const controller = new AbortController()
      let started = false
      const load = () => {
        if (started) return
        started = true
        observer?.disconnect()
        void resolver(src, controller.signal)
          .then((lease) => {
            if (generation !== current) {
              lease.release?.()
              return
            }
            release = lease.release
            url.value = lease.url
          })
          .catch(() => {
            if (generation === current) url.value = src
          })
      }
      if (eager() || typeof IntersectionObserver === 'undefined') load()
      else {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load()
          },
          { rootMargin: '200px' },
        )
        observer.observe(img)
      }
      onCleanup(() => {
        controller.abort()
        observer?.disconnect()
      })
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    generation++
    observer?.disconnect()
    release?.()
  })
  return {
    url,
    fallback: () => {
      if (url.value === source()) return false
      release?.()
      release = undefined
      url.value = source()
      return true
    },
  }
}
