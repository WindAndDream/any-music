import { getWorkbenchRuntime } from './workbench-runtime'

export function readStored<T>(key: string, fallback?: T): T | undefined {
  return getWorkbenchRuntime().storage.read(key, fallback)
}

export function writeStored(key: string, value: unknown): void {
  getWorkbenchRuntime().storage.write(key, value)
}
