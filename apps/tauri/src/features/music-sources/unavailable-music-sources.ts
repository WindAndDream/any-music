import { AppError, toAppErrorState } from '@any-music/core'
import type { MusicSourcePlugin } from '@any-music/core'
import type { ModuleForm } from '@any-music/plugin-center'

import { getBuiltInSourceDirectory } from './built-in-source-directory'

function unavailable(): AppError {
  return new AppError('unsupported-operation', '此运行端暂不支持该来源的网络与登录能力。')
}

/** Retain source identities for the registry and stored recipes without creating
 * account/CDP transports when the native platform capability is unavailable. */
export function createUnavailableMusicSources(form: ModuleForm): readonly MusicSourcePlugin[] {
  return getBuiltInSourceDirectory(form).map(({ descriptor, validateImportUrl }) => {
    return {
      descriptor,
      checkAvailability: async () => ({
        status: 'unavailable',
        checkedAtMs: Date.now(),
        error: toAppErrorState(unavailable()),
      }),
      getSession: async () => ({ status: 'unavailable', error: toAppErrorState(unavailable()) }),
      getLoginUrl: () => undefined,
      validateImportUrl,
      search: () => {
        throw unavailable()
      },
      importFromUrl: () => {
        throw unavailable()
      },
      resolveMedia: async () => {
        throw unavailable()
      },
    } satisfies MusicSourcePlugin
  })
}
