import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let tempConfigDir = ''

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
}))

const AUTH = { accessToken: 'a', refreshToken: 'r', userId: 'u' }

describe('writeAuthFile', () => {
  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-store-test-'))
  })
  afterEach(() => {
    fs.rmSync(tempConfigDir, { recursive: true, force: true })
  })

  it('creates auth.json at 0600 and the config dir at 0700', async () => {
    const { writeAuthFile } = await import('../auth/store.js')
    writeAuthFile(AUTH)

    const authPath = path.join(tempConfigDir, 'auth.json')
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600)
    expect(fs.statSync(tempConfigDir).mode & 0o777).toBe(0o700)
    expect(JSON.parse(fs.readFileSync(authPath, 'utf-8'))).toEqual(AUTH)
  })

  it('tightens a pre-existing 0644 auth.json instead of inheriting its mode', async () => {
    // The regression: writeFileSync's `mode` is the open(2) CREATION mode, so it
    // is ignored when the file already exists. This is the token-refresh case,
    // which runs on nearly every command now that auto-reconcile is in a
    // preAction hook — far more often than `login` does.
    const authPath = path.join(tempConfigDir, 'auth.json')
    fs.writeFileSync(authPath, JSON.stringify({ old: true }))
    fs.chmodSync(authPath, 0o644)
    fs.chmodSync(tempConfigDir, 0o755)
    expect(fs.statSync(authPath).mode & 0o777).toBe(0o644) // precondition

    const { writeAuthFile } = await import('../auth/store.js')
    writeAuthFile(AUTH)

    expect(fs.statSync(authPath).mode & 0o777).toBe(0o600)
    expect(fs.statSync(tempConfigDir).mode & 0o777).toBe(0o700)
  })

  it('fully replaces the previous contents, leaving no stale token behind', async () => {
    const authPath = path.join(tempConfigDir, 'auth.json')
    // Longer than the replacement, so a non-truncating write would leave a tail.
    fs.writeFileSync(authPath, JSON.stringify({ refreshToken: 'STALE'.repeat(200) }))

    const { writeAuthFile } = await import('../auth/store.js')
    writeAuthFile(AUTH)

    const raw = fs.readFileSync(authPath, 'utf-8')
    expect(raw).not.toContain('STALE')
    expect(JSON.parse(raw)).toEqual(AUTH)
  })
})
