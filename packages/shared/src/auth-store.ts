import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface StoredAuth {
  accessToken: string
  refreshToken: string
  userId: string
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'tages')
}

export function getAuthPath(configDir?: string): string {
  return path.join(configDir ?? getConfigDir(), 'auth.json')
}

/**
 * Where the credential lives.
 *
 * `configDir` is injectable because the CLI owns its own `config/paths` module
 * and its tests redirect the whole thing; without the seam there would be two
 * implementations of one path, which is how the file ended up with two writers
 * in the first place. Callers that do not care get the real location.
 */
export interface AuthPathOptions {
  configDir?: string
}

/**
 * The single writer for `~/.config/tages/auth.json`.
 *
 * It lives in `shared`, not in the CLI, because the MCP server must write here
 * too. Supabase rotates the refresh token on every use and invalidates the old
 * one immediately; a process that refreshes without persisting the replacement
 * leaves the on-disk token permanently spent. The server is long-lived and
 * `auto-refresh` is on by default, so it refreshes on a 30s tick — which is how
 * a session that was minted by `tages login` died roughly an hour later with
 * `refresh_token_already_used` and no user action at all.
 *
 * Permissions are set unconditionally rather than hopefully. Both `login` and
 * the silent refresh in `auth/session.ts` used
 * `writeFileSync(path, data, { mode: 0o600 })` — where `mode` is the `open(2)`
 * CREATION mode, applied only when the call actually creates the file. On an
 * existing `auth.json` it is ignored, so a file that was once 0644 stayed 0644
 * while fresh tokens were written into it.
 *
 * The write is atomic (temp file in the same directory, then `rename`). It has
 * to be: now that a background server writes this file on its own schedule,
 * a truncate-then-write would let a concurrently-starting CLI command read a
 * half-written or empty file. `rename(2)` within one filesystem is atomic, so
 * a reader sees either the whole old file or the whole new one. The temp file
 * is created 0600 so a live token never exists at looser permissions, not even
 * for an instant.
 */
export function writeAuthFile(auth: StoredAuth, opts: AuthPathOptions = {}): void {
  const dir = opts.configDir ?? getConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  // mkdirSync's mode is likewise creation-only, and it leaves an existing
  // directory at whatever it was (0755 by default).
  fs.chmodSync(dir, 0o700)

  const finalPath = getAuthPath(dir)
  // Same directory, so the rename below stays on one filesystem. The pid keeps
  // two concurrent writers from sharing a temp file.
  const tmpPath = `${finalPath}.tmp.${process.pid}`
  // One try covering write AND rename, not just rename: if writeFileSync fails
  // (ENOSPC, EIO, EDQUOT) the temp file is already created and would otherwise
  // be left on disk holding a partial live refresh token that nothing reaps.
  try {
    const fd = fs.openSync(tmpPath, 'w', 0o600)
    try {
      fs.fchmodSync(fd, 0o600)
      fs.writeFileSync(fd, JSON.stringify(auth, null, 2) + '\n')
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmpPath, finalPath)
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      // Best effort — the original failure is the one worth reporting.
    }
    throw err
  }
}

/**
 * Read the stored session, or null when absent/unreadable.
 *
 * Deliberately total: every caller treats a missing identity as "unknown", not
 * as an error. A corrupt auth.json must not take down a command that only
 * wanted to stamp authorship on a write.
 */
export function readAuthFile(opts: AuthPathOptions = {}): StoredAuth | null {
  try {
    const raw = fs.readFileSync(getAuthPath(opts.configDir ?? getConfigDir()), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    return parsed && typeof parsed.userId === 'string' && parsed.userId
      ? (parsed as StoredAuth)
      : null
  } catch {
    return null
  }
}
