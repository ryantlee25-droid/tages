import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * CLI token exchange route.
 * The CLI opens the browser to this route with a redirect_uri.
 * After GitHub OAuth, this route redirects back to the CLI's local server
 * with the session tokens.
 *
 * Security: redirect_uri is restricted to localhost/127.0.0.1 to prevent
 * open redirect attacks that could leak session tokens to external domains.
 */

function isLocalRedirect(uri: string): boolean {
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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const redirectUri = searchParams.get('redirect_uri')
  const code = searchParams.get('code')

  if (redirectUri && !isLocalRedirect(redirectUri)) {
    return NextResponse.json(
      { error: 'redirect_uri must be localhost or 127.0.0.1' },
      { status: 400 },
    )
  }

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  const userAgent = request.headers.get('user-agent') ?? null

  if (!redirectUri) {
    // Step 1: Redirect to GitHub OAuth with this route as callback
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${origin}/auth/cli?redirect_uri=${encodeURIComponent(searchParams.get('redirect_uri') || '')}`,
      },
    })

    if (error || !data.url) {
      return NextResponse.json({ error: 'OAuth init failed' }, { status: 500 })
    }

    return NextResponse.redirect(data.url)
  }

  if (code) {
    // Step 2: Exchange code and redirect to CLI callback
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.session) {
      // Fire-and-forget: log failed login
      void Promise.resolve(
        supabase.from('auth_audit_log').insert({
          event_type: 'login_failed',
          ip_address: ipAddress,
          user_agent: userAgent,
          metadata: { error: error?.message ?? 'no_session' },
        })
      ).catch(() => {})

      const url = new URL(redirectUri)
      url.searchParams.set('error', 'session_exchange_failed')
      return NextResponse.redirect(url.toString())
    }

    // Fire-and-forget: log successful login
    void Promise.resolve(
      supabase.from('auth_audit_log').insert({
        user_id: data.session.user.id,
        event_type: 'login_success',
        ip_address: ipAddress,
        user_agent: userAgent,
        metadata: {},
      })
    ).catch(() => {})

    const url = new URL(redirectUri)
    url.searchParams.set('access_token', data.session.access_token)
    url.searchParams.set('refresh_token', data.session.refresh_token)
    url.searchParams.set('user_id', data.session.user.id)
    return NextResponse.redirect(url.toString())
  }

  return NextResponse.json({ error: 'Missing redirect_uri or code' }, { status: 400 })
}
