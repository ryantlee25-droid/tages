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
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const survivor = cache.getByKey(projectId, args.survivorKey)
  const victim = cache.getByKey(projectId, args.victimKey)

  if (!survivor) {
    return { content: [{ type: 'text', text: `Survivor memory "${args.survivorKey}" not found.` }] }
  }
  if (!victim) {
    return { content: [{ type: 'text', text: `Victim memory "${args.victimKey}" not found.` }] }
  }

  const result = applyConsolidation(survivor, victim, args.mergedValue)

  // Save merged survivor
  cache.upsertMemory(result.surviving, true)
  if (sync) {
    const ok = await sync.remoteInsert(result.surviving)
    if (ok) cache.markSynced([result.surviving.id])
  }

  // Delete victim
  cache.deleteByKey(projectId, result.deletedKey)
  if (sync) {
    try {
      // Best-effort remote delete
      await (sync as unknown as { client: { from: (t: string) => { delete: () => { eq: (a: string, b: string) => { eq: (a: string, b: string) => Promise<unknown> } } } } }).client
        .from('memories')
        .delete()
        .eq('project_id', projectId)
        .eq('key', result.deletedKey)
    } catch { /* remote delete is best-effort */ }
  }

  // Log the consolidation
  cache.logDedupConsolidation(projectId, args.survivorKey, args.victimKey, result.mergeNote)

  return {
    content: [{
      type: 'text',
      text: result.mergeNote,
    }],
  }
}
