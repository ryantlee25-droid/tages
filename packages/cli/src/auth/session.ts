import * as fs from 'fs'
import { createSupabaseClient } from '@tages/shared'
import { getAuthPath } from '../config/paths.js'

/**
 * Creates an authenticated Supabase client for CLI operations.
 *
 * Auth precedence:
 * 1. TAGES_SERVICE_KEY env var — service role key, bypasses RLS (for CI/headless)
 * 2. ~/.config/tages/auth.json — user JWT from `tages init` OAuth flow
 * 3. Falls back to anon key (will fail on RLS-protected tables)
 */
export async function createAuthenticatedClient(supabaseUrl: string, supabaseAnonKey: string) {
  // Service role key for CI/headless use — bypasses RLS entirely
  const serviceKey = process.env.TAGES_SERVICE_KEY
  if (serviceKey) {
    return createSupabaseClient(supabaseUrl, serviceKey)
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)

  const authPath = getAuthPath()
  if (fs.existsSync(authPath)) {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    if (auth.accessToken && auth.refreshToken) {
      await supabase.auth.setSession({
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
      })

      // Verify the session is valid — setSession() does not fail if the access token is expired
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

      if (sessionError || !sessionData.session) {
        // Access token is expired — attempt refresh using the stored refresh token
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: auth.refreshToken,
        })

        if (refreshError || !refreshData.session) {
          // Refresh token is also expired — user must re-authenticate
          console.error('[tages] Session expired. Run `tages init` to re-authenticate.')
          return supabase // Return unauthenticated client
        }

        // Persist the new tokens so subsequent commands don't need to refresh again
        const updatedAuth = {
          ...auth,
          accessToken: refreshData.session.access_token,
          refreshToken: refreshData.session.refresh_token,
        }
        fs.writeFileSync(authPath, JSON.stringify(updatedAuth, null, 2), { mode: 0o600 })
      }
    }
  }

  return supabase
}
