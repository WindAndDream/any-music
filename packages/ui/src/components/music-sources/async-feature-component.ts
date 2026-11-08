import { defineComponent, h, markRaw, onScopeDispose, shallowRef } from 'vue'
import type { Component } from 'vue'

import FeatureModuleLoadError from './FeatureModuleLoadError.vue'
import FeatureModuleLoading from './FeatureModuleLoading.vue'

const FEATURE_MODULE_TIMEOUT_MS = 30_000

/**
 * 为功能页提供可见加载、超时和显式重试边界。
 * 每次重试都会重新调用 loader，失败 Promise 不会被应用层永久缓存。
 */
export function createAsyncFeatureComponent<T extends Component>(
  loader: () => Promise<{ default: T }>,
): T {
  return defineComponent({
    name: 'RetryableFeatureModule',
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const resolvedComponent = shallowRef<T>()
      const loadError = shallowRef<Error>()
      let loadGeneration = 0

      async function load(): Promise<void> {
        const generation = ++loadGeneration
        resolvedComponent.value = undefined
        loadError.value = undefined
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        try {
          const loaded = await Promise.race([
            loader(),
            new Promise<never>((_resolve, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error('功能模块加载超时，请重试。')),
                FEATURE_MODULE_TIMEOUT_MS,
              )
            }),
          ])
          if (generation === loadGeneration) resolvedComponent.value = markRaw(loaded.default)
        } catch (error) {
          if (generation === loadGeneration) {
            loadError.value = error instanceof Error ? error : new Error(String(error))
          }
        } finally {
          if (timeoutId !== undefined) clearTimeout(timeoutId)
        }
      }

      void load()
      onScopeDispose(() => {
        loadGeneration += 1
      })

      return () => {
        if (resolvedComponent.value) return h(resolvedComponent.value, attrs, slots)
        if (loadError.value) {
          return h(FeatureModuleLoadError, { error: loadError.value, onRetry: load })
        }
        return h(FeatureModuleLoading)
      }
    },
  }) as T
}
