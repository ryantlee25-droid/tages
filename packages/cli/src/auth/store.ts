import * as fs from 'fs'
import { getAuthPath, getConfigDir } from '../config/paths.js'

export interface StoredAuth {
  accessToken: string
  refreshToken: string
  userId: string
}

/**
 * The single writer for `~/.config/tages/auth.json`.
 *
 * It exists because there were two, and only one of them was correct. Both
 * `login` and the silent token-refresh in `auth/session.ts` write a live
 * Supabase refresh token here, and both used
 * `writeFileSync(path, data, { mode: 0o600 })` — where `mode` is the `open(2)`
 * CREATION mode, applied only when the call actually creates the file. On an
 * existing `auth.json` it is ignored, so a file that was once 0644 stayed 0644
 * while fresh tokens were written into it. Fixing `login` alone missed the path
 * that matters more: refresh runs on nearly every command now that
 * auto-reconcile is wired into a `preAction` hook, while `login` runs rarely.
 *
 * Permissions are therefore set unconditionally rather than hopefully, and the
 * file is opened and truncated BEFORE the mode is corrected and the token
 * written, so a fresh secret never sits on disk at looser permissions even for
 * an instant.
 */
export function writeAuthFile(auth: StoredAuth): void {
  const dir = getConfigDir()
  fs.mkdirSync(dir, { recursive: true })
  // mkdirSync's mode is likewise creation-only, and it leaves an existing
  // directory at whatever it was (0755 by default).
  fs.chmodSync(dir, 0o700)

  const path = getAuthPath()
  // 'w' truncates first, so any previous token is gone before fchmod runs; the
  // window that remains exposes an empty file, never a credential.
  const fd = fs.openSync(path, 'w', 0o600)
  try {
    fs.fchmodSync(fd, 0o600)
    fs.writeFileSync(fd, JSON.stringify(auth, null, 2) + '\n')
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Read the stored session, or null when absent/unreadable.
 *
 * Deliberately total: every caller treats a missing identity as "unknown", not
 * as an error. A corrupt auth.json must not take down a command that only
 * wanted to stamp authorship on a write.
 */
export function readAuthFile(): StoredAuth | null {
  try {
    const raw = fs.readFileSync(getAuthPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    return parsed && typeof parsed.userId === 'string' && parsed.userId
      ? (parsed as StoredAuth)
      : null
  } catch {
    return null
  }
}
