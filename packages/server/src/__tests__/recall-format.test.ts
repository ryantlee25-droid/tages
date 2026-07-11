/**
 * Tests for Task 13: recall output shaping for the client-agent reader.
 *
 * The real reader of `recall`'s output is the calling client agent (Claude
 * Code, Cursor, etc.), not an LLM inside Tages. This adds a stable [n]
 * passage id, explicit source + date provenance, and a citation preamble —
 * all additive to the existing fields (filePaths, conditions,
 * crossSystemRefs, executionFlow, examples, tags).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleRecall } from '../tools/recall'
import * as embeddingsModule from '../embeddings'
import * as rerankerModule from '../search/reranker'
import * as temporalChannelModule from '../search/temporal-channel'

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

  it('does not crash formatting a recalled memory whose updatedAt/source are undefined (finding 4)', async () => {
    // A legacy/backfilled row surfaced via a remote RPC can arrive without a
    // date or source. formatCiteDate(undefined) used to throw and take down the
    // whole recall tool; it must now degrade to a safe placeholder instead.
    const legacyRow = {
      id: 'legacy-1',
      projectId: TEST_PROJECT,
      key: 'legacy-key',
      value: 'legacy value',
      type: 'convention',
      // no source, no updatedAt
    } as unknown as import('@tages/shared').Memory

    const sync = {
      remoteRecall: async () => [legacyRow],
      remoteHybridRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    // Local cache is empty for this project, so handleRecall falls through to
    // the remote path and formats the malformed row.
    const result = await handleRecall({ query: 'legacy' }, TEST_PROJECT, cache, sync)
    const text = result.content[0].text

    expect(text).toContain('legacy-key')
    expect(text).toContain('updated: unknown')
    expect(text).toContain('source: unknown')
  })
})

describe('PLAN.md Task 4 (server half): assembled-context output', () => {
  let cache: SqliteCache
  let dbPath: string
  const PROJECT = 'test-assembled-context-project'

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-assembled-context-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('assembledContext: true produces one grouped/dated block instead of numbered passages', async () => {
    await handleRemember(
      { key: 'ac-a', value: 'first memory', type: 'convention' },
      PROJECT, cache, null,
    )
    await handleRemember(
      { key: 'ac-b', value: 'second memory', type: 'decision' },
      PROJECT, cache, null,
    )

    const result = await handleRecall(
      { query: 'memory', limit: 10, assembledContext: true },
      PROJECT, cache, null,
    )
    const text = result.content[0].text

    expect(text).toContain('Assembled context for "memory"')
    expect(text).not.toMatch(/\[1\]\s*\[/) // no numbered-passage header
    expect(text).toContain('ac-a')
    expect(text).toContain('ac-b')
  })

  it('assembledContext unset/false produces the existing numbered-passage format, unchanged', async () => {
    await handleRemember(
      { key: 'ac-c', value: 'plain memory', type: 'convention' },
      PROJECT, cache, null,
    )

    const result = await handleRecall({ query: 'ac-c' }, PROJECT, cache, null)
    const text = result.content[0].text

    expect(text).toMatch(/^Found 1 memories for "ac-c"/)
    expect(text).toContain('[1] [convention] ac-c')
  })

  it('returns the same "no memories found" message in assembled-context mode', async () => {
    const result = await handleRecall(
      { query: 'nonexistent-xyz', assembledContext: true },
      PROJECT, cache, null,
    )
    expect(result.content[0].text).toBe('No memories found matching "nonexistent-xyz".')
  })
})

describe('PLAN.md Tasks 6/7 (server): rerank + temporal channel on the remote-hybrid path', () => {
  let cache: SqliteCache
  let dbPath: string
  const PROJECT = 'test-hybrid-rerank-project'
  let embedSpy: ReturnType<typeof vi.spyOn>
  let rerankSpy: ReturnType<typeof vi.spyOn>

  function makeRemoteMemory(id: string): import('@tages/shared').Memory {
    return {
      id,
      projectId: PROJECT,
      key: `key-${id}`,
      value: `value ${id}`,
      type: 'convention',
      source: 'agent',
      status: 'live',
      confidence: 1,
      filePaths: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-hybrid-rerank-test-${Date.now()}-${Math.random()}.db`)
    cache = new SqliteCache(dbPath)
    embedSpy = vi.spyOn(embeddingsModule, 'generateEmbedding').mockResolvedValue([0.1, 0.2, 0.3])
    // Rerank itself is unit-tested against a mocked transformers pipeline in
    // reranker.test.ts — here it's stubbed to identity so these integration
    // tests never attempt to load the real ONNX model (per Task 6's "never
    // download the real model" testing rule).
    rerankSpy = vi.spyOn(rerankerModule, 'rerankMemories').mockImplementation(async (m) => m)
  })

  afterEach(() => {
    cache.close()
    try { fs.unlinkSync(dbPath) } catch { /* ignore */ }
    vi.restoreAllMocks()
  })

  it('widens the candidate-pool limit passed to remoteHybridRecall beyond the user-requested limit', async () => {
    const remoteHybridRecall = vi.fn(async (..._args: unknown[]) => [makeRemoteMemory('r1')])
    const sync = {
      remoteHybridRecall,
      remoteRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    await handleRecall({ query: 'anything', limit: 3 }, PROJECT, cache, sync)

    expect(remoteHybridRecall).toHaveBeenCalled()
    const calledLimit = remoteHybridRecall.mock.calls[0][3]
    expect(calledLimit).toBeGreaterThanOrEqual(50)
    expect(calledLimit).toBeGreaterThan(3)
  })

  it('runs rerank on the remote-hybrid candidate pool, before returning results', async () => {
    const remoteHybridRecall = vi.fn(async (..._args: unknown[]) => [makeRemoteMemory('r1'), makeRemoteMemory('r2')])
    const sync = {
      remoteHybridRecall,
      remoteRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    await handleRecall({ query: 'anything', limit: 5 }, PROJECT, cache, sync)

    expect(rerankSpy).toHaveBeenCalled()
  })

  it('fuses a memory found only via the temporal channel into the final output when a supabaseClient is passed', async () => {
    const remoteHybridRecall = vi.fn(async (..._args: unknown[]) => [makeRemoteMemory('hybrid-only')])
    const sync = {
      remoteHybridRecall,
      remoteRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    const temporalOnly = makeRemoteMemory('temporal-only')
    vi.spyOn(temporalChannelModule, 'fetchTemporalCandidates').mockResolvedValue([temporalOnly])

    const fakeSupabaseClient = {} as unknown as import('@supabase/supabase-js').SupabaseClient

    const result = await handleRecall(
      { query: 'when did this happen', limit: 5 },
      PROJECT, cache, sync, fakeSupabaseClient,
    )
    const text = result.content[0].text

    expect(text).toContain('key-temporal-only')
  })

  it('contributes zero temporal candidates (channel is a no-op) when no supabaseClient is passed', async () => {
    const remoteHybridRecall = vi.fn(async (..._args: unknown[]) => [makeRemoteMemory('hybrid-only')])
    const sync = {
      remoteHybridRecall,
      remoteRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    const fetchSpy = vi.spyOn(temporalChannelModule, 'fetchTemporalCandidates')

    await handleRecall({ query: 'when did this happen', limit: 5 }, PROJECT, cache, sync)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('assembledContext: true on the remote-hybrid path produces the grouped/dated block', async () => {
    const remoteHybridRecall = vi.fn(async (..._args: unknown[]) => [makeRemoteMemory('r1')])
    const sync = {
      remoteHybridRecall,
      remoteRecall: async () => null,
    } as unknown as import('../sync/supabase-sync').SupabaseSync

    const result = await handleRecall(
      { query: 'anything', limit: 5, assembledContext: true },
      PROJECT, cache, sync,
    )
    const text = result.content[0].text

    expect(text).toContain('Assembled context for "anything"')
  })
})
