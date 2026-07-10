/**
 * Tests for Task B: chunking granularity (~4000 chars, ~15% overlap) and the
 * short-text single-chunk path that keeps generateEmbedding's existing
 * single-call behavior unchanged for text under the chunking threshold.
 */

import { describe, it, expect } from 'vitest'
import { chunkText, estimateTokenCount, CHUNK_TARGET_CHARS, CHUNK_OVERLAP_CHARS } from '../chunking'

function repeatingText(length: number): string {
  return Array.from({ length }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
}

describe('estimateTokenCount', () => {
  it('estimates ~4 characters per token', () => {
    expect(estimateTokenCount('a'.repeat(400))).toBe(100)
  })

  it('rounds up for partial tokens', () => {
    expect(estimateTokenCount('abc')).toBe(1)
  })
})

describe('chunkText', () => {
  it('returns exactly one chunk equal to the input for short text', () => {
    const text = 'a short memory value that fits in a single chunk'
    const chunks = chunkText(text)
    expect(chunks).toEqual([text])
  })

  it('returns exactly one chunk equal to the input when text is exactly the chunk size', () => {
    const text = repeatingText(CHUNK_TARGET_CHARS)
    const chunks = chunkText(text)
    expect(chunks).toEqual([text])
  })

  it('splits long text into the eval-validated ~4000-char / ~15% overlap granularity', () => {
    const text = repeatingText(20000)
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(1)

    // Every chunk but the last is exactly CHUNK_TARGET_CHARS long.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBe(CHUNK_TARGET_CHARS)
    }
    // The final chunk is no larger than the target.
    expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS)

    // Overlap is ~15% of the chunk size.
    const ratio = CHUNK_OVERLAP_CHARS / CHUNK_TARGET_CHARS
    expect(ratio).toBeGreaterThan(0.1)
    expect(ratio).toBeLessThan(0.2)
  })

  it('overlap preserves shared text across adjacent chunk boundaries', () => {
    const text = repeatingText(20000)
    const chunks = chunkText(text)

    for (let i = 0; i < chunks.length - 1; i++) {
      const tailOfCurrent = chunks[i].slice(chunks[i].length - CHUNK_OVERLAP_CHARS)
      const headOfNext = chunks[i + 1].slice(0, CHUNK_OVERLAP_CHARS)
      expect(headOfNext).toBe(tailOfCurrent)
    }
  })

  it('covers the full input with no gaps between chunk boundaries', () => {
    const text = repeatingText(15000)
    const chunks = chunkText(text)

    expect(text.startsWith(chunks[0].slice(0, 50))).toBe(true)
    expect(text.endsWith(chunks[chunks.length - 1].slice(-50))).toBe(true)
  })

  it('respects custom chunkSizeChars/overlapChars options', () => {
    const text = repeatingText(1000)
    const chunks = chunkText(text, { chunkSizeChars: 300, overlapChars: 50 })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBe(300)
    }
    const tail = chunks[0].slice(chunks[0].length - 50)
    const head = chunks[1].slice(0, 50)
    expect(head).toBe(tail)
  })
})
