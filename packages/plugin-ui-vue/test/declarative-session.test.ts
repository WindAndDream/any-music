import type { UiDocument } from '@any-music/plugin-sdk'
import { describe, expect, it, vi } from 'vitest'

import { createDeclarativeSession } from '../src/declarative-session'
import { manifest, document } from './fixtures'

function fixture() {
  let active = true
  const onDispose = vi.fn()
  const session = createDeclarativeSession({
    manifest,
    installationId: 'test-install',
    viewId: 'summary',
    contextRef: 'context-1',
    isCurrent: () => active,
    onDispose,
  })
  return {
    session,
    onDispose,
    invalidate: () => {
      active = false
    },
  }
}
describe('host-rendered declarative UI', () => {
  it.each([
    'track.actions.secondary',
    'track.details',
    'trackList.operator.actions',
    'trackList.filters',
  ] as const)('uses the same restricted DTO/event binding for %s', (pointId) => {
    const scopedManifest = structuredClone(manifest)
    scopedManifest.contributions[0]!.pointId = pointId
    scopedManifest.contributions[0]!.commandId = 'summarize'
    const session = createDeclarativeSession({
      manifest: scopedManifest,
      installationId: 'test-install',
      viewId: 'summary',
      contributionId: 'summary',
      contextRef: 'selected-tracks',
      isCurrent: () => true,
    })
    session.update(document)
    expect(session.createEvent(1, 'run').contextRef).toBe('selected-tracks')
    session.dispose()
  })
  it('accepts text/forms and emits only declared, revision-bound command values', () => {
    const { session } = fixture()
    session.update(document)
    expect(session.createEvent(1, 'run')).toMatchObject({
      commandId: 'summarize',
      contextRef: 'context-1',
      viewRevision: 1,
    })
    expect(session.createEvent(1, 'form', [{ fieldId: 'query', value: 'example' }]).values).toEqual(
      [{ fieldId: 'query', value: 'example' }],
    )
    expect(() =>
      session.createEvent(1, 'form', [{ fieldId: 'query', value: 'x'.repeat(21) }]),
    ).toThrow('Invalid form field')
    expect(() => session.createEvent(1, 'form', [{ fieldId: 'foreign', value: 'x' }])).toThrow()
    expect(() => session.createEvent(1, 'run', [])).toThrow()
    const changed = { ...structuredClone(document), viewRevision: 2 }
    session.update(changed)
    expect(() => session.createEvent(1, 'run')).toThrow('Stale UI event')
    expect(() => session.update(document)).toThrow('Stale')
  })
  it('binds identity outside view data, clones inputs and cancels the view exactly once', () => {
    const { session, invalidate, onDispose } = fixture()
    const input = structuredClone(document)
    session.update(input)
    input.nodes[0] = { id: 'spoof', type: 'text', text: 'changed' }
    expect(session.document.value?.nodes[0]?.id).toBe('text')
    expect(session.identity).toEqual({
      ownerId: 'org.example.summary',
      name: '摘要',
      installationId: 'test-install',
    })
    invalidate()
    expect(() => session.createEvent(1, 'run')).toThrow()
    expect(() => session.update({ ...document, viewRevision: 2 })).toThrow()
    session.dispose()
    session.dispose()
    expect(session.signal.aborted).toBe(true)
    expect(onDispose).toHaveBeenCalledTimes(1)
  })
  it.each([
    { id: 'password', type: 'password', label: 'Password' },
    { id: 'html', type: 'text', text: '<script>run()</script>', html: '<b>raw</b>' },
    { id: 'vue', type: 'component', component: 'https://example.com/plugin.vue' },
    { id: 'css', type: 'text', text: 'x', style: 'position:fixed' },
    {
      id: 'button',
      type: 'button',
      label: { 'zh-CN': '运行', en: 'Run' },
      commandId: 'foreign-command',
    },
    {
      id: 'form',
      type: 'form',
      label: { 'zh-CN': '确认', en: 'Submit' },
      commandId: 'summarize',
      fields: [{ id: 'secret', label: { 'zh-CN': '密码', en: 'Password' }, type: 'password' }],
    },
  ])('rejects executable, credential or foreign-command nodes: %o', (node) => {
    expect(() => fixture().session.update({ ...document, nodes: [node] })).toThrow()
  })
  it('rejects duplicate IDs, oversized text/node counts and page byte budgets before publication', () => {
    const { session } = fixture()
    session.update(document)
    for (const nodes of [
      [document.nodes[0]!, document.nodes[0]!],
      [{ id: 'large', type: 'text', text: 'x'.repeat(4097) }],
      Array.from({ length: 1001 }, (_, i) => ({ id: `text${i}`, type: 'text', text: 'x' })),
      Array.from({ length: 80 }, (_, i) => ({
        id: `text${i}`,
        type: 'text',
        text: 'x'.repeat(4096),
      })),
    ])
      expect(() => session.update({ ...document, viewRevision: 2, nodes } as UiDocument)).toThrow()
    expect(session.document.value?.viewRevision).toBe(1)
  })
})
