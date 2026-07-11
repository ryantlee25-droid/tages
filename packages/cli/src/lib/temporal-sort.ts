/**
 * CLI-local temporal-query classification + reorder helper for 3-date
 * anchoring (migration 0060).
 *
 * Mirrors packages/server/src/search/temporal-query.ts's classifier plus the
 * temporal-proximity reorder logic in packages/server/src/search/ranker.ts —
 * bundled into one file (rather than pulling in the full server ranker,
 * which the CLI cannot depend on at runtime; same reasoning as lib/
 * embedding.ts and lib/date-extraction.ts). The CLI's recall path talks to
 * Supabase RPCs directly and gets back plain row objects (snake_case), not
 * the server's `Memory` type, so this operates on that row shape instead.
 *
 * Keep the classifier keyword list and proximity formula in sync with the
 * server's temporal-query.ts / ranker.ts by hand if either changes.
 */
import { extractDates } from './date-extraction.js'

export interface TemporalRow {
  referenced_date?: string | null
  relative_date?: string | null
  created_at?: string | null
}

// Keywords that signal a timing question on their own — unambiguous in
// ordinary recall queries.
const STRONG_KEYWORDS = [
  'when',
  'what date',
  'what day',
  'how long ago',
  'last time',
  'this time',
  'yesterday',
  'tomorrow',
]

// Keywords that ALSO appear routinely in non-temporal content queries
// ("what may cause this crash" has no gated keyword; "what do we do after a
// failed migration" has "after"; "3 files before the refactor" has "before").
// These only signal a temporal question when a concrete temporal referent (a
// date literal, a month with a day/year, a weekday, or a relative expression)
// co-occurs — firing on the bare keyword is the over-broad-classifier defect
// this narrowing fixes.
const GATED_KEYWORDS = ['before', 'after', 'ago']

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

