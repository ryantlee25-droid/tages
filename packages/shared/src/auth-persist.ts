import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthPath, readAuthFile, writeAuthFile, type AuthPathOptions } from './auth-store'

/**
 * Decode the `exp` claim of a Supabase access token without verifying it.
 *
 * Only used to order two tokens against each other, never to trust one. A
 * malformed token sorts as "oldest" so it can never win the comparison in
 * {@link persistRotatedTokens} and overwrite a good session.
 */
function tokenExpiry(accessToken: string | undefined): number {
  if (!accessToken) return 0
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return 0
    const json = Buffer.from(payload, 'base64url').toString('utf-8')
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp === 'number' ? exp : 0
  } catch {
    return 0
  }
}

/**
 * Write refreshed Supabase tokens back to `auth.json`.
 *
 * Supabase rotates the refresh token on every refresh and marks the previous
 * one used; presenting it again fails with `refresh_token_already_used`. Any
 * process that refreshes therefore OWNS the job of persisting the replacement,
 * or it silently destroys the on-disk session for every other process.
 *
 * The staleness guard matters because more than one process shares this file.
 * A long-lived MCP server that booted with an old session must not stamp its
 * lineage over tokens a fresh `tages login` wrote a moment ago, so a write only
 * happens when the incoming access token outlives the stored one.
 */
export function persistRotatedTokens(
  accessToken: string,
  refreshToken: string,
  userId: string,
  opts: AuthPathOptions = {},
): void {
  const stored = readAuthFile(opts)
  // `>=`, not `>`, and that is load-bearing. `createSupabaseClient` memoises one
  // client per process, so several callers can register a listener on the same
  // instance and every one of them fires on a single TOKEN_REFRESHED. Equal
  // expiries mean the token on disk is already the one being offered, so
  // rejecting the tie makes the redundant handlers no-ops instead of N writes.
  if (stored && tokenExpiry(stored.accessToken) >= tokenExpiry(accessToken)) return
  writeAuthFile({ accessToken, refreshToken, userId: userId || stored?.userId || '' }, opts)
}

/**
 * Keep `auth.json` in step with a client that refreshes on its own.
 *
 * `createClient` defaults to `autoRefreshToken: true` with in-memory storage in
 * Node, so a long-running process refreshes on a 30-second tick and keeps the
 * result nowhere. Call this immediately after `setSession()` on any client that
 * outlives a single command.
 *
 * Returns an unsubscribe function.
 */
const registered = new WeakSet<SupabaseClient>()

export function persistSessionOnRefresh(
  supabase: SupabaseClient,
  opts: AuthPathOptions = {},
): () => void {
  // `createSupabaseClient` memoises a single client per process, and several
  // code paths call this on it (the preAction auto-reconcile hook, then the
  // command itself). Registering once per client keeps one handler doing the
  // work instead of N handlers racing to write the same file.
  if (registered.has(supabase)) return () => {}
  registered.add(supabase)

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event !== 'TOKEN_REFRESHED') return
    if (!session?.access_token || !session?.refresh_token) return
    try {
      persistRotatedTokens(
        session.access_token,
        session.refresh_token,
        session.user?.id ?? '',
        opts,
      )
    } catch (err) {
      // Never take the process down over a credential-cache write. The session
      // still works in memory; only the next process pays for the loss.
      console.error(
        `[tages] Warning: could not persist refreshed session to ` +
          `${getAuthPath(opts.configDir)} — ${(err as Error).message}`,
      )
    }
  })
  return () => {
    registered.delete(supabase)
    data.subscription.unsubscribe()
  }
}

