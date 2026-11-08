import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { test } from 'node:test'

import { runGuestProgram } from '@any-music/plugin-sdk/host'
import { createTestVm } from '@any-music/plugin-testkit'

import { buildGuest } from '../src/build.mjs'
import { main } from '../src/cli.mjs'
import { readPairingFile } from '../src/dev.mjs'
import {
  createProject,
  openProject,
  snapshotProject,
  packProject,
  testProject,
  permissionDiff,
  readPackage,
} from '../src/index.mjs'
import { signPackage, checkMigration } from '../src/package.mjs'
import { inspectSource } from '../src/project.mjs'

async function temporary(t) {
  const parent = resolve(tmpdir()),
    root = await mkdtemp(join(parent, 'am-plugin-s15-'))
  t.after(async () => {
    assert.equal(relative(parent, root), basename(root))
    assert.ok(basename(root).startsWith('am-plugin-s15-'))
    await rm(root, { recursive: true, force: true })
  })
  return root
}
async function invoke(args) {
  let output = ''
  const code = await main(args, {
    stdout: {
      write: (value) => {
        output += value
      },
    },
    stderr: { write: () => {} },
  })
  return { code, body: JSON.parse(output) }
}
test('public source template paginates anonymous catalog responses through named ports and handles denial', async (t) => {
  const root = await temporary(t),
    project = join(root, 'public-catalog')
  await createProject(project, 'source-code')
  const source = await buildGuest(await snapshotProject(project)),
    calls = []
  const items = Array.from({ length: 22 }, (_, n) => ({
    id: 'item-' + n,
    title: 'Item ' + n,
    artists: [],
    source: { pluginId: 'remote', resourceId: String(n), mediaKind: 'audio' },
  }))
  const network = {
    async request(input) {
      calls.push(['request', input])
      return { responseRef: 'body', status: 200, sizeBytes: 4096, expiresAtMs: 30000 }
    },
    async readResponse(input) {
      calls.push(['read', input])
      return { text: JSON.stringify({ items }), nextOffset: 4096, done: true }
    },
    async releaseResponse(input) {
      calls.push(['release', input])
    },
  }
  const run = () =>
    runGuestProgram({
      invocation: {
        operation: 'command.run',
        inputJson: JSON.stringify({ query: 'https://example.com/catalog.json', pageNumber: 2 }),
        contextRef: 'context',
        sequence: 0,
        deadlineMs: 30000,
      },
      host: { network },
      invoke: async (invocation) => {
        const vm = await createTestVm()
        try {
          return JSON.parse(await vm.run(source, JSON.stringify(invocation), undefined, 'module'))
        } finally {
          vm.dispose()
        }
      },
    })
  const output = await run()
  assert.equal(output.items.length, 2)
  assert.equal(output.pageNumber, 2)
  assert.equal(output.items[0].source.pluginId, 'org.example.public-catalog')
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['request', 'read', 'release'],
  )
  network.request = async () => {
    throw Error('secret host path')
  }
  assert.equal((await run()).status, 'unavailable')
})
for (const template of ['source-code', 'source-declarative', 'tag-suggestion', 'export'])
  test(
    template + ': create → check → same VM tests → reproducible archive → verify → migration',
    async (t) => {
      const root = await temporary(t),
        project = join(root, template)
      await createProject(project, template)
      const snapshot = await snapshotProject(project)
      assert.equal((await testProject(snapshot)).passed, true)
      const a = await packProject(snapshot),
        b = await packProject(await snapshotProject(project))
      assert.deepEqual(a, b)
      const path = join(root, 'test.amplugin')
      await writeFile(path, a)
      const packageValue = await readPackage(path)
      assert.equal(packageValue.manifest.id, snapshot.manifest.id)
      assert.equal(packageValue.signer, undefined)
      assert.equal(
        (await checkMigration(join(project, 'test/fixtures/migration.json'), packageValue))
          .preserved,
        true,
      )
      if (template !== 'source-declarative')
        await assert.rejects(snapshotProject(project, 'mobile'), (e) => e.exitCode === 4)
      await assert.rejects(createProject(project, template), (e) => e.exitCode === 2)
    },
  )
