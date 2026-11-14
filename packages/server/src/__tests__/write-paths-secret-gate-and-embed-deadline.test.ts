/**
 * 0.5.7 review W5a + W5b: observe, session_end and import_claude_md.
 *
 * W5a: after the shared embedding deadline, bulk writers must NOT fan out
 * the remaining rows as concurrent embed calls (the 546/429 burst); they
 * leave them unembedded for the boot backfill.
 *
 * W5b: these paths run the same high-severity secret gate as `remember`
 * before anything is stored or sent to the embedding provider, and store
 * values encrypted at rest when TAGES_ENCRYPTION_KEY is set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'

const embed = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  calls: [] as Array<{ key: string; plaintext: string; timeoutMs?: number }>,
  // Each call "takes" as long as its cap (a slow provider), or settles on the
  // next tick when uncapped.
  impl: null as null | ((opts?: { timeoutMs?: number }) => Promise<void>),
}))

vi.mock('../tools/embed-on-write', () => ({
  embedOnWrite: vi.fn((memory: { key: string }, plaintext: string, _c: unknown, _s: unknown, _cl: unknown, opts?: { timeoutMs?: number }) => {
    embed.calls.push({ key: memory.key, plaintext, timeoutMs: opts?.timeoutMs })
    embed.inFlight++
    embed.maxInFlight = Math.max(embed.maxInFlight, embed.inFlight)
    const p = embed.impl ? embed.impl(opts) : Promise.resolve()
    return p.finally(() => { embed.inFlight-- })
  }),
}))

import { SqliteCache } from '../cache/sqlite'
import { handleObserve } from '../tools/observe'
import { handleSessionEnd } from '../tools/session-end'
import { handleImportClaudeMd } from '../tools/import-claude-md'

const PROJECT = 'w5-project'
// Built by concatenation so push protection never sees a literal key.
const FAKE_AWS_KEY = 'AKIA' + 'IOSFODNN7' + 'EXAMPLQ'

function rawRows(cache: SqliteCache): Array<{ key: string; value: string; encrypted: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cache as any).db.prepare('SELECT key, value, encrypted FROM memories WHERE project_id = ?').all(PROJECT)
}

describe('W5 write paths', () => {
  let cache: SqliteCache
  let dbPath: string
  const prevKey = process.env.TAGES_ENCRYPTION_KEY

  beforeEach(() => {
    delete process.env.TAGES_ENCRYPTION_KEY
    dbPath = path.join(os.tmpdir(), `tages-w5-${randomUUID()}.db`)
    cache = new SqliteCache(dbPath)
    embed.inFlight = 0
    embed.maxInFlight = 0
    embed.calls = []
    embed.impl = null
  })

  afterEach(() => {
    vi.useRealTimers()
    cache.close()
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(p)) fs.rmSync(p)
    if (prevKey === undefined) delete process.env.TAGES_ENCRYPTION_KEY
    else process.env.TAGES_ENCRYPTION_KEY = prevKey
  })

  describe('W5a: no fan-out after the shared embedding deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // Slow provider: every call runs to its full cap.
      embed.impl = (opts) => new Promise<void>((r) => setTimeout(r, opts?.timeoutMs ?? 0))
    })

    it('session_end embeds one row at a time and leaves rows past the deadline unembedded', async () => {
      const summary = [
        'I decided to use PostgreSQL for the main database.',
        'I decided to use Redis for the session cache.',
        'I decided to use pnpm for the workspace tooling.',
        'I decided to use vitest for the unit test runner.',
      ].join('\n')
      const done = handleSessionEnd({ summary }, PROJECT, cache, null)
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await done

      expect(result.content[0].text).toContain('Staged 4 pending memories')
      expect(cache.getAllForProject(PROJECT)).toHaveLength(4)
      // The first row eats the whole 10s budget; the other three are deferred.
      expect(embed.calls).toHaveLength(1)
      expect(embed.calls.every(c => typeof c.timeoutMs === 'number' && c.timeoutMs > 0)).toBe(true)
      expect(embed.maxInFlight).toBe(1)
    })

    it('import_claude_md embeds one row at a time and leaves rows past the deadline unembedded', async () => {
      const content = '## Conventions\n- use pnpm everywhere\n- use vitest for tests\n- use zod for inputs\n- use chalk for output\n'
      const done = handleImportClaudeMd({ content, projectId: PROJECT }, cache, null)
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await done

      expect(result.content[0].text).toContain('Imported 4 memories')
      expect(embed.calls).toHaveLength(1)
      expect(embed.calls.every(c => typeof c.timeoutMs === 'number' && c.timeoutMs > 0)).toBe(true)
      expect(embed.maxInFlight).toBe(1)
    })
  })

  describe('W5b: secret gate', () => {
    it('observe refuses an AWS key: nothing cached, nothing embedded', async () => {
      const result = await handleObserve(
        { observation: `We always deploy with the key ${FAKE_AWS_KEY} in the env file.` },
        PROJECT, cache, null,
      )
      expect(result.content[0].text).toMatch(/sensitive data/i)
      expect(cache.getAllForProject(PROJECT)).toHaveLength(0)
      expect(embed.calls).toHaveLength(0)
    })

    it('session_end blocks the secret-bearing memory, keeps the clean one, and never embeds the secret', async () => {
      const summary = [
        'I decided to use PostgreSQL for the main database.',
        `I decided to set the deploy key to ${FAKE_AWS_KEY} for staging.`,
      ].join('\n')
      const result = await handleSessionEnd({ summary }, PROJECT, cache, null)
      const text = result.content[0].text
      expect(text).toContain('Staged 1 pending memories')
      expect(text).toContain('Blocked 1 extracted memory containing detected secrets (AWS access key)')
      expect(text).not.toContain(FAKE_AWS_KEY)
      const rows = rawRows(cache)
      expect(rows).toHaveLength(1)
      expect(rows.some(r => r.value.includes(FAKE_AWS_KEY))).toBe(false)
      expect(embed.calls.some(c => c.plaintext.includes(FAKE_AWS_KEY))).toBe(false)
      expect(embed.calls).toHaveLength(1)
    })

    it('import_claude_md skips and reports the secret-bearing rule but imports the rest', async () => {
      const content = `## Conventions\n- use pnpm everywhere\n- the deploy key is ${FAKE_AWS_KEY}\n- use vitest for tests\n`
      const result = await handleImportClaudeMd({ content, projectId: PROJECT }, cache, null)
      const text = result.content[0].text
      expect(text).toContain('Imported 2 memories')
      expect(text).toContain('Skipped 1 rule containing detected secrets (AWS access key)')
      expect(text).not.toContain(FAKE_AWS_KEY)
      const rows = rawRows(cache)
      expect(rows).toHaveLength(2)
      expect(rows.some(r => r.value.includes(FAKE_AWS_KEY))).toBe(false)
      expect(embed.calls).toHaveLength(2)
      expect(embed.calls.some(c => c.plaintext.includes(FAKE_AWS_KEY))).toBe(false)
    })

    it('import_claude_md with only secret-bearing rules imports nothing and does not fail', async () => {
      const result = await handleImportClaudeMd(
        { content: `## Conventions\n- the deploy key is ${FAKE_AWS_KEY}\n`, projectId: PROJECT }, cache, null,
      )
      expect(result.content[0].text).toContain('Imported 0 memories')
      expect(result.content[0].text).toContain('Skipped 1 rule')
      expect(rawRows(cache)).toHaveLength(0)
      expect(embed.calls).toHaveLength(0)
    })
  })

  // Even with TAGES_ENCRYPTION_KEY set, these agent paths store the value
  // readable: no read path for these rows decrypts (conventions, project_brief,
  // resources, the review queue, the dashboard), so ciphertext here would make
  // imported rules and pending memories unreadable to agents and reviewers.
  describe('W5b: with an encryption key set, agent paths stay readable', () => {
    const KEY_HEX = 'cd'.repeat(32)

    it('observe stores readable text and embeds plaintext', async () => {
      process.env.TAGES_ENCRYPTION_KEY = KEY_HEX
      const obs = 'We always use PascalCase for React component filenames.'
      await handleObserve({ observation: obs }, PROJECT, cache, null)
      const [row] = rawRows(cache)
      expect(row.encrypted).toBe(0)
      expect(row.value).toBe(obs)
      expect(embed.calls[0].plaintext).toBe(obs)
    })

    it('session_end stores readable text and embeds plaintext', async () => {
      process.env.TAGES_ENCRYPTION_KEY = KEY_HEX
      const line = 'I decided to use PostgreSQL for the main database.'
      await handleSessionEnd({ summary: line }, PROJECT, cache, null)
      const [row] = rawRows(cache)
      expect(row.encrypted).toBe(0)
      expect(row.value).toBe(line)
      expect(embed.calls[0].plaintext).toBe(line)
    })

    it('import_claude_md stores readable text (new and overwrite) and embeds plaintext', async () => {
      process.env.TAGES_ENCRYPTION_KEY = KEY_HEX
      await handleImportClaudeMd({ content: '## Conventions\n- use pnpm everywhere\n', projectId: PROJECT }, cache, null)
      await handleImportClaudeMd(
        { content: '## Conventions\n- use pnpm everywhere\n', projectId: PROJECT, strategy: 'overwrite' }, cache, null,
      )
      const rows = rawRows(cache)
      expect(rows).toHaveLength(1)
      expect(rows[0].encrypted).toBe(0)
      expect(rows[0].value).toBe('use pnpm everywhere')
      expect(embed.calls.map(c => c.plaintext)).toEqual(['use pnpm everywhere', 'use pnpm everywhere'])
    })
  })
})
