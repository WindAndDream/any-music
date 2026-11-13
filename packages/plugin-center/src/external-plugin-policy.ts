/** Application-injected upper bound. Package metadata and signatures cannot raise it. */
export type ExternalPluginPolicy = 'none' | 'declarative' | 'sandboxed'

/** Whether native-verified external source projections may enter the registry. */
export function allowsExternalPlugins(policy: ExternalPluginPolicy | undefined): boolean {
  return policy === 'declarative' || policy === 'sandboxed'
}
