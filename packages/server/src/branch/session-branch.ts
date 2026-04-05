/**
 * Session Memory Branching
 *
 * Fork memories per session for experimentation. Branch writes don't affect
 * main. Merge back with conflict detection.
 */
import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'

export interface BranchInfo {
  id: string
  sessionId: string
  projectId: string
  parentBranch: string | null
  createdAt: string
}

export interface BranchMergeResult {
  merged: number
  conflicts: Array<{ key: string; mainValue: string; branchValue: string }>
  strategy: 'force' | 'skip_conflicts'
}

/**
 * Fork: snapshot current project memories into a branch for this session.
 * All subsequent writes in this session go to the branch namespace.
 */
export function forkBranch(
  sessionId: string,
  projectId: string,
  cache: SqliteCache,
): BranchInfo {
  const branch: BranchInfo = {
    id: randomUUID(),
    sessionId,
    projectId,
    parentBranch: null,
    createdAt: new Date().toISOString(),
  }

  // Copy all current memories into branch namespace
  const memories = cache.getAllForProject(projectId)
  for (const mem of memories) {
    cache.upsertMemoryInBranch(sessionId, { ...mem }, false)
  }

  // Record the branch in SQLite
  cache.createBranch(branch)

  return branch
}

/**
 * Get memories in a session branch.
 */
export function getBranchMemories(sessionId: string, cache: SqliteCache): Memory[] {
  return cache.getBranchMemories(sessionId)
}

/**
 * Merge branch back into main.
 *
 * Strategies:
 * - 'force': Branch wins on all conflicts
 * - 'skip_conflicts': Only merge non-conflicting changes
 */
export function mergeBranch(
  sessionId: string,
  strategy: 'force' | 'skip_conflicts',
  cache: SqliteCache,
): BranchMergeResult {
  const branchMemories = cache.getBranchMemories(sessionId)
  const result: BranchMergeResult = {
    merged: 0,
    conflicts: [],
    strategy,
  }

  for (const branchMem of branchMemories) {
    const mainMem = cache.getByKey(branchMem.projectId, branchMem.key)

    if (!mainMem) {
      // New in branch — always promote
      cache.upsertMemory(branchMem, true)
      result.merged++
      continue
    }

    if (mainMem.value === branchMem.value) {
      // No change
      continue
    }

    // Conflict: main was modified while branch was open, or branch modified it
    if (strategy === 'force') {
      cache.upsertMemory({ ...branchMem, updatedAt: new Date().toISOString() }, true)
      result.merged++
    } else {
      // skip_conflicts: track conflict but don't merge
      result.conflicts.push({
        key: branchMem.key,
        mainValue: mainMem.value,
        branchValue: branchMem.value,
      })
    }
  }

  return result
}

/**
 * Delete a branch and all its memories.
 */
export function deleteBranch(sessionId: string, cache: SqliteCache): void {
  cache.deleteBranch(sessionId)
}
