/**
 * Tests for Task 13: recall output shaping for the client-agent reader.
 *
 * The real reader of `recall`'s output is the calling client agent (Claude
 * Code, Cursor, etc.), not an LLM inside Tages. This adds a stable [n]
 * passage id, explicit source + date provenance, and a citation preamble —
 * all additive to the existing fields (filePaths, conditions,
 * crossSystemRefs, executionFlow, examples, tags).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleRecall } from '../tools/recall'

const TEST_PROJECT = 'test-recall-format-project'

describe('Task 13: recall output shaping', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-recall-format-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('includes a stable [n] passage id, source, and date per result', async () => {
    await handleRemember(
      { key: 'convention-a', value: 'Use tabs not spaces', type: 'convention' },
      TEST_PROJECT,
      cache,
      null,
    )

    const result = await handleRecall({ query: 'convention-a' }, TEST_PROJECT, cache, null)
    const text = result.content[0].text

    expect(text).toMatch(/\[1\] \[convention\] convention-a\s+\(source: agent, updated: \d{4}-\d{2}-\d{2}\)/)
    expect(text).toContain('cite the passage number')
  })

  it('numbers multiple results sequentially and preserves existing fields', async () => {
    await handleRemember(
      {
        key: 'multi-a',
        value: 'value a',
        type: 'convention',
        filePaths: ['src/a.ts'],
        conditions: ['when doing X'],
        tags: ['tag1'],
      },
      TEST_PROJECT,
      cache,
      null,
    )
    await handleRemember(
      { key: 'multi-b', value: 'value b', type: 'decision' },
      TEST_PROJECT,
      cache,
      null,
    )

    const result = await handleRecall({ query: 'multi', limit: 10 }, TEST_PROJECT, cache, null)
    const text = result.content[0].text

    // Both passages present with sequential ids somewhere in the text.
    expect(text).toContain('[1]')
    expect(text).toContain('[2]')
    // Existing structured fields preserved unchanged.
    expect(text).toContain('Files: src/a.ts')
    expect(text).toContain('When: when doing X')
    expect(text).toContain('Tags: tag1')
  })

  it('snapshot: full formatted string for a multi-result case matches the expected shape', async () => {
    await handleRemember(
      { key: 'snap-key', value: 'snapshot value', type: 'lesson', tags: ['t1', 't2'] },
      TEST_PROJECT,
      cache,
      null,
    )

    const result = await handleRecall({ query: 'snap-key' }, TEST_PROJECT, cache, null)
    const text = result.content[0].text

    expect(text).toMatch(
      /^Found 1 memories for "snap-key" \(local \(ranked\)\)\. Passages are numbered \[1\]-\[1\] — cite the passage number\(s\) that support your answer\.\n\n\[1\] \[lesson\] snap-key {2}\(source: agent, updated: \d{4}-\d{2}-\d{2}\)\n {3}snapshot value\n {3}Tags: t1, t2$/,
    )
  })

  it('returns the unchanged "no memories found" message when there are no results', async () => {
    const result = await handleRecall({ query: 'nonexistent-xyz-query' }, TEST_PROJECT, cache, null)
    expect(result.content[0].text).toBe('No memories found matching "nonexistent-xyz-query".')
  })
})
