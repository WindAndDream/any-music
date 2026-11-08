import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { test } from 'node:test'

import { createProject, snapshotProject, packProject, readPackage } from '../src/index.mjs'

test('gateway authentication declarations survive the sealed amplugin package', async () => {
  const parent = resolve(tmpdir())
  const root = await mkdtemp(join(parent, 'am-source-package-'))
  try {
    const project = join(root, 'private-source')
    await createProject(project, 'source-gateway')
    const snapshot = await snapshotProject(project)
    const output = join(root, 'source.amplugin')
    await writeFile(output, await packProject(snapshot))
    const packed = await readPackage(output)
    assert.equal(packed.manifest.execution, 'declarative')
    assert.equal(packed.manifest.sourceAuthentication.allowUnauthenticated, false)
    assert.deepEqual(packed.manifest.sourceAuthentication.methods, ['credentials'])
    assert.equal(packed.manifest.sourceAuthentication.credentialFields[0].secret, true)
    assert.ok(
      packed.manifest.capabilities.some((c) => c.id === 'source.authentication' && c.required),
    )
    assert.ok(!JSON.stringify(packed.manifest).includes('system-browser'))
  } finally {
    assert.ok(relative(parent, root).startsWith('am-source-package-'))
    await rm(root, { recursive: true, force: true })
  }
})
