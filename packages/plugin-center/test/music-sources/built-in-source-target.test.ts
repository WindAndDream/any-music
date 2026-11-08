import { describe, expect, it } from 'vitest'

import { selectBuiltInSources } from '../../src/music-sources/built-in-source-target'

describe('built-in distribution', () => {
  it('does not opt new sources into unspecified targets or construct their transports', () => {
    const directory = [
      { descriptor: { id: 'existing' }, targets: ['userscript', 'desktop', 'mobile'] as const },
      { descriptor: { id: 'future' }, targets: ['desktop'] as const },
      { descriptor: { id: 'unassigned' }, targets: [] },
    ]
    expect(selectBuiltInSources(directory, 'mobile').map((item) => item.descriptor.id)).toEqual([
      'existing',
    ])
    expect(selectBuiltInSources(directory, 'desktop').map((item) => item.descriptor.id)).toEqual([
      'existing',
      'future',
    ])
    expect(selectBuiltInSources(directory, 'userscript').map((item) => item.descriptor.id)).toEqual(
      ['existing'],
    )
  })
  it('rejects duplicate source identities before selecting a target', () => {
    expect(() =>
      selectBuiltInSources(
        [
          { descriptor: { id: 'same' }, targets: ['desktop'] },
          { descriptor: { id: 'same' }, targets: ['mobile'] },
        ],
        'mobile',
      ),
    ).toThrow('Duplicate built-in source')
  })
})
