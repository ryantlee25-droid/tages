import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import { globalFederationManager } from './federation-manager'

export interface ResolutionResult {
  memory: Memory
  source: 'local' | 'federated'
  overrideChain: string[]
}

/**
 * Resolve a memory key using local → federated hierarchy.
 * Returns null if not found anywhere.
 */
export function resolveMemory(
  key: string,
  projectId: string,
  cache: SqliteCache,
): ResolutionResult | null {
  // Check local cache first
  const local = cache.getByKey(projectId, key)

  const result = globalFederationManager.resolveMemory(key, projectId, local)
  if (result) return result

  // Direct local (no federation entry)
  if (local) {
    return { memory: local, source: 'local', overrideChain: [`${projectId}:local`] }
  }

  return null
}
