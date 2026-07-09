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

/**
 * True when `query` looks like it's asking about timing rather than content:
 * keyword match ("when", "before", "after", "last time", "ago", ...), a
 * weekday or month name, or an explicit date literal (ISO / MM-DD-YYYY).
 */
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
