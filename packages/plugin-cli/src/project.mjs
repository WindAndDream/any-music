import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { negotiatePluginContract } from '@any-music/plugin-sdk'
import { decodeProtocolJson, parseBoundedJson } from '@any-music/plugin-sdk/schema'
import ts from 'typescript'

import { refuse } from './diagnostic.mjs'

export const TOOL_VERSION = '0.1.0'
export const COMPATIBILITY = Object.freeze({
  sdk: TOOL_VERSION,
  cli: TOOL_VERSION,
  testkit: TOOL_VERSION,
  wire: [1],
  previousWire: null,
  previousMajorWindowDays: 180,
  desktop: {
    tools: true,
    productionAdmission: false,
    nativeGate: 'exact OS/WebView/Profile/resources',
    memoryClasses: ['minimum'],
    capabilities: [
      'state.read',
      'state.write',
      'crypto.sha256',
      'network.publicHttps',
      'source.authentication',
    ],
    contributions: ['music.sources catalog'],
    mediaResolution: false,
  },
  mobile: { tools: true, codeAdmission: false, deviceAcceptance: false },
})

/** A pinned root plus no-link opens prevent a changed project from reading arbitrary files.
 * The builder consumes these owned bytes, not the original paths checked earlier. */
export async function openProject(directory) {
  const root = await realpath(directory)
  const identity = await lstat(root)
  const checkRoot = async () => {
    const current = await lstat(root)
    if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
      refuse('PROJECT_CHANGED', '.', 'Selected project directory identity changed.')
  }
  const read = async (path, limit = 262144) => {
    await checkRoot()
    const target = resolve(root, path),
      name = relative(root, target)
    if (!name || isAbsolute(name) || name === '..' || name.startsWith(`..${sep}`))
      refuse('PROJECT_PATH', path, 'Project path escapes the selected root.')
    let current = root
    for (const part of name.split(sep)) {
      current = resolve(current, part)
      // Components must be checked in order before opening the next one.
      // oxlint-disable-next-line no-await-in-loop
      if ((await lstat(current)).isSymbolicLink())
        refuse('PROJECT_LINK', path, 'Project links are not allowed.')
    }
    const before = await lstat(target)
    if (!before.isFile() || before.size > limit)
      refuse('FILE_BUDGET', path, 'File exceeds its budget or is not a regular file.')
    const handle = await open(target, 'r')
    try {
      const pinned = await handle.stat()
      if (
        pinned.dev !== before.dev ||
        pinned.ino !== before.ino ||
        (await realpath(target)) !== target
      )
        refuse('PROJECT_CHANGED', path, 'File identity changed during snapshot.')
      const bytes = Buffer.alloc(limit + 1)
      const { bytesRead } = await handle.read(bytes, 0, limit + 1, 0)
      const after = await handle.stat()
      if (bytesRead > limit || after.size !== pinned.size || after.mtimeMs !== pinned.mtimeMs)
        refuse('FILE_CHANGED', path, 'File changed during snapshot or exceeds its budget.')
      await checkRoot()
      // Retain only the contents, not a view pinning the full per-file read budget.
      return Buffer.from(bytes.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }
  const json = async (path) =>
    parseBoundedJson(new TextDecoder('utf-8', { fatal: true }).decode(await read(path)))
  return { root, read, json, checkRoot }
}

export function hostCapabilities(target = 'desktop', execution = 'sandbox-code') {
  if (!['desktop', 'mobile'].includes(target))
    refuse('TARGET', 'target', 'Unknown target.', 'Choose desktop or mobile.', 2)
  return {
    sdkVersion: TOOL_VERSION,
    manifestVersions: [1],
    wireVersions: [1],
    runtimeProfileVersions: [1],
    contributionVersions: [1],
    packageFormatVersions: [1],
    dataSchemaVersions: [1],
    form: target,
    externalPlugins: execution,
    sandboxAvailable: target === 'desktop',
    capabilities: [
      'state.read',
      'state.write',
      'crypto.sha256',
      'network.publicHttps',
      'source.authentication',
    ].map((id) => ({ id, versions: [1] })),
    extensionPoints: target === 'desktop' ? [{ id: 'music.sources', versions: [1] }] : [],
  }
}
export function checkCompatibility(manifest, target) {
  try {
    if (
      target === 'desktop' &&
      (manifest.memoryClass !== 'minimum' ||
        manifest.contributions.some(
          (c) =>
            c.required &&
            !(
              c.pointId === 'music.sources' &&
              c.providerId === manifest.id &&
              manifest.commands.some((command) => command.id === 'search')
            ),
        ))
    )
      throw Error('Unsupported required host contribution or memory class')
    return negotiatePluginContract(manifest, hostCapabilities(target, manifest.execution))
  } catch {
    refuse(
      'TARGET_INCOMPATIBLE',
      'plugin.json',
      'Required contract, Profile or capability is unavailable on target.',
      'Review doctor compatibility and required capabilities; code is not admitted on mobile.',
      4,
    )
  }
}

const forbidden = new Set([
  'window',
  'document',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'process',
  'require',
  'eval',
  'Function',
  'global',
  'globalThis',
  'Deno',
  'Bun',
  'WebAssembly',
  'importScripts',
])
/** Conservative author lint is an early diagnostic, never the execution security boundary. */
export function inspectSource(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (ast.parseDiagnostics.length) refuse('SOURCE_SYNTAX', path, 'Invalid source syntax.')
  const imports = []
  const visit = (node) => {
    if (ts.isIdentifier(node) && forbidden.has(node.text))
      refuse(
        'PROFILE_GLOBAL',
        path,
        `Global ${node.text} is unavailable.`,
        'Use public SDK host ports or Profile pure tools.',
      )
    if (node.kind === ts.SyntaxKind.ImportKeyword || ts.isMetaProperty(node))
      refuse('DYNAMIC_IMPORT', path, 'Dynamic import/import.meta is unavailable.')
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier))
        refuse('IMPORT', path, 'Import must be a static string.')
      const specifier = node.moduleSpecifier.text
      const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly
      if (
        ([
          '@any-music/plugin-sdk',
          '@any-music/plugin-sdk/music',
          '@any-music/plugin-sdk/guest',
        ].includes(specifier) &&
          typeOnly) ||
        specifier === '@any-music/plugin-sdk/guest'
      ) {
        /* erased SDK DTOs */
      } else if (!specifier.startsWith('./') && !specifier.startsWith('../'))
        refuse(
          'IMPORT',
          path,
          'Only local source and SDK type imports are supported.',
          'Keep pure dependencies as reviewed local sources.',
        )
      else imports.push(specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return imports
}

export async function snapshotProject(directory, target = 'desktop') {
  const project = await openProject(directory)
  const manifest = decodeProtocolJson(
    'PluginManifest',
    new TextDecoder().decode(await project.read('plugin.json')),
  )
  checkCompatibility(manifest, target)
  const config = await project.json('plugin.config.json')
  if (
    config === null ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    Object.keys(config).some((key) => !['version', 'entry', 'test', 'assets'].includes(key)) ||
    config.version !== 1 ||
    config.entry !== 'src/main.ts' ||
    config.test !== 'test/main.test.ts' ||
    !Array.isArray(config.assets) ||
    config.assets.length > 100
  )
    refuse(
      'CONFIG',
      'plugin.config.json',
      'Unsupported build configuration.',
      'Use version 1 JSON configuration; executable hooks are not supported.',
      2,
    )
  const sources = new Map()
  async function collect(path) {
    if (sources.has(path)) return
    if (sources.size >= 100 || !/^(src|test)\/[a-zA-Z0-9_./-]+\.ts$/.test(path))
      refuse('SOURCE_PATH', path, 'Unsupported source path or graph budget.')
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(await project.read(path))
    sources.set(path, raw)
    for (const specifier of inspectSource(raw, path)) {
      const resolved = relative(
        project.root,
        resolve(project.root, path, '..', specifier),
      ).replaceAll('\\', '/')
      // oxlint-disable-next-line no-await-in-loop
      await collect(resolved.endsWith('.ts') ? resolved : resolved + '.ts')
    }
  }
  if (manifest.execution === 'sandbox-code') {
    await collect(config.entry)
    await collect(config.test)
  }
  const assets = new Map()
  for (const path of config.assets) {
    if (typeof path !== 'string' || !path.startsWith('assets/'))
      refuse('ASSET', 'plugin.config.json', 'Asset paths must be local assets/.')
    // oxlint-disable-next-line no-await-in-loop
    assets.set(path, await project.read(path, 8 * 1024 * 1024))
  }
  // Metadata is never imported, and package scripts are never executed.
  const metadata = await project.json('package.json')
  const lock = await project.read('pnpm-lock.yaml', 8 * 1024 * 1024)
  if (!lock.length || metadata.dependencies?.['@any-music/plugin-sdk'] !== TOOL_VERSION)
    refuse('TOOLCHAIN', 'package.json', 'SDK must be pinned and a lockfile must be present.')
  await project.checkRoot()
  return { project, manifest, config, sources, assets }
}
