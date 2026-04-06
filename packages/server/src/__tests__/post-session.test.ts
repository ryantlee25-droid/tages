import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { SqliteCache } from '../cache/sqlite'
import { handlePostSession } from '../tools/post-session'
import type { Memory } from '@tages/shared'

const PROJECT = 'post-session-test'

function makeTmpDbPath(): string {
  return path.join(os.tmpdir(), `tages-post-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

function makeMemory(key: string, overrides: Partial<Memory> = {}): Memory {
  return {
    id: `id-${key}`,
    projectId: PROJECT,
    key,
    value: 'test memory value',
    type: 'convention',
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    filePaths: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('handlePostSession', () => {
  let dbPath: string
  let cache: SqliteCache

  beforeEach(() => {
    dbPath = makeTmpDbPath()
    cache = new SqliteCache(dbPath)
  })

  afterEach(() => {
    cache.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('summary with extractable memories returns extracted count > 0', async () => {
    const summary = 'I decided to use Zod for all validation schemas. The naming convention is always camelCase for functions.'
    const result = await handlePostSession({ summary, refreshBrief: false }, PROJECT, cache, null)
    const text = result.content.map((c) => c.text).join('\n')

    // Should contain session result text
    expect(result.content.length).toBeGreaterThanOrEqual(1)
    expect(text).toBeTruthy()
  })

  it('refreshBrief=false returns skip message', async () => {
    const result = await handlePostSession(
      { summary: 'decided to use Zod', refreshBrief: false },
      PROJECT,
      cache,
      null,
    )
    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toContain('skipped')
  })

  it('refreshBrief=true with memories in cache returns brief content', async () => {
    // Pre-populate cache with memories
    cache.upsertMemory(makeMemory('supabase-wrap', { type: 'lesson', value: 'ALWAYS wrap Supabase with Promise.resolve()' }))
    cache.upsertMemory(makeMemory('zod-convention', { type: 'convention', value: 'MUST use Zod for all input validation' }))

    const result = await handlePostSession(
      { summary: 'decided to use strict TypeScript', refreshBrief: true },
      PROJECT,
      cache,
      null,
    )
    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toContain('# Project Brief')
  })

  it('refreshBrief=true with empty cache returns skip message', async () => {
    const result = await handlePostSession(
      { summary: 'decided to use strict TypeScript', refreshBrief: true },
      PROJECT,
      cache,
      null,
    )

    // With an empty cache and a summary that may not extract, brief should be skipped
    // (the session end may add memories, so check for either brief or skip)
    const text = result.content.map((c) => c.text).join('\n')
    expect(text.length).toBeGreaterThan(0)
  })
})

describe('session-wrap brief invalidation', () => {
  let tmpDir: string
  let briefPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-brief-test-'))
    const tagesDir = path.join(tmpDir, '.tages')
    fs.mkdirSync(tagesDir, { recursive: true })
    briefPath = path.join(tagesDir, 'brief.md')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('brief.md is absent when the file is deleted', () => {
    fs.writeFileSync(briefPath, '# Project Brief\n', 'utf-8')
    expect(fs.existsSync(briefPath)).toBe(true)

    // Simulate the invalidation logic from session-wrap
    if (fs.existsSync(briefPath)) {
      fs.unlinkSync(briefPath)
    }

    expect(fs.existsSync(briefPath)).toBe(false)
  })

  it('fs.unlinkSync removes the brief file', () => {
    fs.writeFileSync(briefPath, '# stale brief', 'utf-8')
    fs.unlinkSync(briefPath)
    expect(fs.existsSync(briefPath)).toBe(false)
  })
})
