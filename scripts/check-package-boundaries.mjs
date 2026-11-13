import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

/** Compare resolved paths without coupling ownership checks to the host's separator. */
function isOutsidePackage(directory, path) {
  const location = relative(directory, path)
  return location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)
}

/** Match declared subpaths, including export patterns; private source paths remain forbidden. */
function hasPublicExport(manifest, subpath) {
  subpath = subpath.split('?')[0]
  // An exact null export blocks a path even when a broader pattern would otherwise match.
  if (Object.hasOwn(manifest?.exports ?? {}, subpath)) return manifest.exports[subpath] !== null
  return Object.entries(manifest?.exports ?? {}).some(([key, value]) => {
    if (value === null) return false
    if (key === subpath) return true
    const wildcard = key.indexOf('*')
    return (
      wildcard >= 0 &&
      subpath.startsWith(key.slice(0, wildcard)) &&
      subpath.endsWith(key.slice(wildcard + 1))
    )
  })
}

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.(ts|mjs|vue|s?css)$/.test(entry.name)) yield path
  }
}

/** Parse imports rather than scanning comments, strings and protocol examples as code. */
function imports(file) {
  let source = readFileSync(file, 'utf8')
  const styles = /\.(?:s?css|vue)$/.test(file)
    ? [...source.matchAll(/@(?:use|forward|import)\s+["']([^"']+)["']/g)].map((match) => ({
        specifier: match[1],
        isStatic: true,
      }))
    : []
  if (/\.s?css$/.test(file)) return styles
  if (file.endsWith('.vue'))
    source = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1])
      .join('\n')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const entries = [...styles]
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause
      const typeOnly =
        (ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly) ||
        (bindings &&
          (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((entry) => entry.isTypeOnly))
      entries.push({
        specifier: node.moduleSpecifier.text,
        isStatic: !typeOnly,
        isTypeOnly: Boolean(typeOnly),
      })
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      let parent = node.parent
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent
      entries.push({ specifier: node.arguments[0].text, isStatic: !parent })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return entries
}

