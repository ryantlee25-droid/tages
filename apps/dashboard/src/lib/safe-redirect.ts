/**
 * Redirect-target guards.
 *
 * These live here rather than inside a route because two different routes in
 * the OAuth flow need the same check, and only one of them had it. `/auth/cli`
 * validated its `redirect_uri` while `/auth/callback` — the route that actually
 * attaches the access and refresh tokens to the redirect — did not, so a
 * crafted `cli_redirect` sent a live session to any host the attacker named.
 * A single shared implementation is the point: a copy in each route is how the
 * two drift apart again.
 */

/**
 * True only for a loopback HTTP address, which is the CLI's local callback
 * server and nothing else.
 *
 * Deliberately strict: `http:` only (the local server has no TLS), and an exact
 * hostname match rather than a suffix test, since `localhost.evil.com` ends
 * with `localhost` and `evil.com/?x=127.0.0.1` contains the literal.
 */
export function isLocalRedirect(uri: string): boolean {
  try {
    const url = new URL(uri)
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    )
  } catch {
    return false
  }
}

/**
 * True for a path that stays on this origin when appended to it.
 *
 * `//evil.com` is a protocol-relative URL and `/\evil.com` is treated as one by
 * browsers, so both leave the site despite starting with a slash. Anything that
 * parses as an absolute URL is rejected outright.
 */
export function isSafeRelativePath(path: string | null | undefined): boolean {
  if (!path) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//') || path.startsWith('/\\')) return false
  return true
}
