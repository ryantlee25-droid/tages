import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { threeWayMerge } from '../merge/three-way'

type ResolutionStrategy = 'keep_newer' | 'keep_older' | 'merge' | 'auto_merge'

interface ConflictRecord {
  id: string
  projectId: string
  memoryAKey: string
  memoryBKey: string
  reason: string
  resolved: boolean
  resolutionStrategy?: ResolutionStrategy
  mergedValue?: string
  resolvedBy?: string
  resolvedAt?: string
  createdAt: string
}

export async function handleResolveConflict(
  args: {
    conflictId: string
    strategy: ResolutionStrategy
    mergedValue?: string
    resolvedBy?: string
  },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const conflict = cache.getConflict(args.conflictId)
  if (!conflict) {
    return {
      content: [{ type: 'text', text: `Conflict "${args.conflictId}" not found.` }],
    }
  }

  if (conflict.projectId !== projectId) {
    return {
      content: [{ type: 'text', text: `Conflict "${args.conflictId}" not found.` }],
    }
  }

  if (conflict.resolved) {
    return {
      content: [{ type: 'text', text: `Conflict "${args.conflictId}" is already resolved.` }],
    }
  }

  const memA = cache.getByKey(projectId, conflict.memoryAKey)
  const memB = cache.getByKey(projectId, conflict.memoryBKey)

  if (!memA || !memB) {
    cache.resolveConflict(args.conflictId, args.strategy, undefined, args.resolvedBy)
    return {
      content: [{
        type: 'text',
        text: `One or both memories no longer exist. Conflict marked resolved.`,
      }],
    }
  }

  const newerMem = new Date(memA.updatedAt) >= new Date(memB.updatedAt) ? memA : memB
  const olderMem = newerMem === memA ? memB : memA

  let resolvedValue: string
  let keptKey: string

  if (args.strategy === 'keep_newer') {
    resolvedValue = newerMem.value
    keptKey = newerMem.key
    // Delete the older one
    cache.deleteByKey(projectId, olderMem.key)
  } else if (args.strategy === 'keep_older') {
    resolvedValue = olderMem.value
    keptKey = olderMem.key
    cache.deleteByKey(projectId, newerMem.key)
  } else if (args.strategy === 'auto_merge') {
    // 3-way merge: use stored base value if available, otherwise use older as base
    const conflictWithBase = cache.getConflictWithBase(args.conflictId)
    const baseValue = conflictWithBase?.mergeBaseValue
    const base = baseValue ? { value: baseValue } : olderMem
    const mergeResult = threeWayMerge(base, memA, memB)
    resolvedValue = mergeResult.merged.value || newerMem.value
    keptKey = newerMem.key

    const mergedMemory = {
      ...newerMem,
      ...mergeResult.merged,
      value: resolvedValue,
      updatedAt: new Date().toISOString(),
      ...(callerUserId ? { updatedBy: callerUserId } : {}),
    }
    cache.upsertMemory(mergedMemory)
    cache.deleteByKey(projectId, olderMem.key)

    const conflictNote = mergeResult.conflicts.length > 0
      ? ` (${mergeResult.conflicts.length} field conflict(s): ${mergeResult.conflicts.join(', ')} — left side kept)`
      : ' (clean merge)'

    cache.resolveConflict(args.conflictId, 'auto_merge', resolvedValue, args.resolvedBy)
    return {
      content: [{
        type: 'text',
        text: [
          `## Conflict Auto-Merged`,
          `Strategy: auto_merge${conflictNote}`,
          `Kept: ${keptKey}`,
          `Value: ${resolvedValue.slice(0, 120)}${resolvedValue.length > 120 ? '...' : ''}`,
        ].join('\n'),
      }],
    }
  } else {
    // merge
    if (!args.mergedValue) {
      return {
        content: [{
          type: 'text',
          text: `Strategy "merge" requires a mergedValue. Provide the combined memory content.`,
        }],
      }
    }
    resolvedValue = args.mergedValue
    keptKey = newerMem.key
    // Update the kept memory with the merged value
    cache.upsertMemory({
      ...newerMem,
      value: args.mergedValue,
      updatedAt: new Date().toISOString(),
      ...(callerUserId ? { updatedBy: callerUserId } : {}),
    })
    cache.deleteByKey(projectId, olderMem.key)
  }

  cache.resolveConflict(args.conflictId, args.strategy, args.mergedValue, args.resolvedBy)

  return {
    content: [{
      type: 'text',
      text: [
        `## Conflict Resolved`,
        `Strategy: ${args.strategy}`,
        `Kept: ${keptKey}`,
        `Value: ${resolvedValue.slice(0, 120)}${resolvedValue.length > 120 ? '...' : ''}`,
      ].join('\n'),
    }],
  }
}

export async function handleListConflicts(
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const conflicts = cache.getUnresolvedConflicts(projectId)

  if (conflicts.length === 0) {
    return {
      content: [{ type: 'text', text: 'No unresolved conflicts.' }],
    }
  }

  const lines = conflicts.map((c) =>
    `- [${c.id.slice(0, 8)}] "${c.memoryAKey}" vs "${c.memoryBKey}" — ${c.reason}`,
  )

  return {
    content: [{
      type: 'text',
      text: `## Unresolved Conflicts (${conflicts.length})\n\n${lines.join('\n')}`,
    }],
  }
}
