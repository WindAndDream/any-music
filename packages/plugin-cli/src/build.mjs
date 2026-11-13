import { readFile } from 'node:fs/promises'

import { createTestVm } from '@any-music/plugin-testkit'
import { build } from 'vite'

import { refuse } from './diagnostic.mjs'

/** Fixed virtual graph: Vite never reads project modules, config, .env or package hooks.
 * Source bytes were sealed before resolving; a later path swap cannot affect this build. */
export async function buildGuest(snapshot, entry = snapshot.config.entry) {
  const sdkGuest = await readFile(
    new URL(import.meta.resolve('@any-music/plugin-sdk/guest')),
    'utf8',
  )
  const result = await build({
    configFile: false,
    envDir: false,
    root: snapshot.project.root,
    publicDir: false,
    logLevel: 'silent',
    mode: 'production',
    plugins: [
      {
        name: 'am-sealed-source',
        resolveId(id, importer) {
          if (id === '@any-music/plugin-sdk/guest') return '\0am-sdk.ts'
          if (id === 'am-entry' || id.replaceAll('\\', '/').endsWith('/am-entry'))
            return '\0am:' + entry
          if (id.startsWith('.')) {
            const parts = importer.slice(4).split('/')
            parts.pop()
            for (const part of id.split('/')) {
              if (part === '..') parts.pop()
              else if (part !== '.') parts.push(part)
            }
            let name = parts.join('/')
            if (!name.endsWith('.ts')) name += '.ts'
            if (snapshot.sources.has(name)) return '\0am:' + name
          }
          if (id.startsWith('\0am:')) return id
          refuse('IMPORT_GRAPH', entry, 'An import escaped the sealed source graph.')
        },
        load(id) {
          if (id === '\0am-sdk.ts') return { code: sdkGuest, moduleType: 'ts' }
          if (id.startsWith('\0am:'))
            return { code: snapshot.sources.get(id.slice(4)), moduleType: 'ts' }
        },
      },
    ],
    build: {
      write: false,
      target: 'es2023',
      minify: false,
      sourcemap: false,
      lib: { entry: 'am-entry', formats: ['es'], fileName: () => 'main.js' },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  })
  const output = Array.isArray(result) ? result.flatMap((r) => r.output) : result.output
  if (
    output.length !== 1 ||
    output[0].type !== 'chunk' ||
    output[0].imports.length ||
    output[0].dynamicImports.length
  )
    refuse('BUILD_SHAPE', entry, 'Build must produce one import-free ESM file.')
  const source = output[0].code
  if (Buffer.byteLength(source) > 262144)
    refuse('BUILD_BUDGET', entry, 'Guest entry exceeds the Profile message budget.')
  return source
}

export async function runModule(source, input = null) {
  const vm = await createTestVm()
  try {
    return JSON.parse(await vm.run(source, JSON.stringify(input), undefined, 'module'))
  } finally {
    vm.dispose()
  }
}

export async function testProject(snapshot) {
  if (snapshot.manifest.execution === 'declarative') {
    const data = JSON.parse(snapshot.assets.get('assets/source.json')?.toString() ?? 'null')
    if (!data || !Array.isArray(data.items) || !data.items.length)
      refuse('DECLARATIVE_TEST', 'assets/source.json', 'Declarative source fixture has no items.')
    return { passed: true, cases: ['static-source', 'no-executable-entry'] }
  }
  const source = await buildGuest(snapshot, snapshot.config.test)
  const output = await runModule(source)
  if (!output || output.passed !== true)
    refuse(
      'GUEST_TEST',
      snapshot.config.test,
      'Guest contract tests failed.',
      'Run assertions inside the default test entry function.',
    )
  return output
}
