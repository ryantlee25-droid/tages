/**
 * CLI-side temporal date-range retrieval channel (PLAN.md Task 3, Hindsight's
 * 4th channel). A third parallel candidate source alongside trigram and
 * semantic search: for a query that names or implies a concrete date, this
 * runs a plain PostgREST query over date-carrying columns and ranks the
 * results by date-proximity to the resolved target, feeding the result in as
 * a third ranked list into rrf.ts's reciprocalRankFusion.
 *
 * Zero added latency/cost for the common case: returns an empty array
 * immediately, with no query issued, whenever the query isn't temporal or no
 * concrete date can be resolved from it (see isTemporalQuery/extractTargetDate
 * in temporal-sort.ts — this is a real, bounded limitation, not every
 * temporal-sounding query resolves to a date).
 */
import type { createAuthenticatedClient } from '../auth/session.js'
import { isTemporalQuery, extractTargetDate } from './temporal-sort.js'

// Type-only import of the exact client shape `createAuthenticatedClient`
// returns, rather than importing `SupabaseClient` from `@supabase/supabase-js`
// directly — that import produces a nominally-different type identity here
// than the one flowing through `@tages/shared`'s own `@supabase/supabase-js`
// import (a dual-package/resolution-mode mismatch TS treats as incompatible
// even though both resolve the same installed package version).
type SupabaseClient = Awaited<ReturnType<typeof createAuthenticatedClient>>

export interface TemporalCandidateRow {
  id: string
  [key: string]: unknown
}

// Fix D: generous, deterministic fetch cap for the date-carrying candidate
// window (see fetchTemporalCandidates). Large enough to contain effectively all
// of a project's date-carrying memories so the client-side proximity sort sees
// the true nearest rows rather than an arbitrary truncated subset.
const TEMPORAL_FETCH_CAP = 1000

// Proximity formula duplicated from temporal-sort.ts's private
// reorderProximity (per-package duplication convention — see that file's
// header comment). Keep in sync by hand if either changes.
function proximityScore(dateStr: string | null | undefined, targetDate: Date): number {
  if (!dateStr) return 0
  const rowTime = new Date(dateStr).getTime()
  if (Number.isNaN(rowTime)) return 0
  const diffDays = Math.abs(targetDate.getTime() - rowTime) / (24 * 60 * 60 * 1000)
  return 1 / (1 + diffDays)
}

export async function fetchTemporalCandidates(
  supabase: SupabaseClient,
  projectId: string,
  query: string,
  limit: number,
): Promise<TemporalCandidateRow[]> {
  if (!isTemporalQuery(query)) return []

  const targetDate = extractTargetDate(query, new Date())
  if (!targetDate) return []

  // Fix D: previously `.limit(limit)` with NO ORDER BY returned an ARBITRARY
  // subset (PostgREST default ordering is unspecified), so the memory closest to
  // the target date could be dropped BEFORE the client-side proximity sort below
  // ever ran. Date-carrying memories are a small subset of a project's memories,
  // so we fetch a generous, DETERMINISTIC (ordered) window that in practice
  // contains ALL of them — guaranteeing the true nearest-by-proximity rows are
  // present for the sort. Chosen over a two-sided (>= target ASC / < target
  // DESC) fetch because proximityScore coalesces referenced_date AND
  // relative_date; a single-column two-sided bound can't capture rows whose
  // nearest date lives in the other column.
  const { data, error } = await supabase
    .from('memories')
    .select(
      'id, project_id, key, value, type, source, agent_name, file_paths, tags, confidence, referenced_date, relative_date, created_at',
    )
    .eq('project_id', projectId)
    .eq('status', 'live')
    .or('referenced_date.not.is.null,relative_date.not.is.null')
    .order('referenced_date', { ascending: true, nullsFirst: false })
    .limit(Math.max(limit, TEMPORAL_FETCH_CAP))

  if (error || !data) return []

  const rows = data as unknown as TemporalCandidateRow[]

  return [...rows].sort((a, b) => {
    const aScore = proximityScore(
      (a.referenced_date as string | null | undefined) ?? (a.relative_date as string | null | undefined),
      targetDate,
    )
    const bScore = proximityScore(
      (b.referenced_date as string | null | undefined) ?? (b.relative_date as string | null | undefined),
      targetDate,
    )
    return bScore - aScore
  })
}
