import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'

// Priority order: anti_pattern > convention > lesson > pattern > everything else
// anti_pattern is listed in task docs but not in the shared MemoryType; handle gracefully.
const TYPE_PRIORITY: Record<string, number> = {
  anti_pattern: 0,
  convention: 1,
  lesson: 2,
  pattern: 3,
  decision: 4,
  architecture: 5,
  entity: 6,
  preference: 7,
  execution: 8,
  operational: 9,
  environment: 10,
}

function typePriority(type: MemoryType | string): number {
  return TYPE_PRIORITY[type] ?? 99
}

/**
 * Normalise a path so we can do reliable prefix comparisons.
 * Adds a trailing slash to directories (paths that don't look like files).
 */
function normalise(p: string): string {
  return p.endsWith('/') ? p : p
}

/**
 * Score how well a memory's filePaths match the provided input paths.
 * Returns the highest match score found across all combinations.
 *
 * Match types (higher is better):
 *   3 — exact match
 *   2 — memory path is a directory prefix of an input path
 *   1 — input path is a prefix of a memory path (reverse prefix)
 *   0 — no match
 */
function scoreMatch(memoryPaths: string[], inputPaths: string[]): { score: number; matchedPath: string } {
  let bestScore = 0
  let bestMatchedPath = ''

  for (const mp of memoryPaths) {
    for (const ip of inputPaths) {
      // Exact match
      if (mp === ip) {
        if (3 > bestScore) {
          bestScore = 3
          bestMatchedPath = mp
        }
        continue
      }

      // Prefix match: memory path is a directory prefix of input path
      // e.g. memory has "src/commands/", input has "src/commands/foo.ts"
      const mpDir = mp.endsWith('/') ? mp : mp + '/'
      if (ip.startsWith(mpDir) || ip.startsWith(mp + '/')) {
        if (2 > bestScore) {
          bestScore = 2
          bestMatchedPath = mp
        }
        continue
      }

      // Reverse prefix: input path is a prefix of memory path
      // e.g. memory has "src/commands/foo.ts", input has "src/commands/"
      const ipDir = ip.endsWith('/') ? ip : ip + '/'
      if (mp.startsWith(ipDir) || mp.startsWith(ip + '/')) {
        if (1 > bestScore) {
          bestScore = 1
          bestMatchedPath = mp
        }
      }
    }
  }

  return { score: bestScore, matchedPath: bestMatchedPath }
}

export async function handleFileRecall(
  args: { filePaths: string[]; limit?: number },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit ?? 10
  const inputPaths = args.filePaths

  // Get all memories for the project and filter to live ones
  const allMemories = cache.getAllForProject(projectId)
  const liveMemories = allMemories.filter(m => m.status === 'live')

  // Score each memory against the input paths
  type ScoredMemory = { memory: Memory; score: number; matchedPath: string }
  const scored: ScoredMemory[] = []

  for (const memory of liveMemories) {
    if (!memory.filePaths || memory.filePaths.length === 0) continue

    const { score, matchedPath } = scoreMatch(memory.filePaths, inputPaths)
    if (score > 0) {
      scored.push({ memory, score, matchedPath })
    }
  }

  // Sort: first by match score (desc), then by type priority (asc = more important first)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return typePriority(a.memory.type) - typePriority(b.memory.type)
  })

  const results = scored.slice(0, limit)

  const sections: string[] = []
  sections.push(`## File Recall for: ${inputPaths.join(', ')}`)
  sections.push('')

  if (results.length === 0) {
    sections.push('No memories match the provided file paths.')
  } else {
    sections.push(`### Matched Memories (${results.length})`)
    sections.push('')
    for (const { memory, matchedPath } of results) {
      sections.push(`- [${memory.type}] **${memory.key}**: ${memory.value}`)
      sections.push(`  _(matched via: ${matchedPath})_`)
    }
  }

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
  }
}
