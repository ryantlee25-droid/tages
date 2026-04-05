import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteCache } from '../cache/sqlite'
import { QueryLog } from '../cache/query-log'
import { computeSuggestions, handleSuggestions } from '../tools/suggestion-engine'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const TEST_PROJECT = 'test-suggest-project'

function createTestSetup(): { cache: SqliteCache; queryLog: QueryLog; dbPath: string; logPath: string } {
  const dbPath = path.join(os.tmpdir(), `tages-suggest-db-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const logPath = path.join(os.tmpdir(), `tages-suggest-log-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  return {
    cache: new SqliteCache(dbPath),
    queryLog: new QueryLog(logPath),
    dbPath,
    logPath,
  }
}

describe('suggestion engine', () => {
  let cache: SqliteCache
  let queryLog: QueryLog
  let dbPath: string
  let logPath: string

  beforeEach(() => {
    const result = createTestSetup()
    cache = result.cache
    queryLog = result.queryLog
    dbPath = result.dbPath
    logPath = result.logPath
  })

  afterEach(() => {
    cache.close()
    queryLog.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(logPath) } catch {}
  })

  it('returns no suggestions when no misses logged', async () => {
    const result = await handleSuggestions(TEST_PROJECT, cache, queryLog)
    expect(result.content[0].text).toContain('No suggestions')
  })

  it('logs misses and returns them via getTopMissPatterns', () => {
    queryLog.logMiss(TEST_PROJECT, 'auth pattern')
    queryLog.logMiss(TEST_PROJECT, 'auth pattern')
    queryLog.logMiss(TEST_PROJECT, 'auth pattern')
    const patterns = queryLog.getTopMissPatterns(TEST_PROJECT, 10)
    expect(patterns.length).toBe(1)
    expect(patterns[0].query).toBe('auth pattern')
    expect(patterns[0].count).toBe(3)
  })

  it('clusters patterns by first word', () => {
    const patterns = [
      { query: 'auth token', count: 3, lastMissedAt: new Date().toISOString() },
      { query: 'auth session', count: 2, lastMissedAt: new Date().toISOString() },
      { query: 'database schema', count: 1, lastMissedAt: new Date().toISOString() },
    ]
    const suggestions = computeSuggestions(patterns)
    const authSuggestion = suggestions.find((s) => s.topic === 'auth')
    expect(authSuggestion).toBeDefined()
    expect(authSuggestion!.missCount).toBe(5)
  })

  it('ranks suggestions by miss count descending', () => {
    const patterns = [
      { query: 'banana split', count: 1, lastMissedAt: new Date().toISOString() },
      { query: 'apple cider', count: 5, lastMissedAt: new Date().toISOString() },
      { query: 'cherry pie', count: 3, lastMissedAt: new Date().toISOString() },
    ]
    const suggestions = computeSuggestions(patterns)
    expect(suggestions[0].topic).toBe('apple')
    expect(suggestions[1].topic).toBe('cherry')
    expect(suggestions[2].topic).toBe('banana')
  })

  it('handleSuggestions includes suggestion text', async () => {
    queryLog.logMiss(TEST_PROJECT, 'deployment pipeline')
    queryLog.logMiss(TEST_PROJECT, 'deployment config')
    const result = await handleSuggestions(TEST_PROJECT, cache, queryLog)
    expect(result.content[0].text).toContain('Memory Suggestions')
    expect(result.content[0].text).toContain('deployment')
  })
})
