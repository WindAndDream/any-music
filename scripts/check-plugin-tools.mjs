/** S15 release-artifact check. No app, browser, dev server or registry publish is started. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)),
  pnpm = process.env.npm_execpath
assert(pnpm, 'Run via pnpm check:plugin:tools')
const artifacts = resolve(root, '.tmp/s15/packs')
mkdirSync(artifacts, { recursive: true })
const run = (args, cwd = root) =>
  execFileSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const packages = ['plugin-sdk', 'plugin-testkit', 'plugin-cli']
const store = dirname(run([pnpm, 'store', 'path']).trim())
for (const name of packages)
  run([pnpm, '--filter', '@any-music/' + name, 'pack', '--pack-destination', artifacts])
const parent = resolve(tmpdir()),
  consumer = mkdtempSync(join(parent, 'any-music-tools-s15-'))
try {
  const overrides = Object.fromEntries(
    packages.map((name) => [
      '@any-music/' + name,
      'file:' + join(artifacts, 'any-music-' + name + '-0.1.0.tgz').replaceAll('\\', '/'),
    ]),
  )
  // Resolve transitive ranges with the reviewed repository toolchain, not whichever registry
  // version appeared since the acceptance run. No workspace source alias is installed.
  const locked = Object.fromEntries(
    [
      ...readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
        .split('packages:\n')[1]
        .split('snapshots:\n')[0]
        .matchAll(/^  '?((?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+)@([0-9][^:'\s]+)'?:$/gm),
    ].map((match) => [match[1], match[2]]),
  )
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: overrides,
      pnpm: { overrides: { ...locked, ...overrides } },
    }),
  )
  run([pnpm, 'install', '--ignore-scripts', '--offline', '--store-dir', store], consumer)
  run(
    [pnpm, 'install', '--ignore-scripts', '--offline', '--frozen-lockfile', '--store-dir', store],
    consumer,
  )
  const cli = join(consumer, 'node_modules/@any-music/plugin-cli/src/cli.mjs')
  const command = (args) => JSON.parse(run([cli, ...args, '--json'], consumer)).result
  const projects = []
  for (const template of ['source-code', 'source-declarative', 'tag-suggestion', 'export']) {
    command(['create', template, '--template', template])
    command(['check', '--project', template])
    try {
      assert.equal(command(['test', '--project', template]).passed, true)
    } catch (error) {
      try {
        run(
          [
            '--input-type=module',
            '-e',
            `import {testProject,snapshotProject} from '@any-music/plugin-cli'; await testProject(await snapshotProject('${template}'))`,
          ],
          consumer,
        )
      } catch (detail) {
        console.error(detail.stderr)
      }
      throw error
    }
    const output = join(consumer, template + '.amplugin'),
      again = join(consumer, template + '-again.amplugin')
    command(['pack', '--project', template, '--reproducible', '--output', output])
    command(['pack', '--project', template, '--reproducible', '--output', again])
    assert.deepEqual(readFileSync(output), readFileSync(again))
    const verified = command(['verify', output])
    assert.equal(verified.publisherVerified, false)
    assert.equal(
      command([
        'migrate',
        'check',
        '--from',
        join(template, 'test/fixtures/migration.json'),
        '--to',
        output,
      ]).passed,
      true,
    )
    projects.push({ template, sha256: verified.contentHash, bytes: readFileSync(output).length })
  }
  // A malicious executable config would fail the process if any installed tool imported it.
  writeFileSync(
    join(consumer, 'source-code/vite.config.ts'),
    "throw new Error('PROJECT CONFIG EXECUTED')",
  )
  assert.equal(command(['check', '--project', 'source-code']).valid, true)
  writeFileSync(
    join(consumer, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
import { createTestVm } from '@any-music/plugin-testkit';
import { PROTOCOL_REGISTRY } from '@any-music/plugin-sdk';
import { decodeProtocolJson } from '@any-music/plugin-sdk/schema';
import { runGuestProgram } from '@any-music/plugin-sdk/host';
import { createHash } from 'node:crypto';
import { readPackage } from '@any-music/plugin-cli';
assert.equal(PROTOCOL_REGISTRY.wireVersion,1);
const pkg=await readPackage('source-code.amplugin');
decodeProtocolJson('PluginManifest',JSON.stringify(pkg.manifest));
const host={state:{async get(){return {value:null,version:0}},async set(input){return {value:input.value,version:input.expectedVersion+1}}},crypto:{async sha256(input){return {hex:createHash('sha256').update(input.text).digest('hex')}}},network:{async request(){throw new Error('Unavailable')},async readResponse(){throw new Error('Unavailable')},async releaseResponse(){}}};
const output=await runGuestProgram({invocation:{operation:'command.run',inputJson:JSON.stringify({query:'live'}),contextRef:'public-host-context',sequence:0,deadlineMs:30000},host,invoke:async input=>{const vm=await createTestVm();try{return JSON.parse(await vm.run(pkg.files.get('dist/main.js').toString(),JSON.stringify(input),undefined,'module'))}finally{vm.dispose()}}});
assert.equal(output.items[0].title,'Live concert');
decodeProtocolJson('WireTrackPage',JSON.stringify(output));
const types=JSON.stringify(pkg.manifest);
assert(!types.includes('workbench'));
`,
  )
  run(['consumer.mjs'], consumer)
  writeFileSync(
    join(consumer, 'consumer.ts'),
    `import { createTestVm } from '@any-music/plugin-testkit'; import type { HostPort, PluginManifest } from '@any-music/plugin-sdk'; export type Contracts = [HostPort, PluginManifest]; export const vm = createTestVm({ ports: { sha256: async input => input, now: () => 0 } });`,
  )
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2023',
        lib: ['ES2023', 'DOM'],
        types: [],
      },
      include: ['consumer.ts'],
    }),
  )
  const authorRequire = createRequire(
    realpathSync(join(consumer, 'node_modules/@any-music/plugin-cli/package.json')),
  )
  run([authorRequire.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer)
  const installed = JSON.parse(
    readFileSync(join(consumer, 'node_modules/@any-music/plugin-testkit/package.json')),
  )
  assert(
    !installed.dependencies?.['@any-music/plugin-vm'],
    'Private VM leaked to released dependency graph',
  )
  // Inventory the installed production dependency closure, not workspace private paths.
  const licenseGroups = JSON.parse(run([pnpm, 'licenses', 'list', '--json']))
  const licenses = new Map(
    Object.values(licenseGroups).flatMap((group) =>
      group.flatMap((pkg) =>
        pkg.versions.map((version) => [pkg.name + '@' + version, pkg.license]),
      ),
    ),
  )
  const graph = JSON.parse(
    run([pnpm, 'list', '--prod', '--depth', 'Infinity', '--json'], consumer),
  )[0]
  const inventory = new Map()
  const excluded = new Map()
  function collect(dependencies) {
    for (const [name, pkg] of Object.entries(dependencies ?? {})) {
      const version = pkg.version
      const key = name + '@' + version
      if (pkg.path && !existsSync(pkg.path)) {
        excluded.set(key, { name, version, reason: 'not installed for the tested target' })
        continue
      }
      if (inventory.has(key)) continue
      const license = name.startsWith('@any-music/') ? 'MIT' : licenses.get(key)
      assert(license, 'Missing license for ' + key)
      inventory.set(key, {
        type: 'library',
        name,
        version,
        licenses: [{ license: { name: license } }],
      })
      collect(pkg.dependencies)
    }
  }
  collect(graph.dependencies)
  for (const name of packages) {
    const component = inventory.get('@any-music/' + name + '@0.1.0')
    assert(component)
    component.hashes = [
      {
        alg: 'SHA-256',
        content: createHash('sha256')
          .update(readFileSync(join(artifacts, 'any-music-' + name + '-0.1.0.tgz')))
          .digest('hex'),
      },
    ]
  }
  const engine = JSON.parse(readFileSync(join(root, 'packages/plugin-vm/engine/build.json')))
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        name: 'Any Music plugin author toolchain',
        version: '0.1.0',
      },
    },
    components: [...inventory.values()].toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    ),
    properties: [
      { name: 'any-music:vm-engine-sha256', value: engine.hashes['quickjs-noeval.wasm'] },
      { name: 'any-music:tested-platform', value: process.platform + '-' + process.arch },
      {
        name: 'any-music:excluded-optional-dependencies',
        value: JSON.stringify([...excluded.values()]),
      },
    ],
  }
  const sbomPath = join(root, 'docs/baselines/plugin-system-s15/toolchain-sbom.json')
  writeFileSync(sbomPath, JSON.stringify(sbom, null, 2) + '\n')
  run([pnpm, 'exec', 'oxfmt', sbomPath])
  const record = {
    date: '2026-10-19',
    runtimeScope: 'repository',
    node: process.version,
    toolVersion: '0.1.0',
    license: 'MIT',
    dependencyComponents: inventory.size,
    wireVersions: [1],
    previousWireMajor: null,
    previousMajorMigrationDays: 180,
    projects,
    offRepository: true,
    applicationLaunched: false,
    browserLaunched: false,
    productionAdmission: false,
  }
  const evidence = resolve(root, 'docs/baselines/plugin-system-s15/tools.json')
  mkdirSync(dirname(evidence), { recursive: true })
  writeFileSync(evidence, JSON.stringify(record, null, 2) + '\n')
  run([pnpm, 'exec', 'oxfmt', evidence])
  console.log(
    `Packed SDK/CLI/testkit: ${projects.length} off-repository templates, exact VM, reproducible archives and no private runtime dependency.`,
  )
  console.log(
    'Artifact SHA-256: ' + createHash('sha256').update(JSON.stringify(projects)).digest('hex'),
  )
} finally {
  assert.equal(relative(parent, consumer), basename(consumer))
  assert(basename(consumer).startsWith('any-music-tools-s15-'))
  if (process.argv.includes('--keep-consumer'))
    writeFileSync(
      join(root, '.tmp/s15/consumer.json'),
      JSON.stringify({
        consumer,
        cli: join(consumer, 'node_modules/@any-music/plugin-cli/src/cli.mjs'),
      }),
    )
  else rmSync(consumer, { recursive: true, force: true })
}
