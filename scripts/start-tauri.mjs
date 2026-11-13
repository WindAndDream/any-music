import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const path = fileURLToPath(
  new URL(
    `../target/release/any-music-tauri${process.platform === 'win32' ? '.exe' : ''}`,
    import.meta.url,
  ),
)
if (!existsSync(path)) {
  process.stderr.write('Build the native app first: pnpm build:tauri\n')
  process.exitCode = 1
} else {
  const child = spawn(path, [], { stdio: 'inherit' })
  child.on('error', (error) => {
    process.stderr.write(`Unable to start Any Music: ${error.message}\n`)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
