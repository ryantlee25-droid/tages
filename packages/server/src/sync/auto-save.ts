/**
 * Auto-save sweep: promote pending memories whose confidence meets the
 * project's auto_save_threshold to live status.
 *
 * Opt-in only — threshold is NULL by default. Users must explicitly set a
 * threshold via `tages settings auto-save <value>` to enable this behavior.
 *
 * NOTE: This sweep intentionally does NOT run inside session_end.
 * Session-extracted memories (confidence=0.8) always go to pending for review,
 * even if threshold <= 0.8. The spec decision (Phase 1, Q1) is that
 * session-extracted content requires user review because it is inferred from
 * natural language summaries, not verified by the user. CI projects that want
 * auto-promotion should set auto_save_threshold=0.0.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SqliteCache } from '../cache/sqlite'

export interface AutoSaveResult {
  promoted: number
  threshold: number
}

/**
 * Run the auto-save sweep against the Supabase DB.
 * Promotes pending memories with confidence >= threshold to live.
 *
 * Uses the authenticated Supabase client so RLS enforces member access.
 */
export async function runAutoSaveSweep(
  supabase: SupabaseClient,
  projectId: string,
  threshold: number,
): Promise<AutoSaveResult> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('memories')
    .update({ status: 'live', verified_at: now })
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .gte('confidence', threshold)
    .select('id')

  if (error) {
    console.error(`[tages] Auto-save sweep error: ${error.message}`)
    return { promoted: 0, threshold }
  }

  const promoted = data?.length ?? 0
  if (promoted > 0) {
    console.error(`[tages] Auto-saved ${promoted} pending ${promoted === 1 ? 'memory' : 'memories'} (confidence >= ${threshold})`)
  }
  return { promoted, threshold }
}

/**
 * Run the auto-save sweep locally against SQLite cache.
 * Used when Supabase is not available or for local-only mode.
 */
export function runAutoSaveSweepLocal(
  cache: SqliteCache,
  projectId: string,
  threshold: number,
): AutoSaveResult {
  const pending = cache.getPendingMemories(projectId)
  const now = new Date().toISOString()
  let promoted = 0

  for (const mem of pending) {
    if (mem.confidence >= threshold) {
      cache.updateMemoryStatus(mem.id, 'live', now)
      promoted++
    }
  }

  if (promoted > 0) {
    console.error(`[tages] Auto-saved ${promoted} pending ${promoted === 1 ? 'memory' : 'memories'} (confidence >= ${threshold})`)
  }
  return { promoted, threshold }
}
