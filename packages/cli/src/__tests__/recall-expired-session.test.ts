import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { setupTempConfigDir, writeProjectConfig, captureConsole } from './helpers.js'

/**
 * An expired session yields an anonymous client, and every RLS-protected read
 * then returns zero rows — identical output to a project that genuinely has no
 * memories. `recall` used to print "No memories found" and exit 0 on a dead
 * session, so neither a human skimming the output nor a script checking the
 * exit code could tell a broken login from an empty project.
 */

let sessionStatus: 'authenticated' | 'expired' | 'anonymous' | 'service-key' = 'expired'

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClientWithStatus: vi.fn(async () => ({
    supabase: {
      auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
      from: vi.fn(() => {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.order = () => builder
        builder.limit = () => Promise.resolve({ data: [], error: null })
        return builder
      }),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    },
    status: sessionStatus,
  })),
}))

vi.mock('../lib/reranker.js', () => ({
  rerankCandidates: vi.fn(async (_q: string, c: Array<{ id: string }>) => c.map((x) => x.id)),
}))

let tempConfigDir: string
let cleanupFn: () => void

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import { recallCommand } from '../commands/recall.js'

describe('recall on an expired session', () => {
  let console_: ReturnType<typeof captureConsole>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    writeProjectConfig(tempConfigDir)
    console_ = captureConsole()
    sessionStatus = 'expired'
    vi.clearAllMocks()
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  it('exits non-zero instead of reporting an empty result', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('anything', { project: 'test-project' }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it('says the session expired rather than "no memories found"', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('anything', { project: 'test-project' }),
    ).rejects.toThrow('process.exit called')

    const output = console_.errors.join('\n') + console_.logs.join('\n')
    expect(output).toMatch(/session has expired/i)
    expect(output).not.toMatch(/No memories found/i)

    exitSpy.mockRestore()
  })

  it('names `tages login` as the fix, never `tages init`', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      recallCommand('anything', { project: 'test-project' }),
    ).rejects.toThrow('process.exit called')

    const output = console_.errors.join('\n')
    expect(output).toContain('tages login')
    // `init` CREATES a project — pointing an expired user at it is what
    // produces duplicate slugs and local-only stores.
    expect(output).not.toMatch(/tages init/)

    exitSpy.mockRestore()
  })

  it('does NOT block recall when the session is merely anonymous (local/offline use)', async () => {
    sessionStatus = 'anonymous'
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    // Anonymous is a legitimate state for a local-only project; it must not be
    // turned into a hard failure by the expiry guard.
    await recallCommand('anything', { project: 'test-project' }).catch(() => {})

    expect(exitSpy).not.toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