/** Validate shared source ownership and lightweight graphs without starting an application. */
export function checkPackageBoundaries(root, { themesOnly = false } = {}) {
  // Every independently owned theme follows the same contract, including future packages.
  const themePackages = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('theme-'))
    .map((entry) => entry.name)
  const allowed = {
    'audio-composition': [],
    core: ['audio-composition'],
    ui: ['core', 'audio-composition'],
    ...Object.fromEntries(themePackages.map((name) => [name, ['ui', 'core', 'card-styles']])),
    'card-styles': ['ui', 'core'],
    'plugin-source-bilibili': ['core', 'plugin-center'],
    'plugin-source-douyin': ['core', 'plugin-center'],
    'plugin-source-netease': ['core', 'plugin-center'],
    'plugin-center': ['core'],
    'plugin-sdk': [],
    'plugin-vm': ['plugin-sdk'],
    'plugin-sandbox-browser': ['plugin-sdk', 'plugin-vm'],
    'plugin-testkit': ['plugin-sdk', 'plugin-vm'],
    'plugin-cli': ['plugin-sdk', 'plugin-testkit'],
    'plugin-ui-vue': ['ui', 'plugin-sdk'],
    'plugin-tag-management': ['core', 'ui', 'plugin-center'],
    'plugin-music-creation': ['core', 'ui', 'plugin-center'],
    'network-routing': [],
    'account-pool': ['network-routing'],
    'music-workbench': [
      'core',
      'audio-composition',
      'ui',
      'plugin-center',
      'plugin-sdk',
      'plugin-ui-vue',
    ],
  }
  const errors = []
  const manifests = new Map(
    Object.keys(allowed)
      .filter(
        (name) =>
          !name.startsWith('theme-') || existsSync(resolve(root, 'packages', name, 'package.json')),
      )
      .map((name) => [
        name,
        JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8')),
      ]),
  )
  const report = (file, message) => errors.push(`${relative(root, file)}: ${message}`)

  for (const [name, dependencies] of Object.entries(allowed)) {
    if (!manifests.has(name) || (themesOnly && !name.startsWith('theme-'))) continue
    const directory = resolve(root, 'packages', name)
    const manifest = manifests.get(name)
    const declared = name.startsWith('theme-')
      ? { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
      : { ...manifest.dependencies, ...manifest.peerDependencies }
    for (const [dependency, version] of Object.entries(declared)) {
      if (
        dependency.startsWith('@any-music/') &&
        !dependencies.includes(dependency.slice('@any-music/'.length))
      )
        report(directory, `disallowed dependency ${dependency}`)
      if (dependency.startsWith('@any-music/') && version !== 'workspace:*')
        report(directory, `internal dependency must use workspace:*: ${dependency}`)
    }
    if (name.startsWith('theme-')) {
      const expected = {
        '.': './src/index.ts',
        './vue': './src/vue.ts',
        './styles': './src/styles/index.scss',
      }
      if (
        JSON.stringify(Object.entries(manifest.exports ?? {}).toSorted()) !==
        JSON.stringify(Object.entries(expected).toSorted())
      )
        report(
          directory,
          'themes expose only metadata ., /vue and /styles at their canonical public entries',
        )
      for (const target of Object.values(expected)) {
        if (!existsSync(resolve(directory, target)))
          report(directory, `missing public theme entry ${target}`)
      }
    }
    for (const file of files(resolve(directory, 'src'))) {
      // Inspect style headers only: prose and TypeScript string literals are not selectors.
      const source = readFileSync(file, 'utf8')
      const styles = /\.s?css$/.test(file)
        ? source
        : file.endsWith('.vue')
          ? [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
              .map((match) => match[1])
              .join('\n')
          : ''
      const headers = [
        ...styles.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').matchAll(/([^{}]+)\{/g),
      ]
        .map((match) => match[1])
        .join('\n')
      if (
        name === 'ui' &&
        /\.(?:am-theme-[\w-]+|workbench(?:__|--|\b)|product-view|product-top-bar|global-settings|track__)[\w-]*/.test(
          headers,
        )
      )
        report(file, 'neutral UI styles must not contain theme page or row selectors')
      if (name.startsWith('theme-')) {
        const ownScope = `am-${name}`
        for (const [, scope] of headers.matchAll(/\.(am-theme-[\w-]+)/g)) {
          if (scope !== ownScope) report(file, `cross-theme style selector ${scope}`)
        }
      }
      for (const { specifier, isTypeOnly } of imports(file)) {
        if (
          specifier === '@any-music/plugin-ui-vue/trusted/presentation' ||
          /@any-music\/ui\/components\/(?:PresentationBoundary|music-sources\/(?:DefaultTrackRow|TrackRow))\.vue$/.test(
            specifier,
          )
        )
          report(file, `retired partial theme import ${specifier}`)
        if (['core', 'ui'].includes(name) && specifier === '@any-music/audio-composition/browser')
          report(file, 'domain/UI code must use the pure audio entry')
        if (specifier === '$' || specifier.startsWith('@/'))
          report(file, `application runtime import ${specifier}`)
        if (
          (name.startsWith('theme-') ||
            [
              'music-workbench',
              'ui',
              'core',
              'plugin-ui-vue',
              'plugin-tag-management',
              'plugin-music-creation',
              'plugin-source-bilibili',
              'plugin-source-douyin',
              'plugin-source-netease',
              'plugin-vm',
              'plugin-sandbox-browser',
            ].includes(name)) &&
          (specifier.startsWith('node:') ||
            specifier.startsWith('@tauri-apps/') ||
            specifier === 'electron')
        )
          report(file, 'workbench must inject native runtime capabilities')
        if (name.startsWith('theme-') && specifier.startsWith('@any-music/core') && !isTypeOnly)
          report(file, 'theme core dependencies must be public types only')
        if (
          name.startsWith('theme-') &&
          (specifier === '@any-music/audio-composition/browser' ||
            (!specifier.startsWith('.') &&
              !specifier.startsWith('@any-music/') &&
              specifier !== 'vue'))
        )
          report(
            file,
            `theme must consume controlled UI contracts, not runtime dependency ${specifier}`,
          )
        if (['account-pool', 'network-routing'].includes(name) && specifier.startsWith('node:'))
          report(file, `portable routing imports Node runtime ${specifier}`)
        if (
          name === 'plugin-sdk' &&
          !specifier.startsWith('.') &&
          !(file.replaceAll('\\', '/').includes('/src/node/') && specifier.startsWith('node:'))
        )
          report(file, `SDK production imports must be local: ${specifier}`)
        if (
          specifier.startsWith('.') &&
          isOutsidePackage(directory, resolve(dirname(file), specifier))
        )
          report(file, `relative import escapes package: ${specifier}`)
        if (!specifier.startsWith('@any-music/')) continue
        const dependency = specifier.split('/').slice(0, 2).join('/')
        if (!dependencies.includes(dependency.slice('@any-music/'.length)))
          report(file, `disallowed internal import ${specifier}`)
        if (
          !manifest.dependencies?.[dependency] &&
          !(
            name === 'plugin-testkit' &&
            dependency === '@any-music/plugin-vm' &&
            manifest.devDependencies?.[dependency]
          )
        )
          report(file, `undeclared dependency ${dependency}`)
        const target = manifests.get(dependency.slice('@any-music/'.length))
        const subpath = specifier.slice(dependency.length)
        if (!hasPublicExport(target, subpath ? `.${subpath}` : '.'))
          report(file, `private or unknown export ${specifier}`)
      }
    }
  }

  // Check the actual declared graph as well as individual import edges.
  const visitedPackages = new Set()
  function visitPackage(name, stack = []) {
    if (stack.includes(name)) {
      report(
        resolve(root, 'packages', name),
        `package dependency cycle: ${[...stack, name].join(' -> ')}`,
      )
      return
    }
    if (visitedPackages.has(name)) return
    const manifest = manifests.get(name)
    for (const dependency of Object.keys({
      ...manifest?.dependencies,
      ...manifest?.peerDependencies,
    })) {
      if (dependency.startsWith('@any-music/'))
        visitPackage(dependency.slice('@any-music/'.length), [...stack, name])
    }
    visitedPackages.add(name)
  }
  for (const name of manifests.keys()) {
    if (!themesOnly || name.startsWith('theme-')) visitPackage(name)
  }

  function resolveModule(file, specifier) {
    specifier = specifier.split('?')[0]
    if (specifier.startsWith('.')) {
      const path = resolve(dirname(file), specifier)
      return [path, `${path}.ts`, `${path}.vue`, `${path}.scss`, resolve(path, 'index.ts')].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
      )
    }
    if (!specifier.startsWith('@any-music/')) return undefined
    const name = specifier.split('/')[1]
    const subpath = specifier.split('/').slice(2).join('/')
    const entry = manifests.get(name)?.exports?.[subpath ? `./${subpath}` : '.']
    return typeof entry === 'string' ? resolve(root, 'packages', name, entry) : undefined
  }

  const lightweightEntries = [
    'ui/src/theme.ts',
    'card-styles/src/index.ts',
    ...themePackages.map((name) => `${name}/src/index.ts`),
    'audio-composition/src/index.ts',
    'plugin-center/src/index.ts',
    'plugin-tag-management/src/index.ts',
    'plugin-music-creation/src/index.ts',
    'plugin-ui-vue/src/trusted/theme-directory.ts',
    'music-workbench/src/index.ts',
    'plugin-sdk/src/index.ts',
    'plugin-sdk/src/music.ts',
    'plugin-sdk/src/schema/index.ts',
    'plugin-vm/src/profile.ts',
    'plugin-vm/src/control.ts',
    'plugin-sandbox-browser/src/index.ts',
    'plugin-source-bilibili/src/index.ts',
    'plugin-source-douyin/src/index.ts',
    'plugin-source-netease/src/index.ts',
    'network-routing/src/index.ts',
    'account-pool/src/index.ts',
  ]
  for (const entry of lightweightEntries) {
    if (!existsSync(resolve(root, 'packages', entry))) continue
    if (themesOnly && !entry.startsWith('theme-') && entry !== 'ui/src/theme.ts') continue
    const visited = new Set()
    function walk(file) {
      if (visited.has(file)) return
      visited.add(file)
      for (const { specifier, isStatic } of imports(file)) {
        if (!isStatic) continue
        if (
          (entry.startsWith('theme-') || entry === 'ui/src/theme.ts') &&
          specifier.startsWith('@any-music/') &&
          specifier !== '@any-music/ui/theme'
        )
          report(file, `${entry} eagerly loads business or presentation ${specifier}`)
        if (
          (entry === 'plugin-source-bilibili/src/index.ts' ||
            entry === 'plugin-source-douyin/src/index.ts' ||
            entry === 'plugin-source-netease/src/index.ts') &&
          /(?:-api|-plugin|signature|a-bogus|sm3|runtime)\.ts$/.test(file)
        )
          report(file, `${entry} eagerly loads source implementation`)
        if (
          /^(mediabunny|@mediabunny\/|vue$|\$$|ajv(?:\/|$)|quickjs|@jitl\/|node:|@tauri-apps\/|electron$)/.test(
            specifier,
          )
        )
          report(file, `${entry} eagerly loads ${specifier}`)
        if (/\.(?:s?css|vue)$/.test(specifier))
          report(file, `${entry} eagerly loads presentation ${specifier}`)
        const dependency = resolveModule(file, specifier)
        if (
          dependency?.endsWith('douyin-request-state.ts') ||
          dependency?.includes(`${resolve(root, 'packages/audio-composition/src/browser')}`)
        )
          report(file, `${entry} eagerly loads a browser implementation`)
        if (dependency) walk(dependency)
      }
    }
    walk(resolve(root, 'packages', entry))
  }

  for (const app of ['userscript', 'tauri']) {
    const directory = resolve(root, 'apps', app)
    if (!existsSync(resolve(directory, 'src'))) continue
    for (const file of files(resolve(directory, 'src'))) {
      for (const { specifier } of imports(file)) {
        const themeName = specifier.split('/')[1]
        if (
          specifier.startsWith('@any-music/theme-') &&
          !hasPublicExport(
            manifests.get(themeName),
            specifier.split('/').length > 2 ? `./${specifier.split('/').slice(2).join('/')}` : '.',
          )
        )
          report(file, `private or unknown theme export ${specifier}`)
        if (
          specifier.startsWith('@any-music/plugin-testkit') ||
          specifier.startsWith('@any-music/plugin-cli')
        )
          report(file, 'production applications cannot import testkit or CLI')
      }
    }
  }

  return errors
}

/** Reused by plugin/mobile isolation checks: built-in UI packages grant no runtime authority. */
export function checkThemePackageBoundaries(root) {
  return checkPackageBoundaries(root, { themesOnly: true })
}

// Importing this module for fixture tests must not inspect or mutate the real workspace.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkPackageBoundaries(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Shared package dependency and lightweight entry boundaries passed.')
  }
}
