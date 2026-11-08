import { posix, relative } from 'node:path'

interface ThemeChunk {
  fileName: string
  modules: Record<string, unknown>
}

/** WebViews cache failed ESM loads. Retry only build-owned optional theme entries with fresh URLs. */
export function retryableThemeImports(root: string) {
  return {
    name: 'any-music-retryable-theme-imports',
    apply: 'build' as const,
    enforce: 'post' as const,
    renderChunk(
      code: string,
      chunk: ThemeChunk,
      _options: unknown,
      meta: { chunks: Record<string, ThemeChunk> },
    ) {
      const chunks = Object.values(meta.chunks)
      const optional = new Set(
        chunks
          .filter((candidate) =>
            Object.keys(candidate.modules).some((id) => {
              const path = id.startsWith('\0')
                ? id.slice(1)
                : relative(root, id).replaceAll('\\', '/')
              return (
                /^packages\/theme-(?!default\/)[^/]+\/src\/(?:vue\.|styles\/)/.test(path) ||
                /^virtual:any-music-theme-styles\/(?!host$|default$)/.test(path)
              )
            }),
          )
          .map((candidate) => candidate.fileName),
      )
      let changed = false
      const rewritten = code.replace(
        /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g,
        (original, _quote, specifier: string) => {
          if (!optional.has(posix.join(posix.dirname(chunk.fileName), specifier))) return original
          changed = true
          return `__amImportTheme(new URL(${JSON.stringify(specifier)},import.meta.url).href)`
        },
      )
      if (!changed) return null
      if (code.includes('__amImportTheme')) throw new Error('Theme import helper name collision')
      // Successful definitions/styles keep one module identity. Only rejected loads get another URL.
      return {
        code: `const __amThemeImports=new Map();function __amImportTheme(url){let pending=__amThemeImports.get(url);if(!pending){pending=import(url+'?am-theme-attempt='+crypto.randomUUID()).catch(error=>{__amThemeImports.delete(url);throw error});__amThemeImports.set(url,pending)}return pending}\n${rewritten}`,
        map: null,
      }
    },
  }
}
