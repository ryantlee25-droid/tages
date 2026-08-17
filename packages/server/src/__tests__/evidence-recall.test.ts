import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SqliteCache } from '../cache/sqlite'
import { handleRemember } from '../tools/remember'
import { handleRecall } from '../tools/recall'
import { applyEvidenceWeight } from '../search/evidence-weighting'

/**
 * Evidence levels end to end through the server (migration 0070).
 *
 * Two properties matter and neither is provable from the type alone: an agent
 * that says nothing gets the cautious label rather than the flattering one, and
 * the level actually reorders results. A level that is stored but never changes
 * what comes back first is decoration.
 */

const TEST_PROJECT = 'evidence-test-project'

describe('evidence levels', () => {
  let cache: SqliteCache
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `tages-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (fs.existsSync(p)) fs.rmSync(p)
    }
  })

  it('defaults an agent write to inferred, never to verified', async () => {
    await handleRemember({ key: 'k1', value: 'The retry backoff looks exponential', type: 'lesson' }, TEST_PROJECT, cache, null)
    expect(cache.getByKey(TEST_PROJECT, 'k1')?.evidence).toBe('inferred')
  })

  it('honours an explicit level', async () => {
    await handleRemember(
      { key: 'k2', value: 'The smoke suite finishes in four minutes', type: 'lesson', evidence: 'verified' },
      TEST_PROJECT,
      cache,
      null,
    )
    expect(cache.getByKey(TEST_PROJECT, 'k2')?.evidence).toBe('verified')
  })

  it('round-trips the level through the local cache', async () => {
    for (const level of ['verified', 'declared', 'observed', 'inferred', 'disputed'] as const) {
      await handleRemember(
        { key: `rt-${level}`, value: `value for ${level}`, type: 'lesson', evidence: level },
        TEST_PROJECT,
        cache,
        null,
      )
      expect(cache.getByKey(TEST_PROJECT, `rt-${level}`)?.evidence).toBe(level)
    }
  })

  it('surfaces the level in recall output so the reader can weigh the claim', async () => {
    await handleRemember(
      { key: 'shown', value: 'pool ceiling is 40', type: 'operational', evidence: 'verified' },
      TEST_PROJECT,
      cache,
      null,
    )
    const out = (await handleRecall({ query: 'shown' }, TEST_PROJECT, cache, null)).content[0].text
    expect(out).toContain('evidence: verified')
  })

  it('marks a disputed memory loudly rather than serving it as a plain fact', async () => {
    await handleRemember(
      { key: 'contested', value: 'deploys run from release only', type: 'operational', evidence: 'disputed' },
      TEST_PROJECT,
      cache,
      null,
    )
    const out = (await handleRecall({ query: 'contested' }, TEST_PROJECT, cache, null)).content[0].text
    expect(out).toContain('DISPUTED')
    // The warning has to say what to DO, not just tag it.
    expect(out).toMatch(/re-check|do not act/i)
  })

  it('omits the field entirely for a row that has no level, rather than labelling it unknown', () => {
    // A pre-0070 row. A label would imply an assessment nobody made.
    cache.upsertMemory(
      {
        id: 'legacy-1',
        projectId: TEST_PROJECT,
        key: 'legacy',
        value: 'written before evidence levels existed',
        type: 'lesson',
        source: 'manual',
        status: 'live',
        confidence: 1,
        filePaths: [],
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never,
      false,
    )
    expect(cache.getByKey(TEST_PROJECT, 'legacy')?.evidence).toBeUndefined()
  })

  it('the weighting flips an ordering that raw scores would get wrong', () => {
    // Deterministic, and the reason this is a unit test rather than an
    // assertion through handleRecall. Through the full stack the local scorer
    // saturates textScore at 1.0 for every row matching all query terms and
    // drops the rest, so two competing memories arrive TIED — and a tie is
    // broken arbitrarily. Measured: six identical runs produced two different
    // orders. A ranking test written against that stack passes or fails by
    // chance; an earlier version of this test did exactly that, and still
    // passed with the weighting stubbed out entirely.
    //
    // Here the inferred claim starts with a strictly HIGHER score, so the only
    // thing that can put the verified one first is the weighting.
    const results = [
      { memory: { key: 'guess', evidence: 'inferred' }, textScore: 0.9, semanticScore: 0.9 },
      { memory: { key: 'checked', evidence: 'verified' }, textScore: 0.8, semanticScore: 0.8 },
    ] as never

    const weighted = applyEvidenceWeight(results)
    const guess = weighted.find(r => r.memory.key === 'guess')!
    const checked = weighted.find(r => r.memory.key === 'checked')!

    expect(checked.textScore).toBeGreaterThan(guess.textScore)
    expect(checked.semanticScore).toBeGreaterThan(guess.semanticScore)
  })

  it('leaves a row with no evidence level untouched', () => {
    const results = [{ memory: { key: 'legacy' }, textScore: 0.8, semanticScore: 0.6 }] as never
    const [out] = applyEvidenceWeight(results)
    expect(out.textScore).toBe(0.8)
    expect(out.semanticScore).toBe(0.6)
  })

  it('does not mutate its input', () => {
    const results = [{ memory: { key: 'k', evidence: 'disputed' }, textScore: 1, semanticScore: 1 }]
    applyEvidenceWeight(results as never)
    expect(results[0].textScore).toBe(1)
  })
})
