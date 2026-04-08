import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type { Memory } from '@tages/shared'

// We test the storage path by mocking the heavy dependencies
// (git operations and LLM analysis) and verifying that memories
// end up written to SQLite via openCliSync.

// Mock git/analyzer modules — they require a real git repo at runtime
vi.mock('../indexer/diff-analyzer.js', () => ({
  detectMode: vi.fn().mockResolvedValue('dumb'),
  getGitDiff: vi.fn().mockReturnValue({ diff: 'mock diff', stat: 'mock stat' }),
  getCommitsSince: vi.fn().mockReturnValue(['abc1234']),
  analyzeDiff: vi.fn().mockResolvedValue([
    {
      key: 'test/pattern',
      value: 'Use this pattern for testing',
      type: 'pattern',
      files_affected: ['src/foo.ts'],
    },
  ]),
}))

vi.mock('../indexer/install-hook.js', () => ({
  installPostCommitHook: vi.fn().mockReturnValue({ installed: true, path: '/tmp/.git/hooks/post-commit' }),
}))

vi.mock('../config/project.js', () => ({
  loadProjectConfig: vi.fn(),
}))

// We will control openCliSync per-test
vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: vi.fn(),
}))

import { indexCommand } from '../commands/index.js'
import { loadProjectConfig } from '../config/project.js'
import { openCliSync } from '../sync/cli-sync.js'

const mockLoadProjectConfig = vi.mocked(loadProjectConfig)
const mockOpenCliSync = vi.mocked(openCliSync)

function makeBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj-test-123',
    slug: 'test-proj',
    ...overrides,
  }
}

function makeSyncContext(overrides: {
  upsertMemory?: ReturnType<typeof vi.fn>
  flush?: ReturnType<typeof vi.fn>
  close?: ReturnType<typeof vi.fn>
} = {}) {
  const upsertMemory = overrides.upsertMemory ?? vi.fn()
  const flush = overrides.flush ?? vi.fn().mockResolvedValue(undefined)
  const close = overrides.close ?? vi.fn()

  return {
    cache: {
      upsertMemory,
      close: vi.fn(),
    },
    flush,
    close,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Suppress spinner + console output during tests
  vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('indexCommand', () => {
  it('stores memories to SQLite when no cloud config', async () => {
    const config = makeBaseConfig()
    mockLoadProjectConfig.mockReturnValue(config as ReturnType<typeof loadProjectConfig>)

    const ctx = makeSyncContext()
    mockOpenCliSync.mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof openCliSync>>)

    await indexCommand({ lastCommit: true })

    // openCliSync should have been called with the config
    expect(mockOpenCliSync).toHaveBeenCalledWith(config)

    // upsertMemory should have been called with dirty=true
    expect(ctx.cache.upsertMemory).toHaveBeenCalledTimes(1)
    const [storedMemory, dirty] = (ctx.cache.upsertMemory as ReturnType<typeof vi.fn>).mock.calls[0] as [Memory, boolean]
    expect(dirty).toBe(true)
    expect(storedMemory.key).toBe('test/pattern')
    expect(storedMemory.projectId).toBe('proj-test-123')
    expect(storedMemory.source).toBe('auto_index')

    // flush is always called
    expect(ctx.flush).toHaveBeenCalledTimes(1)

    // close is always called (finally block)
    expect(ctx.close).toHaveBeenCalledTimes(1)
  })

  it('stores memories to SQLite before flushing to cloud', async () => {
    const config = makeBaseConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    })
    mockLoadProjectConfig.mockReturnValue(config as ReturnType<typeof loadProjectConfig>)

    const callOrder: string[] = []
    const upsertMemory = vi.fn().mockImplementation(() => callOrder.push('upsert'))
    const flush = vi.fn().mockImplementation(async () => { callOrder.push('flush') })
    const close = vi.fn().mockImplementation(() => callOrder.push('close'))

    const ctx = makeSyncContext({ upsertMemory, flush, close })
    mockOpenCliSync.mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof openCliSync>>)

    await indexCommand({ lastCommit: true })

    // upsert must happen before flush
    expect(callOrder.indexOf('upsert')).toBeLessThan(callOrder.indexOf('flush'))
    // flush must happen before close
    expect(callOrder.indexOf('flush')).toBeLessThan(callOrder.indexOf('close'))
  })

  it('succeeds even when flush fails', async () => {
    const config = makeBaseConfig()
    mockLoadProjectConfig.mockReturnValue(config as ReturnType<typeof loadProjectConfig>)

    // flush rejects — openCliSync wraps errors so flush itself won't throw,
    // but test that close() is still called even if flush somehow throws
    const flush = vi.fn().mockRejectedValue(new Error('network error'))
    const close = vi.fn()

    const ctx = makeSyncContext({ flush, close })
    mockOpenCliSync.mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof openCliSync>>)

    // Should not throw despite flush rejection — the finally block must run close()
    // The error will bubble up since we're not swallowing it at this level,
    // but close() must still be called
    try {
      await indexCommand({ lastCommit: true })
    } catch {
      // acceptable — the key assertion is that close was called
    }

    expect(ctx.close).toHaveBeenCalledTimes(1)
    expect(ctx.cache.upsertMemory).toHaveBeenCalled()
  })
})
