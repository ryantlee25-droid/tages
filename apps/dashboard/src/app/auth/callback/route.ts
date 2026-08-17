import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isLocalRedirect, isSafeRelativePath } from '@/lib/safe-redirect'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const cliRedirect = searchParams.get('cli_redirect')
  const next = searchParams.get('next') ?? '/app/projects'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.session) {
      if (data.user?.email) {
        // Zero-arg by design (migration 0065): the RPC derives identity from
        // the session JWT. Passing an email/uid was a privilege-escalation hole.
        //
        // `rpc()` RESOLVES with `{ data, error }` rather than throwing, so the
        // try/catch this used to sit in caught nothing and a failure here was
        // invisible. Destructure the error instead. Still non-fatal: a failed
        // invite sweep must not block the sign-in that triggered it.
        const { error: inviteError } = await supabase.rpc('accept_pending_invites')
        if (inviteError) {
          console.error(
            '[auth/callback] accept_pending_invites failed:',
            inviteError.code,
            inviteError.message,
          )
        }
      }

      // If this was a CLI-initiated OAuth, hand the tokens to the CLI's local
      // server. The target MUST be loopback: this redirect carries a live access
      // and refresh token in the query string, so an unvalidated `cli_redirect`
      // is a full account takeover for anyone who can get a user to follow a
      // crafted authorize URL. `/auth/cli` validates its own `redirect_uri`, but
      // an attacker can reach this route directly via the provider's
      // `redirect_to`, so the check has to be here too.
      if (cliRedirect) {
        if (!isLocalRedirect(cliRedirect)) {
          return NextResponse.redirect(`${origin}/auth/login?error=invalid_redirect`)
        }
        const url = new URL(cliRedirect)
        url.searchParams.set('access_token', data.session.access_token)
        url.searchParams.set('refresh_token', data.session.refresh_token)
        url.searchParams.set('user_id', data.session.user.id)
        return NextResponse.redirect(url.toString())
      }

      // `next` is caller-supplied too. `${origin}${next}` looks origin-locked
      // but is not: `next=//evil.com` and `next=/\evil.com` are protocol-relative
      // and leave the site.
      return NextResponse.redirect(`${origin}${isSafeRelativePath(next) ? next : '/app/projects'}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
