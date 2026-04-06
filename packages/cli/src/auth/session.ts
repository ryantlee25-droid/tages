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
    }
  }

  return supabase
}
