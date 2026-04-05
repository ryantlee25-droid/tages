import { describe, it, expect, beforeEach } from 'vitest'
import { FederationManager } from '../federation/federation-manager'
import type { Memory } from '@tages/shared'

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

function makeMemory(key: string, projectId = PROJECT_A, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId,
    key,
    value: `value for ${key}`,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('FederationManager', () => {
  let manager: FederationManager

  beforeEach(() => {
    manager = new FederationManager()
  })

  it('promotes a memory to federated library', () => {
    const mem = makeMemory('shared-convention')
    const entry = manager.promoteToFederated(mem)
    expect(entry.memory.key).toBe('shared-convention')
    expect(entry.ownerProjectId).toBe(PROJECT_A)
    expect(entry.version).toBe(1)
  })

  it('increments version on re-promotion', () => {
    const mem = makeMemory('versioned')
    manager.promoteToFederated(mem)
    const v2 = manager.promoteToFederated({ ...mem, value: 'updated value' })
    expect(v2.version).toBe(2)
  })

  it('importFromFederated returns the federated entry', () => {
    const mem = makeMemory('importable')
    manager.promoteToFederated(mem)
    const imported = manager.importFromFederated('importable', PROJECT_B)
    expect(imported).not.toBeNull()
    expect(imported!.memory.key).toBe('importable')
  })

  it('importFromFederated returns null for unknown key', () => {
    const result = manager.importFromFederated('unknown-key', PROJECT_B)
    expect(result).toBeNull()
  })

  it('local overrides federated in resolveMemory', () => {
    const fedMem = makeMemory('shared-key')
    manager.promoteToFederated(fedMem)

    const localOverride = makeMemory('shared-key', PROJECT_B, { value: 'local override value' })
    manager.setLocalOverride(PROJECT_B, 'shared-key', localOverride)

    const result = manager.resolveMemory('shared-key', PROJECT_B)
    expect(result?.source).toBe('local')
    expect(result?.memory.value).toBe('local override value')
  })

  it('falls back to federated when no local override', () => {
    const fedMem = makeMemory('shared-key')
    manager.promoteToFederated(fedMem)
    const result = manager.resolveMemory('shared-key', PROJECT_B)
    expect(result?.source).toBe('federated')
    expect(result?.memory.value).toBe(fedMem.value)
  })

  it('delete local falls back to federated', () => {
    const fedMem = makeMemory('fallback-key')
    manager.promoteToFederated(fedMem)
    // No local override set — resolveMemory should find federated
    const result = manager.resolveMemory('fallback-key', PROJECT_B, null)
    expect(result?.source).toBe('federated')
  })

  it('lists federated memories', () => {
    manager.promoteToFederated(makeMemory('a'))
    manager.promoteToFederated(makeMemory('b'))
    expect(manager.listFederatedMemories()).toHaveLength(2)
  })

  it('filters federated by scope', () => {
    manager.promoteToFederated(makeMemory('org-mem'), 'org')
    manager.promoteToFederated(makeMemory('team-mem'), 'team')
    expect(manager.listFederatedMemories('org')).toHaveLength(1)
    expect(manager.listFederatedMemories('team')).toHaveLength(1)
  })

  it('checkForOverrides returns local overrides of federated keys', () => {
    const fedMem = makeMemory('override-target')
    manager.promoteToFederated(fedMem)
    manager.setLocalOverride(PROJECT_B, 'override-target', makeMemory('override-target', PROJECT_B))

    const overrides = manager.checkForOverrides(PROJECT_B)
    expect(overrides).toHaveLength(1)
    expect(overrides[0].federatedKey).toBe('override-target')
  })

  it('version tracking: override chain includes version info', () => {
    const mem = makeMemory('tracked')
    manager.promoteToFederated(mem)
    const result = manager.resolveMemory('tracked', PROJECT_B)
    expect(result?.overrideChain.length).toBeGreaterThan(0)
  })

  it('syncFederation identifies updatable entries', () => {
    const fedMem = makeMemory('sync-key')
    manager.promoteToFederated(fedMem)

    // Set a local override with old timestamp
    const oldLocal = makeMemory('sync-key', PROJECT_B, {
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    })
    manager.setLocalOverride(PROJECT_B, 'sync-key', oldLocal)

    // Update federated to newer version
    manager.promoteToFederated({
      ...fedMem,
      value: 'newer value',
      updatedAt: new Date().toISOString(),
    })

    const sync = manager.syncFederation(PROJECT_B)
    expect(sync.updated).toContain('sync-key')
  })
})
