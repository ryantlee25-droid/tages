import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * These cover the defect that killed a real session four days after login:
 * Supabase rotates the refresh token on every refresh and marks the old one
 * used, so a process that refreshes without writing the replacement to
 * auth.json leaves the on-disk credential permanently spent. The observable
 * symptom is `refresh_token_already_used` with an auth.json whose mtime is
 * still the original login.
 */

let tmpHome: string
let realHome: string | undefined

function jwt(exp: number): string {
  const body = Buffer.from(JSON.stringify({ exp, sub: 'u1' })).toString('base64url')
  return `h.${body}.sig`
}

function authPath(): string {
  return path.join(tmpHome, '.config', 'tages', 'auth.json')
}

function seed(auth: Record<string, string>): void {
  fs.mkdirSync(path.dirname(authPath()), { recursive: true })
  fs.writeFileSync(authPath(), JSON.stringify(auth))
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-auth-'))
  // os.homedir() reads $HOME on POSIX, so redirecting the env var reroutes the
  // real path helpers. vi.spyOn cannot touch `os` here — an ESM namespace
  // object is not configurable — and mocking the module would also stub the
  // fs-adjacent helpers these tests rely on.
  realHome = process.env.HOME
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('persistRotatedTokens', () => {
  it('writes a newer token over the stored one', async () => {
    const { persistRotatedTokens } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    seed({ accessToken: jwt(1000), refreshToken: 'old', userId: 'u1' })

    persistRotatedTokens(jwt(2000), 'rotated', 'u1')

    const stored = readAuthFile()
    expect(stored?.refreshToken).toBe('rotated')
  })

  it('refuses to overwrite a fresher session written by another process', async () => {
    const { persistRotatedTokens } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    // A `tages login` in another terminal has just written a newer session.
    seed({ accessToken: jwt(9000), refreshToken: 'from-fresh-login', userId: 'u1' })

    // A long-lived server that booted on the OLD session rotates its own copy.
    persistRotatedTokens(jwt(2000), 'from-stale-server', 'u1')

    expect(readAuthFile()?.refreshToken).toBe('from-fresh-login')
  })

  it('treats an unparseable stored token as oldest rather than blocking the write', async () => {
    const { persistRotatedTokens } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    seed({ accessToken: 'not-a-jwt', refreshToken: 'junk', userId: 'u1' })

    persistRotatedTokens(jwt(2000), 'rotated', 'u1')

    expect(readAuthFile()?.refreshToken).toBe('rotated')
  })

  it('keeps the stored userId when the refreshed session carries none', async () => {
    const { persistRotatedTokens } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    seed({ accessToken: jwt(1000), refreshToken: 'old', userId: 'u-keep' })

    persistRotatedTokens(jwt(2000), 'rotated', '')

    expect(readAuthFile()?.userId).toBe('u-keep')
  })
})

describe('writeAuthFile', () => {
  it('writes 0600 even when auth.json already exists as 0644', async () => {
    const { writeAuthFile } = await import('../auth-store')
    seed({ accessToken: 'a', refreshToken: 'b', userId: 'u1' })
    fs.chmodSync(authPath(), 0o644)

    writeAuthFile({ accessToken: jwt(2000), refreshToken: 'r', userId: 'u1' })

    expect(fs.statSync(authPath()).mode & 0o777).toBe(0o600)
  })

  it('leaves no readable window: a concurrent reader never sees a truncated file', async () => {
    const { writeAuthFile } = await import('../auth-store')
    seed({ accessToken: jwt(1000), refreshToken: 'old', userId: 'u1' })

    // The write is temp-file + rename, so at every instant the final path holds
    // one complete document. Assert no temp file survives and the content parses.
    writeAuthFile({ accessToken: jwt(2000), refreshToken: 'new', userId: 'u1' })

    const dir = path.dirname(authPath())
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp.'))).toEqual([])
    expect(() => JSON.parse(fs.readFileSync(authPath(), 'utf-8'))).not.toThrow()
  })
})

describe('persistSessionOnRefresh', () => {
  it('persists on TOKEN_REFRESHED and ignores other auth events', async () => {
    const { persistSessionOnRefresh } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    seed({ accessToken: jwt(1000), refreshToken: 'old', userId: 'u1' })

    let handler: ((e: string, s: unknown) => void) | null = null
    const supabase = {
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          handler = cb
          return { data: { subscription: { unsubscribe: () => {} } } }
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    persistSessionOnRefresh(supabase)
    expect(handler).not.toBeNull()

    handler!('SIGNED_IN', {
      access_token: jwt(5000),
      refresh_token: 'ignored',
      user: { id: 'u1' },
    })
    expect(readAuthFile()?.refreshToken).toBe('old')

    handler!('TOKEN_REFRESHED', {
      access_token: jwt(5000),
      refresh_token: 'rotated',
      user: { id: 'u1' },
    })
    expect(readAuthFile()?.refreshToken).toBe('rotated')
  })

  it('ignores a refreshed session missing access_token or refresh_token', async () => {
    const { persistSessionOnRefresh } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    seed({ accessToken: jwt(1000), refreshToken: 'old', userId: 'u1' })

    let handler: ((e: string, s: unknown) => void) | null = null
    const supabase = {
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          handler = cb
          return { data: { subscription: { unsubscribe: () => {} } } }
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    persistSessionOnRefresh(supabase)
    expect(handler).not.toBeNull()

    // Supabase types mark both fields required, but a defensive guard exists
    // because the callback receives whatever the client hands it at runtime.
    handler!('TOKEN_REFRESHED', { refresh_token: 'rotated', user: { id: 'u1' } })
    expect(readAuthFile()?.refreshToken).toBe('old')

    handler!('TOKEN_REFRESHED', { access_token: jwt(5000), user: { id: 'u1' } })
    expect(readAuthFile()?.refreshToken).toBe('old')
  })

  it('logs and does not throw when the write fails, instead of crashing the process', async () => {
    const { persistSessionOnRefresh } = await import('../auth-persist')
    const { readAuthFile } = await import('../auth-store')
    // Pre-create auth.json as a directory so the atomic rename inside
    // writeAuthFile fails with EISDIR — a real write failure, no fs mocking.
    fs.mkdirSync(authPath(), { recursive: true })

    let handler: ((e: string, s: unknown) => void) | null = null
    const supabase = {
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
          handler = cb
          return { data: { subscription: { unsubscribe: () => {} } } }
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    persistSessionOnRefresh(supabase)
    expect(handler).not.toBeNull()

    expect(() => {
      handler!('TOKEN_REFRESHED', {
        access_token: jwt(5000),
        refresh_token: 'rotated',
        user: { id: 'u1' },
      })
    }).not.toThrow()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toMatch(/could not persist refreshed session/)
    // The in-memory session still works; only the on-disk copy is unaffected —
    // confirm the directory sentinel is untouched, not silently replaced.
    expect(fs.statSync(authPath()).isDirectory()).toBe(true)
    expect(readAuthFile()).toBeNull()

    errorSpy.mockRestore()
  })
})

describe('readAuthFile', () => {
  it('returns null when auth.json does not exist', async () => {
    const { readAuthFile } = await import('../auth-store')
    // No seed() call — the config dir itself is absent.
    expect(readAuthFile()).toBeNull()
  })

  it('returns null when auth.json contains unparseable JSON', async () => {
    const { readAuthFile } = await import('../auth-store')
    fs.mkdirSync(path.dirname(authPath()), { recursive: true })
    fs.writeFileSync(authPath(), '{ not valid json')

    expect(readAuthFile()).toBeNull()
  })
})

describe('writeAuthFile rename failure', () => {
  it('cleans up the temp file and propagates the error when rename fails', async () => {
    const { writeAuthFile } = await import('../auth-store')
    // Pre-create the final path as a directory: renameSync(file, dir) fails
    // with EISDIR on POSIX, giving a real rename failure without mocking fs.
    fs.mkdirSync(authPath(), { recursive: true })

    expect(() => writeAuthFile({ accessToken: jwt(2000), refreshToken: 'r', userId: 'u1' })).toThrow()

    const dir = path.dirname(authPath())
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp.'))).toEqual([])
    // The directory sentinel must still be there — writeAuthFile must not have
    // clobbered it or left a partial artifact behind.
    expect(fs.statSync(authPath()).isDirectory()).toBe(true)
  })
})
