import * as fs from 'fs'
import { createSupabaseClient } from '@tages/shared'
import { getAuthPath } from '../config/paths.js'
import { writeAuthFile } from './store.js'

/**
 * How the returned client is authenticated.
 *
 * `expired` is the case that used to be invisible: the stored refresh token no
 * longer works, so the client is anonymous and every RLS-protected read comes
 * back empty. Commands that render "no results" must distinguish that from a
 * genuinely empty project, or they report success on a broken session.
 */
export type SessionStatus = 'service-key' | 'authenticated' | 'anonymous' | 'expired'

/**
 * Creates an authenticated Supabase client for CLI operations.
 *
 * Auth precedence:
 * 1. TAGES_SERVICE_KEY env var — service role key, bypasses RLS (for CI/headless)
 * 2. ~/.config/tages/auth.json — user JWT from `tages login` OAuth flow
 * 3. Falls back to anon key (will fail on RLS-protected tables)
 *
 * Prefer {@link createAuthenticatedClientWithStatus} in any command whose
 * output would look the same on an expired session as on an empty project.
 */
export async function createAuthenticatedClient(supabaseUrl: string, supabaseAnonKey: string) {
  const { supabase } = await createAuthenticatedClientWithStatus(supabaseUrl, supabaseAnonKey)
  return supabase
}

/**
 * Same as {@link createAuthenticatedClient}, but also reports how the client
 * ended up authenticated so the caller can fail loudly on `expired`.
 */
export async function createAuthenticatedClientWithStatus(
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ supabase: ReturnType<typeof createSupabaseClient>; status: SessionStatus }> {
  // Service role key for CI/headless use — bypasses RLS entirely
  const serviceKey = process.env.TAGES_SERVICE_KEY
  if (serviceKey) {
    return { supabase: createSupabaseClient(supabaseUrl, serviceKey), status: 'service-key' }
  }

  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)
  let status: SessionStatus = 'anonymous'

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
          // Refresh token is also expired — user must re-authenticate.
          //
          // `tages login`, NOT `tages init`. `init` CREATES a project: run it
          // to "fix" auth and it either trips the global slug-unique constraint
          // or drops you into a `local-<slug>` store that then blocks `link`.
          console.error('[tages] Session expired. Run `tages login` to re-authenticate.')
          return { supabase, status: 'expired' } // Unauthenticated client
        }

        // Persist the new tokens so subsequent commands don't need to refresh again.
        // Via the shared writer: this used to be a bare writeFileSync whose `mode`
        // is creation-only, so on a pre-existing 0644 auth.json every refresh wrote
        // a brand-new live refresh token into a world-readable file. Now that
        // auto-reconcile runs on nearly every command, this is the hot path.
        writeAuthFile({
          ...auth,
          accessToken: refreshData.session.access_token,
          refreshToken: refreshData.session.refresh_token,
        })
        status = 'authenticated'
      } else {
        status = 'authenticated'
      }
    }
  }

  return { supabase, status }
}
