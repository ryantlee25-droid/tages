import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleVerifyMemory, handlePendingMemories } from '../tools/verify'
import type { Memory } from '@tages/shared'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-execution-memories'

function createTestCache(): { cache: SqliteCache; dbPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-exec-test-${Date.now()}.db`)
  return { cache: new SqliteCache(dbPath), dbPath }
}

describe('Execution memories and metadata', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    const result = createTestCache()
    cache = result.cache
    dbPath = result.dbPath
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  describe('execution type', () => {
    it('stores execution flow memories', async () => {
      const result = await handleRemember({
        key: 'combat-pipeline',
        value: 'Combat executes as: stealth → initiative → round loop',
        type: 'execution',
        executionFlow: {
          trigger: 'Player enters room with enemy',
          steps: ['stealth check', 'initiative roll', 'round loop start', 'tick conditions', 'player action', 'resolve traits', 'enemy action', 'check end'],
          phases: ['pre-combat', 'combat', 'resolution'],
          hooks: ['on-hit', 'on-kill', 'on-turn-start'],
        },
      }, TEST_PROJECT, cache, null)

      expect(result.content[0].text).toContain('combat-pipeline')
      expect(result.content[0].text).toContain('execution flow')

      const mem = cache.getByKey(TEST_PROJECT, 'combat-pipeline')
      expect(mem).not.toBeNull()
      expect(mem!.type).toBe('execution')
      expect(mem!.executionFlow).toBeDefined()
      expect(mem!.executionFlow!.trigger).toBe('Player enters room with enemy')
      expect(mem!.executionFlow!.steps).toHaveLength(8)
      expect(mem!.executionFlow!.phases).toEqual(['pre-combat', 'combat', 'resolution'])
      expect(mem!.executionFlow!.hooks).toContain('on-hit')
    })
  })

  describe('structured metadata', () => {
    it('stores conditions on memories', async () => {
      await handleRemember({
        key: 'vigor-damage-bonus',
        value: 'Vigor stat adds to melee damage',
        type: 'convention',
        conditions: ['melee attacks only', 'vigor > 0'],
      }, TEST_PROJECT, cache, null)

      const mem = cache.getByKey(TEST_PROJECT, 'vigor-damage-bonus')
      expect(mem!.conditions).toEqual(['melee attacks only', 'vigor > 0'])
    })

    it('stores examples on memories', async () => {
      await handleRemember({
        key: 'armor-reduction',
        value: 'Armor provides 12% damage reduction per point, capped at 50%',
        type: 'convention',
        examples: [
          { input: 'armor = 3, damage = 10', output: '10 * (1 - 0.36) = 6.4 → 6 damage', note: '36% reduction' },
          { input: 'armor = 5, damage = 10', output: '10 * (1 - 0.50) = 5 damage', note: 'capped at 50%' },
        ],
      }, TEST_PROJECT, cache, null)

      const mem = cache.getByKey(TEST_PROJECT, 'armor-reduction')
      expect(mem!.examples).toHaveLength(2)
      expect(mem!.examples![0].input).toContain('armor = 3')
    })

    it('stores cross-system refs', async () => {
      await handleRemember({
        key: 'hemorrhagic-shock',
        value: 'bleed + burn = +1 extra damage per tick',
        type: 'lesson',
        crossSystemRefs: ['conditions-system', 'combat-traits-system'],
      }, TEST_PROJECT, cache, null)

      const mem = cache.getByKey(TEST_PROJECT, 'hemorrhagic-shock')
      expect(mem!.crossSystemRefs).toEqual(['conditions-system', 'combat-traits-system'])
    })

    it('stores phases', async () => {
      await handleRemember({
        key: 'turn-structure',
        value: 'Each combat turn has 4 phases',
        type: 'architecture',
        phases: ['tick-conditions', 'player-action', 'enemy-action', 'end-check'],
      }, TEST_PROJECT, cache, null)

      const mem = cache.getByKey(TEST_PROJECT, 'turn-structure')
      expect(mem!.phases).toHaveLength(4)
    })
  })

  describe('confidence gate', () => {
    it('stores pending memories', () => {
      const mem: Memory = {
        id: 'pending-1',
        projectId: TEST_PROJECT,
        key: 'auto-observed-thing',
        value: 'some observation',
        type: 'convention',
        source: 'agent',
        status: 'pending',
        confidence: 0.7,
        filePaths: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      cache.upsertMemory(mem)

      const pending = cache.getPendingMemories(TEST_PROJECT)
      expect(pending).toHaveLength(1)
      expect(pending[0].status).toBe('pending')
    })

    it('verify_memory promotes pending to live', async () => {
      const mem: Memory = {
        id: 'pending-2',
        projectId: TEST_PROJECT,
        key: 'needs-verify',
        value: 'auto-extracted convention',
        type: 'convention',
        source: 'agent',
        status: 'pending',
        confidence: 0.7,
        filePaths: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      cache.upsertMemory(mem)

      const result = await handleVerifyMemory({ key: 'needs-verify' }, TEST_PROJECT, cache, null)
      expect(result.content[0].text).toContain('Verified')

      const updated = cache.getByKey(TEST_PROJECT, 'needs-verify')
      expect(updated!.status).toBe('live')
      expect(updated!.verifiedAt).toBeDefined()
    })

    it('pending_memories lists unverified memories', async () => {
      const mem: Memory = {
        id: 'pending-3',
        projectId: TEST_PROJECT,
        key: 'unverified-thing',
        value: 'auto-extracted lesson',
        type: 'lesson',
        source: 'agent',
        status: 'pending',
        confidence: 0.7,
        filePaths: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      cache.upsertMemory(mem)

      const result = await handlePendingMemories(TEST_PROJECT, cache)
      expect(result.content[0].text).toContain('unverified-thing')
      expect(result.content[0].text).toContain('Pending Memories (1)')
    })

    it('returns empty message when no pending', async () => {
      const result = await handlePendingMemories(TEST_PROJECT, cache)
      expect(result.content[0].text).toContain('No pending')
    })
  })
})
