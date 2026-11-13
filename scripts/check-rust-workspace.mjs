import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const matrix = JSON.parse(readFileSync(new URL('./native-targets.json', import.meta.url), 'utf8'))

/** Metadata cannot reveal std's IO/clock modules; also guard the trusted pure source boundary. */
export function checkPureSource(source, path) {
  assert(
    !/\bstd\s*::\s*(?:fs|net|io|time|process|env|thread)\b/.test(source),
    `IO/clock in pure source: ${path}`,
  )
  for (const group of source.matchAll(/\bstd\s*::\s*\{([^;]+)\}/g)) {
    assert(
      !/\b(?:fs|net|io|time|process|env|thread)\b/.test(group[1]),
      `Grouped IO/clock import in pure source: ${path}`,
    )
  }
}

function inspectPureDirectory(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) inspectPureDirectory(child)
    else if (child.endsWith('.rs')) checkPureSource(readFileSync(child, 'utf8'), child)
  }
}

export function checkGraph(metadata) {
  const packages = new Map(metadata.packages.map((entry) => [entry.id, entry]))
  const nodes = new Map(metadata.resolve.nodes.map((entry) => [entry.id, entry]))
  const members = metadata.workspace_members.map((id) => packages.get(id).name).toSorted()
  assert.deepEqual(members, [
    'am-plugin-net',
    'am-plugin-package',
    'am-plugin-policy',
    'am-plugin-protocol',
    'am-plugin-runtime',
    'any-music-tauri',
  ])
  const pureAllowed = new Set([
    'am-plugin-policy',
    'am-plugin-protocol',
    'am-plugin-runtime',
    'serde',
    'serde_core',
    'serde_derive',
    'serde_json',
    'itoa',
    'memchr',
    'zmij',
    'proc-macro2',
    'quote',
    'syn',
    'unicode-ident',
  ])
  const closures = {}
  const net = metadata.packages.find((entry) => entry.name === 'am-plugin-net')
  const netVisited = new Set()
  function inspectNet(id) {
    if (netVisited.has(id)) return
    netVisited.add(id)
    const entry = packages.get(id)
    assert(
      !/^(?:tauri|any-music-tauri|am-plugin-runtime|keyring|rusqlite|reqwest_cookie_store)/.test(
        entry.name,
      ),
      `Forbidden anonymous transport dependency: ${entry.name}`,
    )
    for (const dep of nodes.get(id).deps)
      if (dep.dep_kinds.some((kind) => kind.kind !== 'dev')) inspectNet(dep.pkg)
  }
  inspectNet(net.id)
  const packageCrate = metadata.packages.find((entry) => entry.name === 'am-plugin-package')
  const packageVisited = new Set()
  function inspectPackage(id) {
    if (packageVisited.has(id)) return
    packageVisited.add(id)
    const entry = packages.get(id)
    assert(
      !/^(?:tauri|any-music-tauri|am-plugin-runtime|am-plugin-net|reqwest|tokio|keyring|rusqlite)/.test(
        entry.name,
      ),
      `Forbidden package verifier dependency: ${entry.name}`,
    )
    for (const dep of nodes.get(id).deps)
      if (dep.dep_kinds.some((kind) => kind.kind !== 'dev')) inspectPackage(dep.pkg)
  }
  for (const name of ['am-plugin-protocol', 'am-plugin-policy', 'am-plugin-runtime']) {
    const start = metadata.packages.find((entry) => entry.name === name)
    const visited = new Set()
    function walk(id, ancestors) {
      assert(!ancestors.has(id), `Cargo dependency cycle: ${id}`)
      if (visited.has(id)) return
      visited.add(id)
      const entry = packages.get(id)
      assert(
        pureAllowed.has(entry.name),
        `${name} has forbidden transitive dependency: ${entry.name}`,
      )
      for (const dep of nodes.get(id).deps)
        if (dep.dep_kinds.some((kind) => kind.kind !== 'dev'))
          walk(dep.pkg, new Set([...ancestors, id]))
    }
    walk(start.id, new Set())
    closures[name] = [...visited].map((id) => packages.get(id).name).toSorted()
    if (name === 'am-plugin-protocol') assert(!closures[name].includes('am-plugin-policy'))
    if (name !== 'am-plugin-runtime') assert(!closures[name].includes('am-plugin-runtime'))
  }
  inspectPackage(packageCrate.id)
  return closures
}

export function inspectWorkspace() {
  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 24 * 1024 * 1024,
    }),
  )
  assert.equal(resolve(metadata.workspace_root), resolve(root))
  assert.equal(resolve(metadata.target_directory), resolve(root, 'target'))
  assert.deepEqual(
    metadata.workspace_default_members.map(
      (id) => metadata.packages.find((entry) => entry.id === id).name,
    ),
    ['any-music-tauri'],
  )
  assert(
    !existsSync(resolve(root, 'apps/tauri/src-tauri/Cargo.lock')),
    'Only the root Cargo.lock may exist',
  )
  for (const id of metadata.workspace_members) {
    const entry = metadata.packages.find((candidate) => candidate.id === id)
    assert.equal(entry.edition, '2024')
    assert.equal(entry.rust_version, '1.90')
    assert.deepEqual(
      entry.features,
      entry.name === 'any-music-tauri' ? { 's03-isolation-probe': [], 's15-acceptance': [] } : {},
      `Unreviewed features in ${entry.name}`,
    )
  }
  const app = metadata.packages.find((entry) => entry.name === 'any-music-tauri')
  assert(
    app.targets.some(
      (target) => target.name === 'any_music_tauri_lib' && target.crate_types.includes('staticlib'),
    ),
  )
  assert(
    app.targets.some(
      (target) => target.name === 'douyin-login-experiment' && target.kind.includes('example'),
    ),
  )
  for (const release of matrix.releases) {
    assert.equal(release.defaultFeatures, false)
    assert.deepEqual(release.features, ['tauri/custom-protocol'])
    assert(metadata.packages.some((entry) => entry.name === release.package))
  }
  const closures = checkGraph(metadata)
  for (const name of ['am-plugin-protocol', 'am-plugin-policy', 'am-plugin-runtime'])
    inspectPureDirectory(resolve(root, 'crates', name, 'src'))
  console.log(
    JSON.stringify(
      { workspace: membersSummary(metadata), releaseMatrix: matrix, pureClosures: closures },
      null,
      2,
    ),
  )
  return { metadata, closures }
}
function membersSummary(metadata) {
  return metadata.workspace_members.map(
    (id) => metadata.packages.find((entry) => entry.id === id).name,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  inspectWorkspace()
