import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleForget(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const existed = cache.deleteByKey(projectId, args.key)

  if (sync) {
    // remoteDelete: true = the row is gone remotely (or never existed there);
    // false = error, or a visible row survived a 0-row delete (RLS refused a
    // read-only member). Never report "Deleted" in the false case: teammates
    // would still recall the memory.
    const ok = await sync.remoteDelete(projectId, args.key)
    if (!ok) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Could not delete "${args.key}" from the shared store: permission denied (your role may be ` +
            'read-only on this project) or the database was unreachable. ' +
            (existed ? 'It was removed from this machine\'s cache only; ' : '') +
            'teammates will still see it. Ask an owner or admin to delete it.',
        }],
      }
    }
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
