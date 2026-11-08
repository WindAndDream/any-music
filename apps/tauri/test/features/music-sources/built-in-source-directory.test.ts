import { describe, expect, it } from 'vitest'

import type { AccountRuntime } from '../../../src/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '../../../src/features/music-sources/built-in-music-sources'
import { getBuiltInSourceDirectory } from '../../../src/features/music-sources/built-in-source-directory'
import { createUnavailableMusicSources } from '../../../src/features/music-sources/unavailable-music-sources'
import { createBuiltInWorkbenchModules } from '../../../src/features/plugins/built-in-workbench-modules'

describe('native built-in source distribution', () => {
  it('constructs only mobile facades without starting account or protocol work', () => {
    const runtime = new Proxy({} as AccountRuntime, {
      get() {
        throw new Error('No eager account work')
      },
    })
    expect(
      createBuiltInMusicSources(runtime, 'mobile').map((source) => source.descriptor.id),
    ).toEqual(['bilibili'])
  })
  it.each([
    ['desktop', ['bilibili', 'douyin', 'netease']],
    ['mobile', ['bilibili']],
  ] as const)('keeps %s source instances and modules aligned', (form, expected) => {
    expect(getBuiltInSourceDirectory(form).map((source) => source.descriptor.id)).toEqual(expected)
    expect(createUnavailableMusicSources(form).map((source) => source.descriptor.id)).toEqual(
      expected,
    )
    const modules = createBuiltInWorkbenchModules(form)
    expect(
      modules.features.flatMap((module) =>
        module.contributions
          .filter((item) => item.pointId === 'music.sources')
          .map((item) => item.implementationId),
      ),
    ).toEqual(expected)
    expect(
      modules.directory
        .filter((module) => module.id.startsWith('source.'))
        .map((module) => module.id),
    ).toEqual(expected.map((id) => `source.${id}`))
  })
})