const STRONG_KEYWORD_PATTERN = new RegExp(
  `\\b(${STRONG_KEYWORDS.map(kw => kw.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'i',
)
const GATED_KEYWORD_PATTERN = new RegExp(`\\b(${GATED_KEYWORDS.join('|')})\\b`, 'i')
const WEEKDAY_PATTERN = new RegExp(`\\b(${WEEKDAY_NAMES.join('|')})\\b`, 'i')
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/
const SLASH_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/

// A month name with date-like context: "March 3", "March 3rd, 2026",
// "March 2026", "3 March", "3rd March". A BARE month word ("may", "march",
// "august") does NOT match — that bare-word match was the false-positive
// source ("what may cause this crash").
const MONTH_WITH_CONTEXT_PATTERN = new RegExp(
  `\\b(?:${MONTH_NAMES.join('|')})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?\\b|\\d{4}\\b)` +
    `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES.join('|')})\\b`,
  'i',
)
// Relative expressions: "N days/weeks/months/years ago", "last/next <weekday>".
const RELATIVE_PATTERN = new RegExp(
  `\\b\\d+\\s+(?:day|days|week|weeks|month|months|year|years)\\s+ago\\b` +
    `|\\b(?:last|next)\\s+(?:${WEEKDAY_NAMES.join('|')})\\b`,
  'i',
)
// A bare month name — used ONLY as a referent that turns a gated keyword
// ("before March", "after August") temporal, never as a standalone signal.
const BARE_MONTH_PATTERN = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'i')

/** Signals that make a query temporal on their own, no gating required. */
function hasStrongTemporalSignal(query: string): boolean {
  return (
    STRONG_KEYWORD_PATTERN.test(query) ||
    WEEKDAY_PATTERN.test(query) ||
    ISO_DATE_PATTERN.test(query) ||
    SLASH_DATE_PATTERN.test(query) ||
    MONTH_WITH_CONTEXT_PATTERN.test(query) ||
    RELATIVE_PATTERN.test(query)
  )
}

/** A concrete date/time referent that legitimizes a gated keyword. */
function hasTemporalReferent(query: string): boolean {
  return (
    ISO_DATE_PATTERN.test(query) ||
    SLASH_DATE_PATTERN.test(query) ||
    MONTH_WITH_CONTEXT_PATTERN.test(query) ||
    BARE_MONTH_PATTERN.test(query) ||
    WEEKDAY_PATTERN.test(query) ||
    RELATIVE_PATTERN.test(query)
  )
}

/**
 * True when `query` looks like it's asking about timing rather than content.
 * Kept logic-identical to packages/server/src/search/temporal-query.ts.
 */
export function isTemporalQuery(query: string): boolean {
  if (!query) return false
  if (hasStrongTemporalSignal(query)) return true
  if (GATED_KEYWORD_PATTERN.test(query) && hasTemporalReferent(query)) return true
  return false
}

/** Resolve an explicit date named in `query` (if any) against `anchor`. */
export function extractTargetDate(query: string, anchor: Date): Date | undefined {
  const { referencedDate, relativeDate } = extractDates(query, anchor)
  const iso = referencedDate ?? relativeDate
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const TEMPORAL_WEIGHT = 0.5

/**
 * Reciprocal-rank relevance signal from a row's position in the merged,
 * similarity-sorted list: rank 0 -> 1.0, rank 1 -> 0.5, rank 2 -> 0.333.
 * Kept logic-identical to the server ranker's relevanceFromRank.
 */
function relevanceFromRank(index: number): number {
  return 1 / (1 + index)
}

// Accepts the loosely-typed row shape the CLI's recall path already works
// with (Record<string, unknown>, straight off a Supabase `.select()`/`.rpc()`
// response). Unlike a generic proximity helper this deliberately does NOT fall
// back to `created_at`: only a genuine content-anchored date (referenced_date
// / relative_date) counts, so a recently-WRITTEN but content-dateless
// trigram/recall_memories row (which carries only created_at) never competes
// on the same proximity scale as a semantic row whose text referenced a date.
// A row with neither returns 0 (no boost) and stays on its relevance rank.
function reorderProximity(row: Record<string, unknown>, anchor: Date, targetDate?: Date): number {
  const dateStr = (row.referenced_date ?? row.relative_date) as string | null | undefined
  if (!dateStr) return 0
  const rowTime = new Date(dateStr).getTime()
  if (Number.isNaN(rowTime)) return 0
  const compareTime = (targetDate ?? anchor).getTime()
  const diffDays = Math.abs(compareTime - rowTime) / (24 * 60 * 60 * 1000)
  return 1 / (1 + diffDays)
}

/**
 * Reorder already-fetched rows when `query` is temporal, preserving relevance
 * as the primary signal. Relevance is reconstructed from each row's position
 * in the merged similarity-sorted list and a BOUNDED multiplicative proximity
 * boost (`1 + TEMPORAL_WEIGHT * proximity`, mirroring the server's local path)
 * is layered on top.
 *
 * Because the boost is bounded to [1, 1.5], a substantially-more-relevant row
 * can never be demoted below a barely-closer-dated one, and the top
 * similarity hit (relevance 1.0) can never be overtaken (the best any lower
 * rank reaches is 0.5 * 1.5 = 0.75) — so a subsequent `slice(0, limit)` can
 * never drop the top hit. Only content-dated rows are boosted (see
 * reorderProximity). Non-temporal queries return `rows` unchanged. Kept
 * logic-identical to the server ranker's reorderByTemporalProximity.
 */
export function sortByTemporalProximity<T extends Record<string, unknown>>(rows: T[], query: string): T[] {
  if (rows.length === 0 || !isTemporalQuery(query)) return rows

  const anchor = new Date()
  const targetDate = extractTargetDate(query, anchor)

  return rows
    .map((row, index) => {
      const proximity = reorderProximity(row, anchor, targetDate)
      const score = relevanceFromRank(index) * (1 + TEMPORAL_WEIGHT * proximity)
      return { row, index, score }
    })
    .sort((a, b) => {
      const diff = b.score - a.score
      if (Math.abs(diff) > 1e-10) return diff
      return a.index - b.index
    })
    .map(r => r.row)
}
