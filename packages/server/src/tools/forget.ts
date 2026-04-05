import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleForget(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const existed = cache.deleteByKey(projectId, args.key)

  if (sync) {
    await sync.remoteDelete(projectId, args.key)
  }

  if (existed) {
    return {
      content: [{ type: 'text', text: `Deleted memory: "${args.key}"` }],
    }
  }

  return {
    content: [{ type: 'text', text: `No memory found with key "${args.key}"` }],
  }
}
