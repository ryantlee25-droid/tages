import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { captureConsole } from './helpers.js'

let tempConfigDir = ''

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
}))

const mockRunGithubOAuth = vi.fn()
vi.mock('../auth/github-oauth.js', () => ({
  runGithubOAuth: (...args: unknown[]) => mockRunGithubOAuth(...args),
}))

/** Builds a Supabase-shaped access token so the command can read its claims. */
function makeToken(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600
const PAST = Math.floor(Date.now() / 1000) - 3600

describe('login / logout / whoami', () => {
  let restore: () => void
  let logs: string[]
  let savedServiceKey: string | undefined

  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-login-test-'))
    const cap = captureConsole()
    logs = cap.logs
    restore = cap.restore
    savedServiceKey = process.env.TAGES_SERVICE_KEY
    delete process.env.TAGES_SERVICE_KEY
    mockRunGithubOAuth.mockReset()
  })

  afterEach(() => {
    restore()
    fs.rmSync(tempConfigDir, { recursive: true, force: true })
    if (savedServiceKey === undefined) delete process.env.TAGES_SERVICE_KEY
    else process.env.TAGES_SERVICE_KEY = savedServiceKey
  })

  it('writes auth.json with the tokens from the OAuth flow', async () => {
    mockRunGithubOAuth.mockResolvedValue({
      accessToken: makeToken({ email: 'ryantlee25@gmail.com', sub: 'new-user', exp: FUTURE }),
      refreshToken: 'refresh-1',
      userId: 'new-user',
    })

    const { loginCommand } = await import('../commands/login.js')
    await loginCommand()

    const written = JSON.parse(fs.readFileSync(path.join(tempConfigDir, 'auth.json'), 'utf-8'))
    expect(written.userId).toBe('new-user')
    expect(written.refreshToken).toBe('refresh-1')
    expect(logs.join('\n')).toContain('ryantlee25@gmail.com')
  })

  it('overwrites a previous identity, which is what switching accounts means', async () => {
    fs.writeFileSync(
      path.join(tempConfigDir, 'auth.json'),
      JSON.stringify({
        accessToken: makeToken({ email: 'rlee@mersive.com', sub: 'old-user', exp: FUTURE }),
        refreshToken: 'refresh-old',
        userId: 'old-user',
      }),
    )
    mockRunGithubOAuth.mockResolvedValue({
      accessToken: makeToken({ email: 'ryantlee25@gmail.com', sub: 'new-user', exp: FUTURE }),
      refreshToken: 'refresh-new',
      userId: 'new-user',
    })

    const { loginCommand } = await import('../commands/login.js')
    await loginCommand()

    const written = JSON.parse(fs.readFileSync(path.join(tempConfigDir, 'auth.json'), 'utf-8'))
    expect(written.userId).toBe('new-user')
    const out = logs.join('\n')
    expect(out).toContain('rlee@mersive.com')      // reported the account it left
    expect(out).toContain('ryantlee25@gmail.com')  // and the one it landed on
  })

  it('writes auth.json readable only by the owner', async () => {
    mockRunGithubOAuth.mockResolvedValue({
      accessToken: makeToken({ email: 'a@b.com', sub: 'u', exp: FUTURE }),
      refreshToken: 'r',
      userId: 'u',
    })
    const { loginCommand } = await import('../commands/login.js')
    await loginCommand()

    const mode = fs.statSync(path.join(tempConfigDir, 'auth.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('warns that TAGES_SERVICE_KEY will shadow the login', async () => {
    process.env.TAGES_SERVICE_KEY = 'service-key-value'
    mockRunGithubOAuth.mockResolvedValue({
      accessToken: makeToken({ email: 'a@b.com', sub: 'u', exp: FUTURE }),
      refreshToken: 'r',
      userId: 'u',
    })

    const { loginCommand } = await import('../commands/login.js')
    await loginCommand()

    expect(logs.join('\n')).toContain('TAGES_SERVICE_KEY is set')
  })

  it('does not warn about the service key when it is unset', async () => {
    mockRunGithubOAuth.mockResolvedValue({
      accessToken: makeToken({ email: 'a@b.com', sub: 'u', exp: FUTURE }),
      refreshToken: 'r',
      userId: 'u',
    })
    const { loginCommand } = await import('../commands/login.js')
    await loginCommand()

    expect(logs.join('\n')).not.toContain('TAGES_SERVICE_KEY is set')
  })

  it('whoami reports the signed-in email and flags an expired token', async () => {
    fs.writeFileSync(
      path.join(tempConfigDir, 'auth.json'),
      JSON.stringify({
        accessToken: makeToken({ email: 'rlee@mersive.com', sub: 'old-user', exp: PAST }),
        refreshToken: 'r',
        userId: 'old-user',
      }),
    )

    const { whoamiCommand } = await import('../commands/login.js')
    await whoamiCommand()

    const out = logs.join('\n')
    expect(out).toContain('rlee@mersive.com')
    expect(out).toContain('expired')
  })

  it('whoami says so when no one is signed in', async () => {
    const { whoamiCommand } = await import('../commands/login.js')
    await whoamiCommand()
    expect(logs.join('\n')).toContain('Not signed in')
  })

  it('logout removes the credentials file', async () => {
    const authPath = path.join(tempConfigDir, 'auth.json')
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        accessToken: makeToken({ email: 'rlee@mersive.com', sub: 'u', exp: FUTURE }),
        refreshToken: 'r',
        userId: 'u',
      }),
    )

    const { logoutCommand } = await import('../commands/login.js')
    await logoutCommand()

    expect(fs.existsSync(authPath)).toBe(false)
    expect(logs.join('\n')).toContain('Signed out')
  })

  it('logout is a no-op when not signed in', async () => {
    const { logoutCommand } = await import('../commands/login.js')
    await logoutCommand()
    expect(logs.join('\n')).toContain('Not signed in')
  })

  it('survives a malformed token instead of throwing', async () => {
    fs.writeFileSync(
      path.join(tempConfigDir, 'auth.json'),
      JSON.stringify({ accessToken: 'not-a-jwt', refreshToken: 'r', userId: 'u' }),
    )

    const { whoamiCommand } = await import('../commands/login.js')
    await expect(whoamiCommand()).resolves.not.toThrow()
    expect(logs.join('\n')).toContain('u') // falls back to the user id
  })
})
