import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
        try {
          await supabase.rpc('accept_pending_invites', {
            user_email: data.user.email,
            uid: data.user.id,
          })
        } catch (e) {
          console.error('[auth/callback] accept_pending_invites failed', e)
          // non-fatal
        }
      }

      // If this was a CLI-initiated OAuth, redirect tokens to the CLI's local server
      if (cliRedirect) {
        const url = new URL(cliRedirect)
        url.searchParams.set('access_token', data.session.access_token)
        url.searchParams.set('refresh_token', data.session.refresh_token)
        url.searchParams.set('user_id', data.session.user.id)
        return NextResponse.redirect(url.toString())
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
}
