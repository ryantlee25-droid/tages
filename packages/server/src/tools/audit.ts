import type { SqliteCache } from '../cache/sqlite'
import { auditMemories } from '../audit/memory-auditor'
import type { MemoryType } from '@tages/shared'

const BRIEF_CRITICAL_TYPES: MemoryType[] = [
  'anti_pattern', 'lesson', 'pattern', 'execution', 'convention',
]

/**
 * Handle the memory_audit MCP tool.
 * Calls auditMemories() on the project's cached memories and formats the result.
 */
export async function handleMemoryAudit(
  _args: Record<string, never>,
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memories = cache.getAllForProject(projectId)
  const result = auditMemories(memories)

  const lines: string[] = []

  lines.push(`# Memory Quality Audit`)
  lines.push(`Total memories: ${memories.length} | Score: ${result.score}/100`)
  lines.push('')

  // Type coverage table
  lines.push('## Type Coverage')
  lines.push('')

  const allTypes: MemoryType[] = [
    'anti_pattern', 'lesson', 'pattern', 'execution', 'convention',
    'decision', 'architecture', 'entity', 'preference', 'operational', 'environment',
  ]

  for (const t of allTypes) {
    const count = result.typeCounts[t] ?? 0
    const isCritical = BRIEF_CRITICAL_TYPES.includes(t)
    const status = count === 0 ? 'MISSING' : `${count} stored`
    const marker = isCritical ? ' [brief-critical]' : ''
    lines.push(`  ${count === 0 ? '✗' : '✓'} ${t.padEnd(14)} ${status}${marker}`)
  }

  lines.push('')
  lines.push(`## Brief-Critical Coverage: ${result.briefCriticalCoverage}/100`)
  lines.push(`## Imperative Ratio: ${(result.imperativeRatio * 100).toFixed(0)}% (convention/anti_pattern/lesson with ALWAYS/NEVER/MUST/DO NOT)`)

  if (result.suggestions.length > 0) {
    lines.push('')
    lines.push('## Suggestions')
    for (const s of result.suggestions) {
      lines.push(`  - ${s}`)
    }
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
  }
}
