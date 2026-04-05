import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

interface VersionEntry {
  version: number
  value: string
  confidence: number
  changedBy: string | null
  changeReason: string | null
  createdAt: string
  confidenceDelta: number | null
}

export async function handleMemoryHistory(
  args: { key: string; revertToVersion?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return {
      content: [{ type: 'text', text: `No memory found with key "${args.key}".` }],
    }
  }

  // Revert path
  if (args.revertToVersion !== undefined) {
    const versions = cache.getVersions(projectId, args.key)
    const target = versions.find((v) => v.version === args.revertToVersion)
    if (!target) {
      return {
        content: [{ type: 'text', text: `Version ${args.revertToVersion} not found for key "${args.key}".` }],
      }
    }
    // Save current as new version, then restore
    cache.addVersion(projectId, args.key, memory.value, memory.confidence, 'manual', 'revert')
    cache.upsertMemory({
      ...memory,
      value: target.value,
      confidence: target.confidence,
      updatedAt: new Date().toISOString(),
    })
    return {
      content: [{
        type: 'text',
        text: `Reverted "${args.key}" to version ${args.revertToVersion}.\nRestored value: ${target.value}`,
      }],
    }
  }

  // History path
  const versions = cache.getVersions(projectId, args.key)

  if (versions.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No version history for "${args.key}". Memory has not been updated since creation.`,
      }],
    }
  }

  // Compute confidence deltas
  const entries: VersionEntry[] = versions.map((v, i) => {
    const prev = versions[i + 1]
    return {
      ...v,
      confidenceDelta: prev ? v.confidence - prev.confidence : null,
    }
  })

  const currentLine = `Current: ${memory.value} (confidence: ${(memory.confidence * 100).toFixed(0)}%)`
  const historyLines = entries.map((v) => {
    const delta = v.confidenceDelta !== null
      ? ` (Δ${v.confidenceDelta >= 0 ? '+' : ''}${(v.confidenceDelta * 100).toFixed(0)}%)`
      : ''
    const by = v.changedBy ? ` by ${v.changedBy}` : ''
    const reason = v.changeReason ? ` [${v.changeReason}]` : ''
    return `  v${v.version} (${new Date(v.createdAt).toLocaleDateString()})${by}${reason}${delta}: ${v.value.slice(0, 80)}${v.value.length > 80 ? '...' : ''}`
  })

  return {
    content: [{
      type: 'text',
      text: [
        `## Version History: ${args.key}`,
        '',
        currentLine,
        '',
        `Previous versions (${entries.length}):`,
        ...historyLines,
        '',
        `To revert: call memory_history with revertToVersion: <number>`,
      ].join('\n'),
    }],
  }
}
