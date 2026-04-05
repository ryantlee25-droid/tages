import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export async function handleConflicts(
  projectId: string,
  cache: SqliteCache,
  _sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Detect potential conflicts: memories with very similar keys but different values
  const all = cache.getAllForProject(projectId)
  const conflicts: Array<{ a: typeof all[0]; b: typeof all[0]; reason: string }> = []

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]

      // Check for overlapping keys (simple substring/prefix match)
      const aKey = a.key.toLowerCase()
      const bKey = b.key.toLowerCase()

      if (aKey === bKey) continue // Same key = update, not conflict

      // Similar keys with different values
      const shared = longestCommonSubstring(aKey, bKey)
      if (shared.length > Math.min(aKey.length, bKey.length) * 0.6) {
        conflicts.push({ a, b, reason: 'overlapping keys' })
      }

      // Same type + overlapping file paths
      if (a.type === b.type && a.filePaths && b.filePaths) {
        const overlap = a.filePaths.filter((f) => b.filePaths?.includes(f))
        if (overlap.length > 0) {
          conflicts.push({ a, b, reason: `both reference ${overlap[0]}` })
        }
      }
    }
  }

  if (conflicts.length === 0) {
    return {
      content: [{ type: 'text', text: 'No potential conflicts detected between memories.' }],
    }
  }

  const lines = conflicts.slice(0, 10).map((c) =>
    `- **${c.a.key}** vs **${c.b.key}** — ${c.reason}\n  A: ${c.a.value.slice(0, 60)}...\n  B: ${c.b.value.slice(0, 60)}...`,
  )

  return {
    content: [{
      type: 'text',
      text: `## Potential Conflicts (${conflicts.length})\n\n${lines.join('\n\n')}`,
    }],
  }
}

function longestCommonSubstring(a: string, b: string): string {
  let longest = ''
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j <= a.length; j++) {
      const sub = a.slice(i, j)
      if (b.includes(sub) && sub.length > longest.length) {
        longest = sub
      }
    }
  }
  return longest
}
