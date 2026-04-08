import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeProjectConfig,
  TEST_LOCAL_CONFIG,
  TEST_PROJECT_CONFIG,
} from './helpers.js'

// --- Mocks must be declared before importing the module under test ---

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

// vi.mock factories are hoisted to top — cannot reference variables declared below.
// Use vi.fn() inline and reassign behaviour in beforeEach via mockImplementation.
vi.mock('../sync/cli-sync.js', () => ({
  openCliSync: vi.fn(),
}))

// Silence ora spinner output
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  }),
}))

// Import after mocks are set up
import { importCommand } from '../commands/import.js'
import { openCliSync } from '../sync/cli-sync.js'

// Suppress chalk colors in tests
process.env.FORCE_COLOR = '0'

// Suppress process.exit
vi.spyOn(process, 'exit').mockImplementation(((_code?: number | string | null) => {
  throw new Error(`process.exit called with ${_code}`)
}) as never)

describe('importCommand', () => {
  let tmpFile: string
  let mockCache: {
    getByKey: ReturnType<typeof vi.fn>
    upsertMemory: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  let mockFlush: ReturnType<typeof vi.fn>
  let mockClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const { configDir, cleanup } = setupTempConfigDir()
    tempConfigDir = configDir
    cleanupFn = cleanup

    // Write local config (no supabaseUrl)
    writeProjectConfig(configDir, { ...TEST_LOCAL_CONFIG })

    // Reset all mocks
    vi.clearAllMocks()

    mockCache = {
      getByKey: vi.fn().mockReturnValue(null),
      upsertMemory: vi.fn(),
      close: vi.fn(),
    }
    mockFlush = vi.fn().mockResolvedValue(undefined)
    mockClose = vi.fn()

    vi.mocked(openCliSync).mockResolvedValue({
      cache: mockCache,
      flush: mockFlush,
      close: mockClose,
    } as unknown as Awaited<ReturnType<typeof openCliSync>>)

    // Create a temp JSON file for import
    tmpFile = path.join(os.tmpdir(), `tages-import-test-${Date.now()}.json`)
  })

  afterEach(() => {
    cleanupFn?.()
    if (fs.existsSync(tmpFile)) {
      fs.rmSync(tmpFile)
    }
  })

  it('import works in local mode (no supabaseUrl)', async () => {
    const memories = [
      { key: 'test-key', value: 'test value', type: 'convention' },
    ]
    fs.writeFileSync(tmpFile, JSON.stringify(memories))

    // Should NOT throw or exit — local mode must work
    await expect(
      importCommand(tmpFile, { strategy: 'skip', project: TEST_LOCAL_CONFIG.slug })
    ).resolves.toBeUndefined()

    // openCliSync was called with the config
    expect(openCliSync).toHaveBeenCalledOnce()
    const callArg = vi.mocked(openCliSync).mock.calls[0][0]
    expect(callArg.projectId).toBe(TEST_LOCAL_CONFIG.projectId)

    // Memory was written to SQLite cache
    expect(mockCache.upsertMemory).toHaveBeenCalledOnce()
    const memory = mockCache.upsertMemory.mock.calls[0][0]
    expect(memory.key).toBe('test-key')
    expect(memory.value).toBe('test value')
    expect(memory.projectId).toBe(TEST_LOCAL_CONFIG.projectId)

    // dirty=true (second arg)
    expect(mockCache.upsertMemory.mock.calls[0][1]).toBe(true)

    // flush was called
    expect(mockFlush).toHaveBeenCalledOnce()

    // close was called (finally block)
    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('import writes to SQLite first, then flushes', async () => {
    const memories = [
      { key: 'alpha', value: 'alpha value', type: 'decision' },
      { key: 'beta', value: 'beta value', type: 'lesson' },
    ]
    fs.writeFileSync(tmpFile, JSON.stringify(memories))

    // Track call order
    const callOrder: string[] = []
    mockCache.upsertMemory.mockImplementation(() => { callOrder.push('upsert') })
    mockFlush.mockImplementation(async () => { callOrder.push('flush') })

    await importCommand(tmpFile, { strategy: 'skip', project: TEST_LOCAL_CONFIG.slug })

    // Both rows written before flush
    expect(callOrder).toEqual(['upsert', 'upsert', 'flush'])

    // upsertMemory called twice with dirty=true
    expect(mockCache.upsertMemory).toHaveBeenCalledTimes(2)
    expect(mockCache.upsertMemory.mock.calls[0][1]).toBe(true)
    expect(mockCache.upsertMemory.mock.calls[1][1]).toBe(true)

    // flush called once after all upserts
    expect(mockFlush).toHaveBeenCalledOnce()

    // close called in finally
    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('import flush failure does not lose SQLite writes', async () => {
    const memories = [
      { key: 'resilient-key', value: 'resilient value', type: 'architecture' },
    ]
    fs.writeFileSync(tmpFile, JSON.stringify(memories))

    // flush throws (simulates network failure)
    mockFlush.mockRejectedValue(new Error('Network unavailable'))

    // The command propagates the flush error, but SQLite write already happened before flush()
    let thrownError: Error | null = null
    try {
      await importCommand(tmpFile, { strategy: 'skip', project: TEST_LOCAL_CONFIG.slug })
    } catch (err) {
      thrownError = err as Error
    }

    // SQLite write happened before flush — regardless of flush outcome
    expect(mockCache.upsertMemory).toHaveBeenCalledOnce()
    const memory = mockCache.upsertMemory.mock.calls[0][0]
    expect(memory.key).toBe('resilient-key')
    expect(memory.value).toBe('resilient value')

    // close was called even though flush failed (finally block)
    expect(mockClose).toHaveBeenCalledOnce()

    // flush failure propagates (acceptable — the SQLite write is already durable)
    expect(thrownError).not.toBeNull()
    expect(thrownError!.message).toContain('Network unavailable')
  })

  it('import skips duplicate keys with skip strategy', async () => {
    const memories = [
      { key: 'existing-key', value: 'new value', type: 'convention' },
      { key: 'new-key', value: 'new value', type: 'convention' },
    ]
    fs.writeFileSync(tmpFile, JSON.stringify(memories))

    // existing-key is already in cache
    mockCache.getByKey.mockImplementation((_projectId: string, key: string) => {
      if (key === 'existing-key') {
        return {
          id: 'existing-id',
          key: 'existing-key',
          value: 'old value',
          createdAt: '2024-01-01T00:00:00Z',
        }
      }
      return null
    })

    await importCommand(tmpFile, { strategy: 'skip', project: TEST_LOCAL_CONFIG.slug })

    // Only new-key was upserted
    expect(mockCache.upsertMemory).toHaveBeenCalledOnce()
    expect(mockCache.upsertMemory.mock.calls[0][0].key).toBe('new-key')
  })

  it('import works in cloud mode (supabaseUrl present)', async () => {
    writeProjectConfig(tempConfigDir, { ...TEST_PROJECT_CONFIG })
    const memories = [
      { key: 'cloud-key', value: 'cloud value', type: 'pattern' },
    ]
    fs.writeFileSync(tmpFile, JSON.stringify(memories))

    await importCommand(tmpFile, { strategy: 'skip', project: TEST_PROJECT_CONFIG.slug })

    // openCliSync called — handles cloud internally
    expect(openCliSync).toHaveBeenCalledOnce()
    // SQLite write still happens
    expect(mockCache.upsertMemory).toHaveBeenCalledOnce()
    // flush still called
    expect(mockFlush).toHaveBeenCalledOnce()
    // close still called
    expect(mockClose).toHaveBeenCalledOnce()
  })
})
