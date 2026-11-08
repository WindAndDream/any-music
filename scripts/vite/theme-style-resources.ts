import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.name.endsWith('.vue')
        ? [join(directory, entry.name)]
        : [],
  )
}

/** Match template scope IDs with independently bundled Shadow-root style resources. */
export function themeComponentId(
  root: string,
  filename: string,
  app?: 'userscript' | 'tauri',
): string {
  const absolute = app ? resolve(root, `apps/${app}`, filename) : filename
  return createHash('sha256')
    .update(relative(root, absolute).replaceAll('\\', '/'))
    .digest('hex')
    .slice(0, 8)
}

/** Build-known SFC styles are values, activated by the theme transaction, never document CSS. */
export function themeStyleResources(root: string, app: 'userscript' | 'tauri') {
  const themeRoots = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('theme-'))
    .map((entry) => [entry.name.slice('theme-'.length), [`packages/${entry.name}/src`]] as const)
  if (themeRoots.some(([id]) => id === 'host')) throw new Error('Theme ID host is reserved')
  const roots: Record<string, readonly string[]> = {
    host: [
      'packages/ui/src',
      'packages/card-styles/src',
      'packages/music-workbench/src',
      'packages/plugin-ui-vue/src',
      'packages/plugin-tag-management/src',
      'packages/plugin-music-creation/src',
      `apps/${app}/src`,
    ],
    ...Object.fromEntries(themeRoots),
  }
  const prefix = 'virtual:any-music-theme-styles/'
  const managed = (filename: string) =>
    Object.values(roots)
      .flat()
      .some((directory) =>
        filename
          .replaceAll('\\', '/')
          .startsWith(join(root, directory).replaceAll('\\', '/') + '/'),
      )
  return {
    name: 'any-music-theme-style-resources',
    enforce: 'post' as const,
    resolveId(id: string) {
      if (id.startsWith(prefix)) return '\0' + id
    },
    load(this: { addWatchFile(path: string): void }, id: string) {
      if (!id.startsWith('\0' + prefix)) return
      const group = id.slice(prefix.length + 1)
      if (!Object.hasOwn(roots, group)) throw new Error('Unknown build-owned style group')
      const imports: string[] = []
      for (const file of roots[group]!.flatMap((directory) =>
        files(join(root, directory)),
      ).toSorted()) {
        this.addWatchFile(file)
        const source = readFileSync(file, 'utf8')
        const styles = [...source.matchAll(/<style\b([^>]*)>/g)]
        for (const [index, match] of styles.entries()) {
          const attrs = match[1] ?? ''
          if (/\bsrc\s*=/.test(attrs))
            throw new Error('Theme style resources require local SFC styles')
          const lang = /\blang=["']([^"']+)/.exec(attrs)?.[1] ?? 'css'
          const scope = /\bscoped\b/.test(attrs) ? `&scoped=${themeComponentId(root, file)}` : ''
          const request = `${file.replaceAll('\\', '/')}?vue&type=style&index=${index}${scope}&inline&lang.${lang}`
          imports.push(`import css${imports.length} from ${JSON.stringify(request)}`)
        }
      }
      return `${imports.join('\n')}\nexport default [${imports.map((_, index) => `css${index}`).join(',')}].join('\\n')`
    },
    transform(code: string, id: string) {
      if (!id.endsWith('.vue') || !managed(id)) return
      // The same compiled styles enter the explicitly loaded resource instead.
      return {
        code: code.replace(/^import\s+["'][^"']+\?vue&type=style[^"']*["'];?\s*$/gm, ''),
        map: null,
      }
    },
  }
}

/** Evidence from the real build graph, before Userscript chunks become SystemJS registrations. */
export function themeBundleAudit(root: string, app: 'userscript' | 'tauri') {
  return {
    name: 'any-music-theme-bundle-audit',
    apply: 'build' as const,
    generateBundle(this: {
      getModuleIds(): IterableIterator<string>
      getModuleInfo(id: string): { importedIds: readonly string[] } | null
      emitFile(asset: { type: 'asset'; fileName: string; source: string }): void
    }) {
      const ids = [...this.getModuleIds()]
      const normalize = (id: string) =>
        id.startsWith('\0') ? id.slice(1) : relative(root, id).replaceAll('\\', '/')
      const closure = (suffix: string) => {
        const entry = ids.find((id) => normalize(id) === `apps/${app}/src/${suffix}`)
        if (!entry) throw new Error(`Missing build graph entry: ${suffix}`)
        const seen = new Set<string>()
        const visit = (id: string) => {
          if (seen.has(id)) return
          seen.add(id)
          for (const child of this.getModuleInfo(id)?.importedIds ?? []) visit(child)
        }
        visit(entry)
        return [...seen].map(normalize).toSorted()
      }
      const startup = closure(app === 'userscript' ? 'bootstrap-userscript-app.ts' : 'main.ts')
      const metadata = closure('features/plugins/built-in-theme-directory.ts')
      if (metadata.some((id) => /\.vue|\.s?css|\/vue(?:\/|\.)|virtual:/.test(id)))
        throw new Error('Theme metadata executes presentation')
      const optionalThemes = readdirSync(join(root, 'packages'), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith('theme-') &&
            entry.name !== 'theme-default',
        )
        .map((entry) => entry.name)
        .toSorted()
      if (
        startup.some(
          (id) =>
            optionalThemes.some((name) => id.startsWith(`packages/${name}/`)) &&
            !metadata.includes(id),
        )
      )
        throw new Error('An unselected optional theme executes during startup')
      this.emitFile({
        type: 'asset',
        fileName: 'theme-build-audit.json',
        source: JSON.stringify(
          {
            schemaVersion: 2,
            app,
            fallback: 'default',
            optionalThemes: optionalThemes.map((name) => name.slice('theme-'.length)),
            metadata,
            startup,
            documentStart: app === 'userscript' ? closure('main.ts') : undefined,
          },
          null,
          2,
        ),
      })
    },
  }
}
