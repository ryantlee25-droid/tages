import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { forkBranch, getBranchMemories, mergeBranch, deleteBranch } from '../branch/session-branch'
import { SqliteCache } from '../cache/sqlite'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { Memory } from '@tages/shared'

const PROJECT_ID = 'test-project'

function makeTempPath() {
  return path.join(os.tmpdir(), `tages-branch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function makeMemory(key: string, value: string, overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: `id-${key}-${Math.random().toString(36).slice(2)}`,
    projectId: PROJECT_ID,
    key,
    value,
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('Session Memory Branching', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = makeTempPath()
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('forkBranch creates a branch snapshot', () => {
    cache.upsertMemory(makeMemory('key-a', 'value a'))
    cache.upsertMemory(makeMemory('key-b', 'value b'))

    const branch = forkBranch('session-1', PROJECT_ID, cache)
    expect(branch.sessionId).toBe('session-1')
    expect(branch.projectId).toBe(PROJECT_ID)
    expect(branch.id).toBeTruthy()
  })

  it('fork snapshot contains all existing memories', () => {
    cache.upsertMemory(makeMemory('key-a', 'value a'))
    cache.upsertMemory(makeMemory('key-b', 'value b'))
    forkBranch('session-1', PROJECT_ID, cache)

    const branchMems = getBranchMemories('session-1', cache)
    const keys = branchMems.map(m => m.key)
    expect(keys).toContain('key-a')
    expect(keys).toContain('key-b')
  })

  it('branch writes do not affect main', () => {
    cache.upsertMemory(makeMemory('main-key', 'main value'))
    forkBranch('session-2', PROJECT_ID, cache)

    // Write to branch
    const branchMem = makeMemory('branch-only', 'branch value')
    cache.upsertMemoryInBranch('session-2', branchMem, true)

    // Main should not have branch-only key
    const mainMem = cache.getByKey(PROJECT_ID, 'branch-only')
    expect(mainMem).toBeNull()
  })

  it('merge promotes branch changes to main', () => {
    cache.upsertMemory(makeMemory('key-x', 'old value'))
    forkBranch('session-3', PROJECT_ID, cache)

    // Modify in branch
    const branchMems = getBranchMemories('session-3', cache)
    const mem = branchMems.find(m => m.key === 'key-x')!
    cache.upsertMemoryInBranch('session-3', { ...mem, value: 'new branch value' }, true)

    const result = mergeBranch('session-3', 'force', cache)
    expect(result.merged).toBeGreaterThan(0)

    const mainMem = cache.getByKey(PROJECT_ID, 'key-x')
    expect(mainMem!.value).toBe('new branch value')
  })

  it('merge detects conflicts with skip_conflicts strategy', () => {
    cache.upsertMemory(makeMemory('conflict-key', 'main value'))
    forkBranch('session-4', PROJECT_ID, cache)

    // Modify both main and branch to different values
    const branchMems = getBranchMemories('session-4', cache)
    const branchMem = branchMems.find(m => m.key === 'conflict-key')!
    cache.upsertMemoryInBranch('session-4', { ...branchMem, value: 'branch modified' }, true)

    // Also modify main
    const mainMem = cache.getByKey(PROJECT_ID, 'conflict-key')!
    cache.upsertMemory({ ...mainMem, value: 'main modified too' })

    const result = mergeBranch('session-4', 'skip_conflicts', cache)
    expect(result.conflicts.length).toBeGreaterThan(0)
    expect(result.conflicts[0].key).toBe('conflict-key')
  })

  it('force strategy: branch wins on conflicts', () => {
    cache.upsertMemory(makeMemory('force-key', 'main value'))
    forkBranch('session-5', PROJECT_ID, cache)

    const branchMems = getBranchMemories('session-5', cache)
    const branchMem = branchMems.find(m => m.key === 'force-key')!
    cache.upsertMemoryInBranch('session-5', { ...branchMem, value: 'branch wins' }, true)

    // Modify main too
    const mainMem = cache.getByKey(PROJECT_ID, 'force-key')!
    cache.upsertMemory({ ...mainMem, value: 'main modified' })

    mergeBranch('session-5', 'force', cache)
    const afterMerge = cache.getByKey(PROJECT_ID, 'force-key')
    expect(afterMerge!.value).toBe('branch wins')
  })

  it('deleteBranch cleans up branch memories', () => {
    forkBranch('session-6', PROJECT_ID, cache)
    cache.upsertMemoryInBranch('session-6', makeMemory('branch-mem', 'branch val'), true)

    deleteBranch('session-6', cache)
    const branchMems = getBranchMemories('session-6', cache)
    expect(branchMems.length).toBe(0)
  })

  it('new memories in branch promoted to main on merge', () => {
    forkBranch('session-7', PROJECT_ID, cache)
    const newMem = makeMemory('new-in-branch', 'new value')
    cache.upsertMemoryInBranch('session-7', newMem, true)

    const result = mergeBranch('session-7', 'skip_conflicts', cache)
    expect(result.merged).toBe(1)
    expect(cache.getByKey(PROJECT_ID, 'new-in-branch')).not.toBeNull()
  })

  it('getBranchMemories returns empty for unknown session', () => {
    const mems = getBranchMemories('nonexistent-session', cache)
    expect(mems).toEqual([])
  })

  it('nested branches: fork creates independent snapshot', () => {
    cache.upsertMemory(makeMemory('shared', 'original'))
    forkBranch('session-a', PROJECT_ID, cache)
    forkBranch('session-b', PROJECT_ID, cache)

    // Modify in session-a only
    const memA = getBranchMemories('session-a', cache).find(m => m.key === 'shared')!
    cache.upsertMemoryInBranch('session-a', { ...memA, value: 'session-a version' }, true)

    // session-b should still have original
    const memB = getBranchMemories('session-b', cache).find(m => m.key === 'shared')
    expect(memB?.value).toBe('original')
  })
})
