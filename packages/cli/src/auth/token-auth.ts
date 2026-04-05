import { createHash, randomBytes } from 'crypto'
import { createSupabaseClient } from '@tages/shared'

export function generateToken(): { token: string; hash: string } {
  const token = `tages_${randomBytes(32).toString('hex')}`
  const hash = hashToken(token)
  return { token, hash }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function validateToken(
  token: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ valid: boolean; userId?: string }> {
  const hash = hashToken(token)
  const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)

  const { data, error } = await supabase
    .from('api_tokens')
    .select('user_id, expires_at')
    .eq('token_hash', hash)
    .single()

  if (error || !data) {
    // Fire-and-forget: log invalid token lookup (no user_id known)
    void Promise.resolve(
      supabase.from('auth_audit_log').insert({
        event_type: 'token_invalid',
        metadata: {},
      })
    ).catch(() => {})

    return { valid: false }
  }

  // Check expiry if expires_at column exists on the row
  const expiresAt: string | null = (data as { user_id: string; expires_at?: string | null }).expires_at ?? null
  if (expiresAt !== null && new Date(expiresAt) < new Date()) {
    // Fire-and-forget: log expired token
    void Promise.resolve(
      supabase.from('auth_audit_log').insert({
        user_id: data.user_id,
        event_type: 'token_expired',
        metadata: { expires_at: expiresAt },
      })
    ).catch(() => {})

    return { valid: false }
  }

  // Update last_used
  await supabase
    .from('api_tokens')
    .update({ last_used: new Date().toISOString() })
    .eq('token_hash', hash)

  return { valid: true, userId: data.user_id }
}
