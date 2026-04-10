/**
 * Determine whether the local cache should be hydrated from Supabase.
 * Returns true if the cache is stale or has never been synced.
 */
export function shouldHydrate(lastSync: string | null, ttlMs: number = 60_000): boolean {
  if (!lastSync) return true
  const age = Date.now() - new Date(lastSync).getTime()
  return age >= ttlMs
}
