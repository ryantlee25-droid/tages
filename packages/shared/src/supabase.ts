import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function createSupabaseClient(url: string, key: string): SupabaseClient {
  if (!client) {
    client = createClient(url, key)
  }
  return client
}

export function getSupabaseClient(): SupabaseClient | null {
  return client
}
