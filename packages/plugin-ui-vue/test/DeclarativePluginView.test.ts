import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createDeclarativeSession } from '../src/declarative-session'
import DeclarativePluginView from '../src/DeclarativePluginView.vue'
import { document, manifest } from './fixtures'
import {
  mountCatalogComponent,
  findCatalogElement,
  dispatchCatalogEvent,
} from './helpers/test-renderer'

it('keeps host identity and form warning outside escaped plugin content, and rejects removed-view controls', async () => {
  const session = createDeclarativeSession({
    manifest,
    installationId: 'installation',
    viewId: 'summary',
    contextRef: 'context',
    isCurrent: () => true,
  })
  session.update(document)
  const action = vi.fn(),
    rejected = vi.fn()
  const mounted = mountCatalogComponent(DeclarativePluginView, {
    session,
    onAction: action,
    onRejected: rejected,
  })
  expect(mounted.root.textContent).toContain('来自插件 摘要 · org.example.summary')
  expect(mounted.root.textContent).toContain('请勿在插件界面输入账号或密码。')
  const text = findCatalogElement(
    mounted.root,
    (node) => node.tag === 'p' && node.textContent.includes('<script>'),
  )
  expect(text.children).toHaveLength(0)
  const run = findCatalogElement(
    mounted.root,
    (node) => node.tag === 'button' && node.textContent === '生成摘要',
  )
  dispatchCatalogEvent(run, 'onClick')
  expect(action).toHaveBeenCalledTimes(1)
  const input = findCatalogElement(mounted.root, (node) => node.tag === 'input')
  input.value = 'note'
  dispatchCatalogEvent(input, 'onInput')
  const form = findCatalogElement(mounted.root, (node) => node.tag === 'form')
  dispatchCatalogEvent(form, 'onSubmit')
  expect(action.mock.calls[1]?.[0].values).toEqual([{ fieldId: 'query', value: 'note' }])
  const oldHandler = run.props.onClick as () => void
  session.update({ ...document, viewRevision: 2 })
  await nextTick()
  oldHandler()
  expect(rejected).toHaveBeenCalledTimes(1)
  session.dispose()
  mounted.unmount()
})