test('config and pack hooks are inert; sealed source survives path edits', async (t) => {
  const root = await temporary(t),
    project = join(root, 'hooks')
  await createProject(project, 'source-code')
  await Promise.all(
    ['vite.config.ts', 'postinstall.mjs', '.env'].map((path) =>
      writeFile(join(project, path), "throw new Error('executed')"),
    ),
  )
  const snapshot = await snapshotProject(project)
  await writeFile(join(project, 'src/main.ts'), "throw new Error('late edit')")
  assert.ok((await packProject(snapshot)).length > 0)
  await writeFile(
    join(project, 'plugin.config.json'),
    JSON.stringify({ version: 1, hook: 'postinstall.mjs' }),
  )
  await assert.rejects(snapshotProject(project), (e) => e.diagnostic.code === 'CONFIG')
})
test('small sealed assets retain bounded memory and preserve their original package bytes', async (t) => {
  const root = await temporary(t),
    project = join(root, 'small-assets')
  await createProject(project, 'source-declarative')
  const configPath = join(project, 'plugin.config.json'),
    config = JSON.parse(await readFile(configPath, 'utf8')),
    expected = new Map()
  await Promise.all(
    Array.from({ length: 32 }, async (_, index) => {
      const path = `assets/tiny-${index}.json`,
        bytes = Buffer.from(JSON.stringify({ index }))
      expected.set(path, bytes)
      await writeFile(join(project, path), bytes)
    }),
  )
  config.assets.push(...expected.keys())
  await writeFile(configPath, JSON.stringify(config))
  const snapshot = await snapshotProject(project),
    backingStores = new Set([...snapshot.assets.values()].map((bytes) => bytes.buffer)),
    retainedBytes = [...backingStores].reduce((total, buffer) => total + buffer.byteLength, 0)
  assert.ok(retainedBytes < 1024 * 1024, `Tiny assets retained ${retainedBytes} backing bytes`)
  await writeFile(join(project, 'assets/tiny-0.json'), '{"changed":true}')
  const output = join(root, 'small-assets.amplugin')
  await writeFile(output, await packProject(snapshot))
  const packed = await readPackage(output)
  for (const [path, bytes] of expected) {
    assert.deepEqual(snapshot.assets.get(path), bytes)
    assert.deepEqual(packed.files.get(path), bytes)
  }
})
test('sealed reads preserve empty files, exact limits and over-budget rejection', async (t) => {
  const root = await temporary(t),
    project = join(root, 'read-limits')
  await createProject(project, 'source-declarative')
  await writeFile(join(project, 'assets/empty.json'), '')
  await writeFile(join(project, 'assets/exact.json'), '{"ok":true}')
  const selected = await openProject(project),
    expected = Buffer.from('{"ok":true}')
  assert.equal((await selected.read('assets/empty.json', 0)).length, 0)
  assert.deepEqual(await selected.read('assets/exact.json', expected.length), expected)
  await assert.rejects(
    selected.read('assets/exact.json', expected.length - 1),
    (error) => error.diagnostic.code === 'FILE_BUDGET',
  )
})
for (const config of [null, [], true, 0, 'invalid', {}])
  test(`non-config JSON ${JSON.stringify(config)} returns a configuration error`, async (t) => {
    const root = await temporary(t),
      project = join(root, 'invalid-config')
    await createProject(project, 'export')
    await writeFile(join(project, 'plugin.config.json'), JSON.stringify(config))
    for (const command of ['check', 'pack']) {
      // Both commands consume the same invalid configuration without writing an output.
      // oxlint-disable-next-line no-await-in-loop
      const result = await invoke([command, '--project', project, '--json'])
      assert.equal(result.code, 2)
      assert.equal(result.body.ok, false)
      assert.equal(result.body.diagnostics[0].code, 'CONFIG')
      assert.equal(result.body.diagnostics[0].path, 'plugin.config.json')
    }
  })
