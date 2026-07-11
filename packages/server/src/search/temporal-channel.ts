/**
 * Temporal date-range retrieval channel — server-package parity with the
 * CLI's `packages/cli/src/lib/temporal-recall.ts` (PLAN.md Task 3), reusing
 * this package's own `isTemporalQuery`/`extractTargetDate`
 * (`./temporal-query.ts`, both already exported) and the proximity formula
 * in `./ranker.ts`'s `reorderProximity` (exported for this purpose — see
 * ranker.ts's doc comment).
 *
 * Zero-cost skip: returns `[]` immediately, no query issued, for any
 * non-temporal query or a temporal query with no resolvable target date
 * (e.g. "when did I last deploy" — temporal, but no concrete date to filter
 * by). Only explicit, regex-resolvable dates benefit — same bounded
 * limitation as the CLI's Task 3 (see PLAN.md Task 7's pre-mortem).
 *
 * KNOWN LIMITATION (documented, not a bug — flag in the PR description):
 * this channel needs a raw `SupabaseClient` to issue its own PostgREST
 * query. `SupabaseSync` (the only Supabase handle `handleRecall` receives
 * today) keeps its client private, and `packages/server/src/sync/
 * supabase-sync.ts` is out of this task's file ownership (owned by Howler D
 * in SPLIT.md — adding a getter there would collide with that Howler's
 * `remoteUpsertChunks` change). `fetchTemporalCandidates` therefore takes a
 * raw client as an explicit parameter, and `handleRecall`
 * (`tools/recall.ts`) accepts it as a new optional trailing argument that
 * the current `index.ts` call site does not pass yet — this channel is
 * inert (contributes zero candidates) in production until that one-line
 * wiring lands. This is the same class of pre-existing, explicitly-flagged
 * scope limitation as Task 6's warm-local-SQLite-cache early return.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Memory } from '@tages/shared'
import { isTemporalQuery, extractTargetDate } from './temporal-query'
import { reorderProximity } from './ranker'
import { dbRowToMemory } from '../sync/supabase-sync'

export async function fetchTemporalCandidates(
  supabase: SupabaseClient,
  projectId: string,
  query: string,
  limit: number,
): Promise<Memory[]> {
  if (!isTemporalQuery(query)) return []

  const anchor = new Date()
  const targetDate = extractTargetDate(query, anchor)
  if (!targetDate) return []

  // Approximate PostgREST filter shape — exact syntax not hand-tested
  // against the live schema in this implementation pass (mirrors the CLI
  // Task 3 spec's own "not hand-tested" caveat); verify during the real
  // MCP-server probe called for in Task 7's E2E Validation.
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'live')
    .or('referenced_date.not.is.null,relative_date.not.is.null')
    .limit(limit)

  if (error || !data) return []

  const memories = (data as unknown[]).map((row) => dbRowToMemory(row as Parameters<typeof dbRowToMemory>[0]))

  return memories
    .map((memory, index) => ({ memory, index, proximity: reorderProximity(memory, anchor, targetDate) }))
    .filter((r) => r.proximity > 0)
    .sort((a, b) => {
      const diff = b.proximity - a.proximity
      if (Math.abs(diff) > 1e-10) return diff
      return a.index - b.index
    })
    .map((r) => r.memory)
}

const RRF_K = 60

/**
 * Fuse the `remoteHybridRecall` list (already trigram+semantic-fused
 * server-side by the `hybrid_recall` RPC) with this channel's temporal
 * candidates via reciprocal-rank fusion, k=60 — the same constant as the
 * CLI's Task 1 RRF (`packages/cli/src/lib/rrf.ts`) and migration 0062's
 * SQL-side RRF, for consistent rank-weighting across every fusion site in
 * this plan. A minimal, local 2-list RRF (not a generic N-list module, since
 * only Task 6/7's two sources are fused at this call site) — Task 11's
 * Phase 2 chunk-channel wiring reopens this exact merge point in
 * `tools/recall.ts`, post-merge.
 */
export function fuseTemporalChannel(hybridResults: Memory[], temporalResults: Memory[]): Memory[] {
  return fuseMemoryLists([hybridResults, temporalResults])
}

/**
 * N-list reciprocal-rank fusion over Memory lists (PLAN.md Task 11
 * generalized this from the 2-list fuseTemporalChannel above so the chunk
 * channel fuses at the same merge point with the same k). Empty lists
 * contribute nothing; when only one list is non-empty its order is
 * preserved exactly (single-list RRF is order-preserving).
 */
export function fuseMemoryLists(lists: Memory[][]): Memory[] {
  const nonEmpty = lists.filter((l) => l.length > 0)
  if (nonEmpty.length === 0) return []
  if (nonEmpty.length === 1) return nonEmpty[0]

  const scores = new Map<string, number>()
  const rows = new Map<string, Memory>()
  for (const list of nonEmpty) {
    list.forEach((m, i) => {
      const contribution = 1 / (RRF_K + i + 1)
      scores.set(m.id, (scores.get(m.id) ?? 0) + contribution)
      if (!rows.has(m.id)) rows.set(m.id, m)
    })
  }

  return [...rows.values()].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
}
