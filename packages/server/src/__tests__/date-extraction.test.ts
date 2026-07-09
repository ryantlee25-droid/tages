import { describe, it, expect } from 'vitest'
import { extractDates } from '../temporal/date-extraction'

// Fixed anchor for deterministic relative-date resolution.
// 2026-07-08 is a Wednesday (UTC).
const ANCHOR = new Date('2026-07-08T12:00:00.000Z')

describe('extractDates — absolute dates', () => {
  it('parses ISO 8601 (YYYY-MM-DD)', () => {
    const result = extractDates('Shipped this on 2026-07-09.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-09T00:00:00.000Z').toISOString())
  })

  it('parses ISO 8601 with a time component', () => {
    const result = extractDates('Deployed at 2026-07-09T14:30:00.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-09T14:30:00.000Z').toISOString())
  })

  it('parses "Month D, YYYY"', () => {
    const result = extractDates('We launched on July 9, 2026.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-09T00:00:00.000Z').toISOString())
  })

  it('parses "Month Dst/nd/rd/th YYYY" without a comma', () => {
    const result = extractDates('We launched on July 9th 2026.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-09T00:00:00.000Z').toISOString())
  })

  it('parses MM/DD/YYYY', () => {
    const result = extractDates('Filed the report on 07/09/2026.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-09T00:00:00.000Z').toISOString())
  })
})

describe('extractDates — relative expressions', () => {
  it('resolves "N days ago" against the anchor', () => {
    const result = extractDates('This broke 3 days ago.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-07-05T12:00:00.000Z').toISOString())
  })

  it('resolves "N weeks ago" against the anchor', () => {
    const result = extractDates('We discussed this 2 weeks ago.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-06-24T12:00:00.000Z').toISOString())
  })

  it('resolves "N months ago" against the anchor', () => {
    const result = extractDates('Migrated 1 month ago.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-06-08T12:00:00.000Z').toISOString())
  })

  it('resolves "yesterday"', () => {
    const result = extractDates('Fixed yesterday.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-07-07T12:00:00.000Z').toISOString())
  })

  it('resolves "tomorrow"', () => {
    const result = extractDates('Scheduled for tomorrow.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-07-09T12:00:00.000Z').toISOString())
  })

  it('resolves "last <weekday>" to the most recent past occurrence', () => {
    // Anchor is Wednesday 2026-07-08. "last Tuesday" should resolve to
    // 2026-07-07 (one day back), not 2026-06-30 (a week further back).
    const result = extractDates('We talked about it last Tuesday.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-07-07T12:00:00.000Z').toISOString())
  })

  it('resolves "next <weekday>" to the nearest future occurrence', () => {
    // Anchor is Wednesday 2026-07-08. "next Friday" should resolve to
    // 2026-07-10 (two days forward).
    const result = extractDates('Due next Friday.', ANCHOR)
    expect(result.relativeDate).toBe(new Date('2026-07-10T12:00:00.000Z').toISOString())
  })
})

describe('extractDates — both present, no match, and safety', () => {
  it('returns both referencedDate and relativeDate when text has both', () => {
    const result = extractDates('Filed on 2026-07-01, resolved 3 days ago.', ANCHOR)
    expect(result.referencedDate).toBe(new Date('2026-07-01T00:00:00.000Z').toISOString())
    expect(result.relativeDate).toBe(new Date('2026-07-05T12:00:00.000Z').toISOString())
  })

  it('returns {} when the text has no date reference', () => {
    const result = extractDates('This is a convention about API error handling.', ANCHOR)
    expect(result).toEqual({})
  })

  it('never throws on empty string input', () => {
    expect(() => extractDates('', ANCHOR)).not.toThrow()
    expect(extractDates('', ANCHOR)).toEqual({})
  })

  it('defaults the anchor to now when omitted', () => {
    expect(() => extractDates('no dates here')).not.toThrow()
  })
})
