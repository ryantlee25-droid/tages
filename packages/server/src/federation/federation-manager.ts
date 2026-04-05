import type { Memory } from '@tages/shared'

export type FederationScope = 'org' | 'team' | 'public'

export interface FederatedMemory {
  id: string
  ownerProjectId: string
  scope: FederationScope
  version: number
  memory: Memory
  promotedAt: string
  promotedBy?: string
}

export interface OverrideEntry {
  federatedKey: string
  localKey: string
  projectId: string
  localMemory: Memory
  federatedMemory: FederatedMemory
}

export class FederationManager {
  private federated: Map<string, FederatedMemory> = new Map()
  private overrides: Map<string, Map<string, Memory>> = new Map() // projectId -> key -> local memory

  /**
   * Promote a project memory to the federated library.
   */
  promoteToFederated(
    memory: Memory,
    scope: FederationScope = 'org',
    promotedBy?: string,
  ): FederatedMemory {
    const existing = this.federated.get(memory.key)
    const version = (existing?.version ?? 0) + 1

    const fedEntry: FederatedMemory = {
      id: `fed-${memory.key}-v${version}`,
      ownerProjectId: memory.projectId,
      scope,
      version,
      memory: { ...memory },
      promotedAt: new Date().toISOString(),
      promotedBy,
    }

    this.federated.set(memory.key, fedEntry)
    return fedEntry
  }

  /**
   * Import a federated memory into a local project (creates local override).
   */
  importFromFederated(key: string, projectId: string): FederatedMemory | null {
    const fedEntry = this.federated.get(key)
    if (!fedEntry) return null

    // Store as local version of this project (no override yet — just awareness)
    if (!this.overrides.has(projectId)) {
      this.overrides.set(projectId, new Map())
    }

    return fedEntry
  }

  /**
   * Resolve a memory key using the hierarchy: local override → project → federated.
   */
  resolveMemory(key: string, projectId: string, localMemory?: Memory | null): {
    memory: Memory
    source: 'local' | 'federated'
    overrideChain: string[]
  } | null {
    // Check local override first
    const localOverride = this.overrides.get(projectId)?.get(key)
    if (localOverride || localMemory) {
      const mem = localOverride || localMemory!
      return {
        memory: mem,
        source: 'local',
        overrideChain: [`${projectId}:local`, `federated:${key}`],
      }
    }

    // Fall back to federated
    const fedEntry = this.federated.get(key)
    if (fedEntry) {
      return {
        memory: fedEntry.memory,
        source: 'federated',
        overrideChain: [`federated:${fedEntry.ownerProjectId}:${key}`],
      }
    }

    return null
  }

  /**
   * Set a local override for a federated key in a project.
   */
  setLocalOverride(projectId: string, key: string, memory: Memory): void {
    if (!this.overrides.has(projectId)) {
      this.overrides.set(projectId, new Map())
    }
    this.overrides.get(projectId)!.set(key, memory)
  }

  /**
   * List all federated memories, optionally filtered by scope.
   */
  listFederatedMemories(scope?: FederationScope): FederatedMemory[] {
    const entries = [...this.federated.values()]
    if (scope) return entries.filter(e => e.scope === scope)
    return entries
  }

  /**
   * Check for overrides: which federated keys have local overrides in a project.
   */
  checkForOverrides(projectId: string): OverrideEntry[] {
    const localOverrides = this.overrides.get(projectId)
    if (!localOverrides) return []

    const result: OverrideEntry[] = []
    for (const [key, localMemory] of localOverrides) {
      const fedEntry = this.federated.get(key)
      if (fedEntry) {
        result.push({
          federatedKey: key,
          localKey: key,
          projectId,
          localMemory,
          federatedMemory: fedEntry,
        })
      }
    }
    return result
  }

  /**
   * Sync federation: update local versions of federated memories if newer version available.
   */
  syncFederation(projectId: string): { updated: string[]; upToDate: string[] } {
    const updated: string[] = []
    const upToDate: string[] = []

    for (const [key, fedEntry] of this.federated) {
      const localOverride = this.overrides.get(projectId)?.get(key)
      if (!localOverride) {
        // No local override — we'd suggest importing
        upToDate.push(key)
      } else {
        // Has local override — check if federated is newer
        const fedUpdated = new Date(fedEntry.memory.updatedAt).getTime()
        const localUpdated = new Date(localOverride.updatedAt).getTime()
        if (fedUpdated > localUpdated) {
          updated.push(key)
        } else {
          upToDate.push(key)
        }
      }
    }

    return { updated, upToDate }
  }

  getFederatedEntry(key: string): FederatedMemory | undefined {
    return this.federated.get(key)
  }
}

// Global singleton for the MCP server lifetime
export const globalFederationManager = new FederationManager()
