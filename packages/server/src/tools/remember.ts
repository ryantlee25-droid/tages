import { randomUUID } from 'crypto'
import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleRemember(
  args: { key: string; value: string; type: string; filePaths?: string[]; tags?: string[] },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const now = new Date().toISOString()
  const existing = cache.getByKey(projectId, args.key)

  const memory: Memory = {
    id: existing?.id || randomUUID(),
    projectId,
    key: args.key,
    value: args.value,
    type: args.type as Memory['type'],
    source: 'agent',
    filePaths: args.filePaths || [],
    tags: args.tags || [],
    confidence: 1.0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  cache.upsertMemory(memory, true)

  // Try remote write immediately; cache is dirty if this fails
  if (sync) {
    const ok = await sync.remoteInsert(memory)
    if (ok) cache.markSynced([memory.id])
  }

  const action = existing ? 'Updated' : 'Stored'
  return {
    content: [{
      type: 'text',
      text: `${action} memory: "${args.key}" (${args.type})`,
    }],
  }
}
