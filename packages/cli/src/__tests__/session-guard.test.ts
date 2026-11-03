import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { setupTempConfigDir, writeAuthConfig, captureConsole } from './helpers.js'

// Central dead-session guard (bug 11): createAuthenticatedClient exits 1 on
// `expired` / `anonymous` when a cloud URL is configured, unless
// allowDeadSession. createAuthenticatedClientWithStatus is unchanged.

const { mockAuth, mockClient } = vi.hoisted(() => {
  const mockAuth = {
    setSession: vi.fn(),
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
  return { mockAuth, mockClient: { auth: mockAuth, from: vi.fn() } }
})

vi.mock('@tages/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tages/shared')>()),
  createSupabaseClient: vi.fn(() => mockClient),
  persistSessionOnRefresh: vi.fn(),
}))

let tempConfigDir: string
vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import {
  createAuthenticatedClient,
  createAuthenticatedClientWithStatus,
} from '../auth/session.js'

const URL = 'https://test.supabase.co'
const KEY = 'anon'

function makeExpired() {
  writeAuthConfig(tempConfigDir)
  mockAuth.setSession.mockResolvedValue({ data: {}, error: null })
  mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } })
  mockAuth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } })
}

function makeLive() {
  writeAuthConfig(tempConfigDir)
  mockAuth.setSession.mockResolvedValue({ data: {}, error: null })
  mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: 'a' } }, error: null })
}

describe('createAuthenticatedClient dead-session guard', () => {
  let console_: ReturnType<typeof captureConsole>
  let cleanup: () => void
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanup = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()
    delete process.env.TAGES_SERVICE_KEY
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    console_.restore()
    cleanup()
    delete process.env.TAGES_SERVICE_KEY
  })

  it('exits 1 on an expired session with the login message', async () => {
    makeExpired()
    await expect(createAuthenticatedClient(URL, KEY, { action: 'load pending memories' })).rejects.toThrow(
      'process.exit called',
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(console_.errors.join('\n')).toContain(
      'Cannot load pending memories: your session has expired. Run `tages login`.',
    )
  })

  it('exits 1 when signed out (anonymous)', async () => {
    await expect(createAuthenticatedClient(URL, KEY)).rejects.toThrow('process.exit called')
    expect(console_.errors.join('\n')).toMatch(/you are not signed in\. Run `tages login`/)
  })

  it('uses a default action when none is given', async () => {
    makeExpired()
    await expect(createAuthenticatedClient(URL, KEY)).rejects.toThrow('process.exit called')
    expect(console_.errors.join('\n')).toContain('Cannot reach the Tages cloud')
  })

  it('runs beforeExit before printing', async () => {
    const beforeExit = vi.fn()
    await expect(createAuthenticatedClient(URL, KEY, { beforeExit })).rejects.toThrow('process.exit called')
    expect(beforeExit).toHaveBeenCalledTimes(1)
  })

  it('allowDeadSession returns the anonymous client instead of exiting (doctor)', async () => {
    makeExpired()
    const client = await createAuthenticatedClient(URL, KEY, { allowDeadSession: true })
    expect(client).toBe(mockClient)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes a live session through', async () => {
    makeLive()
    expect(await createAuthenticatedClient(URL, KEY)).toBe(mockClient)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes a service key through with no auth.json', async () => {
    process.env.TAGES_SERVICE_KEY = 'svc'
    expect(await createAuthenticatedClient(URL, KEY)).toBe(mockClient)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not guard when no cloud URL is configured (local-only)', async () => {
    expect(await createAuthenticatedClient('', '')).toBe(mockClient)
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('createAuthenticatedClientWithStatus still never exits', async () => {
    makeExpired()
    const expired = await createAuthenticatedClientWithStatus(URL, KEY)
    expect(expired.status).toBe('expired')
    fs.rmSync(path.join(tempConfigDir, 'auth.json'))
    const anon = await createAuthenticatedClientWithStatus(URL, KEY)
    expect(anon.status).toBe('anonymous')
    expect(exitSpy).not.toHaveBeenCalled()
  })
})

/**
 * Caller enumeration. The guard only covers callers of
 * createAuthenticatedClient. A command that switches to the unguarded
 * WithStatus variant, builds its own bare client, or opts out of the guard
 * must be a deliberate, reviewed choice, so each one is listed here.
 */
describe('every CLI caller goes through the dead-session guard', () => {
  const srcDir = path.resolve(__dirname, '..')
  const files = ['commands', 'importers', 'sync']
    .flatMap((d) =>
      fs
        .readdirSync(path.join(srcDir, d))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => `${d}/${f}`),
    )
  const read = (f: string) => fs.readFileSync(path.join(srcDir, f), 'utf-8')

  it('finds the command files (sanity)', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files).toContain('commands/pending.ts')
  })

  it('only doctor opts out with allowDeadSession', () => {
    const optOuts = files.filter((f) => /allowDeadSession/.test(read(f)))
    expect(optOuts).toEqual(['commands/doctor.ts'])
  })

  it('WithStatus callers check the status themselves', () => {
    // init creates a session (it runs before one exists); recall checks
    // `status === 'expired'` inline. Everyone else must call requireLiveSession.
    // sync/cli-sync.ts: a dead session goes local-only with a warning (writes stay
    // dirty and push after login), so the background reconcile never exits.
    const SELF_CHECKED = new Set(['commands/init.ts', 'commands/recall.ts', 'sync/cli-sync.ts'])
    const offenders = files.filter((f) => {
      const src = read(f)
      if (!/createAuthenticatedClientWithStatus\(/.test(src)) return false
      if (SELF_CHECKED.has(f)) return false
      return !/requireLiveSession\(/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('no command builds a bare Supabase client outside the reviewed list', () => {
    // init.ts: pre-login project creation path.
    const ALLOWED = new Set(['commands/init.ts'])
    const offenders = files.filter((f) => /createSupabaseClient\(/.test(read(f)) && !ALLOWED.has(f))
    expect(offenders).toEqual([])
  })
})
