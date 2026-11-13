import { cp, mkdir, writeFile } from 'node:fs/promises'

import { build } from 'vite'

// Embed the exact production VM and loader, not a second evaluator or Node guest import.
// Only the build rewrites the workspace-only WASM lookup to the shipped immutable asset.
await build({
  configFile: false,
  envDir: false,
  publicDir: false,
  logLevel: 'warn',
  plugins: [
    {
      name: 'am-shipped-engine',
      enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/test-host.ts'))
          return code.replace(
            "createRequire(import.meta.url).resolve('@any-music/plugin-vm/engine.wasm')",
            "new URL(/* @vite-ignore */ './engine/quickjs-noeval.wasm', import.meta.url)",
          )
      },
    },
  ],
  build: {
    target: 'node24',
    minify: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    rolldownOptions: { external: [/^node:/], output: { codeSplitting: false } },
  },
})
await mkdir('dist/engine', { recursive: true })
await Promise.all(
  ['quickjs-noeval.wasm', 'LICENSE-quickjs', 'LICENSE-bindings', 'build.json', 'profile.json'].map(
    (file) => cp('../plugin-vm/engine/' + file, 'dist/engine/' + file),
  ),
)
// Public declarations mirror the deliberately small test host contract; no private VM package
// name leaks to an installed consumer. Changes are checked by the off-repository type fixture.
await writeFile(
  'dist/index.d.ts',
  `
export interface TestVm { readonly disposed: boolean; readonly pendingCount: number; dispose(): void; run(source: string, inputJson?: string, signal?: AbortSignal, format?: 'body' | 'module'): Promise<string> }
export interface TestVmOptions { budget?: Partial<Record<'heapBytes'|'executionMs'|'deadlineMs'|'jobBatch'|'maxJobs'|'timers',number>>; ports?: Partial<{ now(): number; wait(ms: number, signal: AbortSignal): Promise<void>; sha256(input: string): Promise<string>; hmacSha256(key: string, input: string): Promise<string>; standard(operation: 'url'|'query'|'queryString'|'encode'|'decode'|'atob'|'btoa'|'random'|'log'|'now', inputJson: string): string }> }
export declare function createTestVm(options?: TestVmOptions): Promise<TestVm>;
export declare function runGuestTest(source: string, inputJson?: string, options?: TestVmOptions): Promise<unknown>;
`,
)