test('static checks reject native globals, dynamic code, network and foreign imports', () => {
  for (const source of [
    "fetch('https://example.com')",
    'process.env.SECRET',
    "import('x')",
    'new Function("x")',
    "import x from 'node:fs'",
    'globalThis["fetch"]()',
    "import x from 'https://example.com/a.js'",
  ])
    assert.throws(() => inspectSource(source, 'src/main.ts'))
})
test('linked files and escaped graphs are rejected', async (t) => {
  const root = await temporary(t),
    project = join(root, 'links')
  await createProject(project, 'source-code')
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'main.ts'), 'export default () => null')
  await rm(join(project, 'src/main.ts'))
  await rmdir(join(project, 'src'))
  await symlink(outside, join(project, 'src'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    snapshotProject(project),
    (error) => error.diagnostic.code === 'PROJECT_LINK',
  )
})
test('signatures use raw integrity bytes and an explicit publisher pin', async (t) => {
  const root = await temporary(t),
    project = join(root, 'signed')
  await createProject(project, 'source-code')
  const unsigned = join(root, 'unsigned.amplugin'),
    signed = join(root, 'signed.amplugin'),
    key = join(root, 'local.pem')
  await writeFile(unsigned, await packProject(await snapshotProject(project)))
  await writeFile(
    key,
    generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 },
  )
  const output = await signPackage(unsigned, key, signed)
  assert.equal(output.publisherVerified, false)
  assert.match(output.publisher, /^[a-f0-9]{64}$/)
  await assert.rejects(signPackage(signed, key, join(root, 'again.amplugin')))
  const manifest = (await readPackage(unsigned)).manifest
  assert.equal(permissionDiff(manifest, manifest).requiresApproval, false)
  assert.equal(
    permissionDiff(manifest, { ...manifest, memoryClass: 'increased' }).requiresApproval,
    true,
  )
})
test('CLI stdout is JSON and failures have stable exit codes', async (t) => {
  const root = await temporary(t),
    project = join(root, 'cli')
  await createProject(project, 'source-code')
  assert.equal((await invoke(['check', '--project', project, '--json'])).code, 0)
  assert.equal((await invoke(['wat'])).code, 2)
  assert.equal((await invoke(['check', '--project', project, '--target', 'mobile'])).code, 4)
  assert.equal((await invoke(['dev', '--project', project, '--once'])).code, 4)
  const source = await readFile(join(project, 'src/main.ts'), 'utf8')
  assert.ok(source)
  await writeFile(join(project, 'plugin.json'), '{"id":"first","id":"duplicate"}')
  assert.equal((await invoke(['check', '--project', project])).code, 1)
})
test('DEV requires host pairing and never creates a server or launches an application', async () => {
  await assert.rejects(readPairingFile(undefined, '.'), (e) => e.exitCode === 4)
})
test('pack smoke rejects a malformed continuation and invalid nested completion JSON', async (t) => {
  const root = await temporary(t),
    project = join(root, 'smoke')
  await createProject(project, 'export')
  for (const source of [
    'export default()=>({nonsense:true})',
    "export default()=>({kind:'complete',outputJson:'invalid JSON'})",
  ]) {
    // Variants replace the same selected source before taking a new sealed snapshot.
    // oxlint-disable-next-line no-await-in-loop
    await writeFile(join(project, 'src/main.ts'), source)
    // oxlint-disable-next-line no-await-in-loop
    await assert.rejects(packProject(await snapshotProject(project)))
  }
})
test('doctor/check capability matrix rejects required host gaps and permits unavailable optionals', async (t) => {
  const root = await temporary(t),
    project = join(root, 'compatibility')
  await createProject(project, 'export')
  const path = join(project, 'plugin.json'),
    manifest = JSON.parse(await readFile(path, 'utf8'))
  manifest.capabilities = [
    { id: 'media.resolve', version: 1, required: true, reason: { en: 'Media', 'zh-CN': '媒体' } },
  ]
  await writeFile(path, JSON.stringify(manifest))
  await assert.rejects(snapshotProject(project), (error) => error.exitCode === 4)
  manifest.capabilities[0].required = false
  await writeFile(path, JSON.stringify(manifest))
  await snapshotProject(project)
  manifest.memoryClass = 'increased'
  await writeFile(path, JSON.stringify(manifest))
  await assert.rejects(snapshotProject(project), (error) => error.exitCode === 4)
})
