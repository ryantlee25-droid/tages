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
    return { valid: false }
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false }
  }

  // Update last_used
  await supabase
    .from('api_tokens')
    .update({ last_used: new Date().toISOString() })
    .eq('token_hash', hash)

  return { valid: true, userId: data.user_id }
}
