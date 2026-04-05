import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * CLI token exchange route.
 * The CLI opens the browser to this route with a redirect_uri.
 * After GitHub OAuth, this route redirects back to the CLI's local server
 * with the session tokens.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const redirectUri = searchParams.get('redirect_uri')
  const code = searchParams.get('code')

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
      const url = new URL(redirectUri)
      url.searchParams.set('error', 'session_exchange_failed')
      return NextResponse.redirect(url.toString())
    }

    const url = new URL(redirectUri)
    url.searchParams.set('access_token', data.session.access_token)
    url.searchParams.set('refresh_token', data.session.refresh_token)
    url.searchParams.set('user_id', data.session.user.id)
    return NextResponse.redirect(url.toString())
  }

  return NextResponse.json({ error: 'Missing redirect_uri or code' }, { status: 400 })
}
