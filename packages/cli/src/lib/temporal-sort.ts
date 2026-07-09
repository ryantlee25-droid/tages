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

const TEMPORAL_KEYWORDS = [
  'when',
  'what date',
  'what day',
  'before',
  'after',
  'last time',
  'this time',
  'how long ago',
  'ago',
  'yesterday',
  'tomorrow',
]

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

const KEYWORD_PATTERN = new RegExp(
  `\\b(${TEMPORAL_KEYWORDS.map(kw => kw.replace(/\s+/g, '\\s+')).join('|')})\\b`,
  'i',
)
const MONTH_PATTERN = new RegExp(`\\b(${MONTH_NAMES.join('|')})\\b`, 'i')
const WEEKDAY_PATTERN = new RegExp(`\\b(${WEEKDAY_NAMES.join('|')})\\b`, 'i')
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/
const SLASH_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/

/** True when `query` looks like it's asking about timing rather than content. */
export function isTemporalQuery(query: string): boolean {
  if (!query) return false
  return (
    KEYWORD_PATTERN.test(query) ||
    MONTH_PATTERN.test(query) ||
    WEEKDAY_PATTERN.test(query) ||
    ISO_DATE_PATTERN.test(query) ||
    SLASH_DATE_PATTERN.test(query)
  )
}

/** Resolve an explicit date named in `query` (if any) against `anchor`. */
function extractTargetDate(query: string, anchor: Date): Date | undefined {
  const { referencedDate, relativeDate } = extractDates(query, anchor)
  const iso = referencedDate ?? relativeDate
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

// Accepts the loosely-typed row shape the CLI's recall path already works
// with (Record<string, unknown>, straight off a Supabase `.select()`/`.rpc()`
// response) rather than requiring callers to cast into TemporalRow — the
// three date fields are read defensively via bracket access + an `as`
// narrowing, exactly like the rest of recall.ts treats these rows.
function temporalProximity(row: Record<string, unknown>, anchor: Date, targetDate?: Date): number {
  const dateStr = (row.referenced_date ?? row.relative_date ?? row.created_at) as string | null | undefined
  if (!dateStr) return 0
  const rowTime = new Date(dateStr).getTime()
  if (Number.isNaN(rowTime)) return 0
  const compareTime = (targetDate ?? anchor).getTime()
  const diffDays = Math.abs(compareTime - rowTime) / (24 * 60 * 60 * 1000)
  return 1 / (1 + diffDays)
}

/**
 * Reorder already-fetched rows by temporal proximity when `query` is
 * temporal. Stable: rows with equal proximity keep their original (existing
 * relevance-ranked) order, so this layers on top of the existing order
 * rather than replacing it. Non-temporal queries return `rows` unchanged.
 */
export function sortByTemporalProximity<T extends Record<string, unknown>>(rows: T[], query: string): T[] {
  if (rows.length === 0 || !isTemporalQuery(query)) return rows

  const anchor = new Date()
  const targetDate = extractTargetDate(query, anchor)

  return rows
    .map((row, index) => ({ row, index, proximity: temporalProximity(row, anchor, targetDate) }))
    .sort((a, b) => {
      const diff = b.proximity - a.proximity
      if (Math.abs(diff) > 1e-10) return diff
      return a.index - b.index
    })
    .map(r => r.row)
}
