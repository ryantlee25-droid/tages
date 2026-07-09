/**
 * Temporal-query classification for recall (migration 0060, 3-date anchoring).
 *
 * Temporal-reasoning accuracy is Tages' universal weak spot (23-54% across
 * every LongMemEval run, unmoved by embedder changes). `isTemporalQuery`
 * flags queries that are asking about *when* something happened rather than
 * *what*; `ranker.ts` uses that flag to layer a date-proximity reorder on
 * top of the existing composite relevance score.
 */
import { extractDates } from '../temporal/date-extraction'

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
 *
 * Fires on a strong signal ("when", a weekday, an explicit date literal, a
 * month WITH a day/year, or a relative expression), or on a gated keyword
 * ("before"/"after"/"ago") ONLY when a concrete temporal referent also
 * appears. A bare month name ("may"/"march") or a bare gated keyword no
 * longer classifies ordinary content queries as temporal.
 */
export function isTemporalQuery(query: string): boolean {
  if (!query) return false
  if (hasStrongTemporalSignal(query)) return true
  if (GATED_KEYWORD_PATTERN.test(query) && hasTemporalReferent(query)) return true
  return false
}

/**
 * For temporal queries that themselves reference a concrete date ("what
 * happened last Tuesday", "what did I ship on July 9, 2026"), resolve that
 * date against `anchor` so recall can rank by proximity to it instead of
 * pure recency. Returns undefined when the query has no extractable date
 * (e.g. "when did I last deploy" — a temporal query with no target date, so
 * recall falls back to recency ordering instead of proximity ordering).
 */
export function extractTargetDate(query: string, anchor: Date = new Date()): Date | undefined {
  const { referencedDate, relativeDate } = extractDates(query, anchor)
  const iso = referencedDate ?? relativeDate
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}
