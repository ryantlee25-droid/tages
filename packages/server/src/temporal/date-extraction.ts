/**
 * Rule-based date extraction for 3-date temporal anchoring (migration 0060).
 *
 * Parses memory text for two categories of date reference:
 *   - Absolute dates (ISO 8601, "Month D, YYYY", "MM/DD/YYYY") -> referencedDate
 *   - Relative expressions ("N days/weeks/months ago", "last/next <weekday>",
 *     "yesterday", "tomorrow") -> relativeDate, resolved against an anchor
 *     date (normally the memory's createdAt / write time).
 *
 * Regex-only, no new runtime deps — consistent with the embedding/chunking
 * modules' existing no-new-deps convention. LLM-assisted extraction is a
 * flagged Tier-2 follow-on, not built here.
 *
 * Duplicated in packages/cli/src/lib/date-extraction.ts (same pattern as the
 * embedding.ts / chunking.ts CLI copies): the CLI package cannot depend on
 * @tages/server at runtime, so keep both copies logic-identical by hand.
 */

export interface ExtractedDates {
  referencedDate?: string
  relativeDate?: string
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

function toIso(date: Date): string | undefined {
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Absolute date patterns: ISO 8601, "Month D, YYYY", "MM/DD/YYYY". */
function extractAbsoluteDate(text: string): Date | undefined {
  // ISO 8601: YYYY-MM-DD, optionally with a time component.
  const isoMatch = text.match(
    /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\b/,
  )
  if (isoMatch) {
    const [, y, mo, d, h = '00', mi = '00', s = '00'] = isoMatch
    const month = Number(mo)
    const day = Number(d)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(Number(y), month - 1, day, Number(h), Number(mi), Number(s)))
      if (!Number.isNaN(date.getTime())) return date
    }
  }

  // "Month D, YYYY" / "Month D YYYY" / "Month Dst/nd/rd/th, YYYY"
  const monthPattern = new RegExp(
    `\\b(${MONTH_NAMES.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    'i',
  )
  const monthMatch = text.match(monthPattern)
  if (monthMatch) {
    const monthIndex = MONTH_NAMES.indexOf(monthMatch[1].toLowerCase())
    const day = Number(monthMatch[2])
    const year = Number(monthMatch[3])
    if (monthIndex >= 0 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, monthIndex, day))
      if (!Number.isNaN(date.getTime())) return date
    }
  }

  // MM/DD/YYYY
  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (slashMatch) {
    const month = Number(slashMatch[1])
    const day = Number(slashMatch[2])
    const year = Number(slashMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month - 1, day))
      if (!Number.isNaN(date.getTime())) return date
    }
  }

  return undefined
}

/** Relative expressions resolved against `anchorDate`. */
function extractRelativeDate(text: string, anchorDate: Date): Date | undefined {
  const lower = text.toLowerCase()

  if (/\byesterday\b/.test(lower)) {
    const d = new Date(anchorDate)
    d.setUTCDate(d.getUTCDate() - 1)
    return d
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(anchorDate)
    d.setUTCDate(d.getUTCDate() + 1)
    return d
  }

  // "N days/weeks/months ago"
  const agoMatch = lower.match(/\b(\d+)\s+(day|days|week|weeks|month|months)\s+ago\b/)
  if (agoMatch) {
    const n = Number(agoMatch[1])
    const unit = agoMatch[2]
    const d = new Date(anchorDate)
    if (unit.startsWith('day')) d.setUTCDate(d.getUTCDate() - n)
    else if (unit.startsWith('week')) d.setUTCDate(d.getUTCDate() - n * 7)
    else if (unit.startsWith('month')) d.setUTCMonth(d.getUTCMonth() - n)
    return d
  }

  // "last/next <weekday>"
  const weekdayPattern = new RegExp(`\\b(last|next)\\s+(${WEEKDAY_NAMES.join('|')})\\b`)
  const weekdayMatch = lower.match(weekdayPattern)
  if (weekdayMatch) {
    const direction = weekdayMatch[1]
    const targetDow = WEEKDAY_NAMES.indexOf(weekdayMatch[2])
    const d = new Date(anchorDate)
    const currentDow = d.getUTCDay()
    if (direction === 'last') {
      let diff = currentDow - targetDow
      if (diff <= 0) diff += 7
      d.setUTCDate(d.getUTCDate() - diff)
    } else {
      let diff = targetDow - currentDow
      if (diff <= 0) diff += 7
      d.setUTCDate(d.getUTCDate() + diff)
    }
    return d
  }

  return undefined
}

/**
 * Extract referenced (absolute) and relative dates from `text`, resolving
 * relative expressions against `anchorDate`. Never throws — a no-match (or
 * any unexpected error) returns `{}` so callers on the write-time hot path
 * (remember.ts) never fail a memory write over an extraction quirk.
 */
export function extractDates(text: string, anchorDate: Date = new Date()): ExtractedDates {
  try {
    const result: ExtractedDates = {}

    const absolute = extractAbsoluteDate(text)
    if (absolute) {
      const iso = toIso(absolute)
      if (iso) result.referencedDate = iso
    }

    const relative = extractRelativeDate(text, anchorDate)
    if (relative) {
      const iso = toIso(relative)
      if (iso) result.relativeDate = iso
    }

    return result
  } catch {
    return {}
  }
}
