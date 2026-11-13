export interface ModuleFailureRecord {
  moduleIds: readonly string[]
  reason: string
}
export interface RecoveryPorts {
  readFailure(): ModuleFailureRecord | undefined
  writeFailure(failure: ModuleFailureRecord | undefined): void
  disableOptionalModules(): void | Promise<void>
  restoreDefaultTheme(): void
}

/** Deliberately independent of registry/controller/allocator so a broken framework can recover. */
export function createModuleRecovery(ports: RecoveryPorts) {
  return {
    readFailure: ports.readFailure,
    report: ports.writeFailure,
    async safeStart(): Promise<void> {
      await ports.disableOptionalModules()
      ports.restoreDefaultTheme()
      ports.writeFailure(undefined)
    },
    restoreDefaultTheme: ports.restoreDefaultTheme,
  }
}
