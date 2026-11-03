import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { detectDuplicates } from '../dedup/similarity-detector'
import { applyConsolidation } from '../dedup/consolidator'

export async function handleDetectDuplicates(
  args: { threshold?: number },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memories = cache.getAllForProject(projectId)
  const threshold = args.threshold ?? 0.7
  const pairs = detectDuplicates(memories, threshold)

  if (pairs.length === 0) {
    return { content: [{ type: 'text', text: 'No duplicate memories detected.' }] }
  }

  const lines = pairs.map((p, i) => [
    `${i + 1}. Score: ${(p.score * 100).toFixed(0)}% — [${p.memoryA.type}]`,
    `   A: "${p.memoryA.key}": ${p.memoryA.value.slice(0, 80)}`,
    `   B: "${p.memoryB.key}": ${p.memoryB.value.slice(0, 80)}`,
    `   Suggested merge: ${p.suggestedMergedValue.slice(0, 80)}`,
  ].join('\n'))

  return {
    content: [{
      type: 'text',
      text: `Found ${pairs.length} potential duplicate pair(s) (threshold: ${(threshold * 100).toFixed(0)}%):\n\n${lines.join('\n\n')}`,
    }],
  }
}

export async function handleConsolidate(
  args: { survivorKey: string; victimKey: string; mergedValue?: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const survivor = cache.getByKey(projectId, args.survivorKey)
  const victim = cache.getByKey(projectId, args.victimKey)

  if (!survivor) {
    return { content: [{ type: 'text', text: `Survivor memory "${args.survivorKey}" not found.` }] }
  }
  if (!victim) {
    return { content: [{ type: 'text', text: `Victim memory "${args.victimKey}" not found.` }] }
  }

  const result = applyConsolidation(survivor, victim, args.mergedValue)

  // Stamp authorship on the merged survivor
  const surviving = callerUserId
    ? { ...result.surviving, updatedBy: callerUserId }
    : result.surviving

  // Remote FIRST (bug 5): a read-only member's write is refused by RLS, and
  // the tool must say so instead of reporting a merge that never happened.
  if (sync) {
    const ok = await sync.remoteInsert(surviving)
    if (!ok) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Permission denied: could not save the merged "${args.survivorKey}" to the shared store (your role may be ` +
            'read-only on this project, or the database was unreachable). Nothing was changed.',
        }],
      }
    }
  }

  // Save merged survivor
  cache.upsertMemory(surviving, true)
  if (sync) cache.markSynced([surviving.id])

  // Delete victim. remoteDelete false = error or a visible row survived a
  // 0-row delete (RLS). (This previously reached for a nonexistent
  // `sync.client`, threw, and the catch hid it: the remote victim never died.)
  if (sync) {
    const ok = await sync.remoteDelete(projectId, result.deletedKey)
    if (!ok) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Merged into "${args.survivorKey}", but could not delete "${result.deletedKey}" from the shared store ` +
            '(permission denied or unreachable). Both memories still exist for teammates; ask an owner or admin to delete it.',
        }],
      }
    }
  }
  cache.deleteByKey(projectId, result.deletedKey)

  // Log the consolidation
  cache.logDedupConsolidation(projectId, args.survivorKey, args.victimKey, result.mergeNote)

  return {
    content: [{
      type: 'text',
      text: result.mergeNote,
    }],
  }
}
