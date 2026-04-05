import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { ArchiveManager } from '../archive/archiver'

// Global archive manager instance
let archiveManager: ArchiveManager | null = null

export function getArchiveManager(dbPath?: string): ArchiveManager {
  if (!archiveManager) {
    archiveManager = new ArchiveManager(dbPath)
  }
  return archiveManager
}

export async function handleArchive(
  args: { key: string; reason?: string },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return { content: [{ type: 'text', text: `Memory "${args.key}" not found.` }] }
  }

  const mgr = getArchiveManager()
  mgr.archiveMemory(memory, args.reason || 'manually archived', cache)

  return { content: [{ type: 'text', text: `Archived "${args.key}". Restore with restore_memory.` }] }
}

export async function handleRestore(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mgr = getArchiveManager()
  const restored = mgr.restoreMemory(projectId, args.key, cache)
  if (!restored) {
    return { content: [{ type: 'text', text: `No archived memory found for "${args.key}".` }] }
  }

  if (sync) {
    const ok = await sync.remoteInsert(restored)
    if (ok) cache.markSynced([restored.id])
  }

  return { content: [{ type: 'text', text: `Restored "${args.key}" to live status.` }] }
}

export async function handleListArchived(
  args: { limit?: number },
  projectId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mgr = getArchiveManager()
  const entries = mgr.listArchived(projectId, args.limit || 20)

  if (entries.length === 0) {
    return { content: [{ type: 'text', text: 'No archived memories.' }] }
  }

  const lines = entries.map((e, i) =>
    `${i + 1}. "${e.memoryKey}" — ${e.archiveReason} (${e.archivedAt.slice(0, 10)})`
  )
  return {
    content: [{
      type: 'text',
      text: `Archived memories (${entries.length}):\n\n${lines.join('\n')}`,
    }],
  }
}

export async function handleArchiveStats(
  _args: Record<string, never>,
  projectId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mgr = getArchiveManager()
  const stats = mgr.getStats(projectId)

  return {
    content: [{
      type: 'text',
      text: [
        'Archive Statistics:',
        `  Total archived: ${stats.totalArchived}`,
        `  Total restored: ${stats.totalRestored}`,
        `  Total expired:  ${stats.totalExpired}`,
        stats.lastArchiveAt ? `  Last archive: ${stats.lastArchiveAt.slice(0, 10)}` : '',
        stats.lastRestoreAt ? `  Last restore: ${stats.lastRestoreAt.slice(0, 10)}` : '',
      ].filter(Boolean).join('\n'),
    }],
  }
}

export async function handleAutoArchive(
  args: { qualityThreshold?: number; stalenessDays?: number },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const mgr = getArchiveManager()
  const result = mgr.autoArchiveScan(projectId, cache, args.qualityThreshold, args.stalenessDays)

  if (result.archived === 0) {
    return { content: [{ type: 'text', text: 'No memories met auto-archive criteria.' }] }
  }

  const lines = result.reasons.map(r => `  - "${r.key}": ${r.reason}`)
  return {
    content: [{
      type: 'text',
      text: `Auto-archived ${result.archived} memories:\n${lines.join('\n')}`,
    }],
  }
}
