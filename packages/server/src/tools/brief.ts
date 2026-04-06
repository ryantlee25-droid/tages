import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const DEFAULT_BUDGET = 3000

/**
 * Generate a token-budgeted project brief for system prompt injection.
 * Prioritizes gotchas, conventions, and architecture — the memories
 * that prevent mistakes during implementation.
 */
export async function handleBrief(
  args: { task?: string; budget?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const budget = args.budget || DEFAULT_BUDGET

  // Pull all memories from cache (SQLite-first)
  const allMemories = cache.getAllForProject(projectId)

  if (allMemories.length === 0) {
    return {
      content: [{ type: 'text', text: 'No memories stored. Use `remember` to build project knowledge.' }],
    }
  }

  // Group by type
  const grouped: Record<string, Memory[]> = {}
  for (const m of allMemories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }

  // Sort each group by confidence descending
  for (const items of Object.values(grouped)) {
    items.sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
  }

  const sections: string[] = []
  let estimatedTokens = 0

  const header = `# Project Brief\n_Tages context injection — ${allMemories.length} memories available._\n`
  sections.push(header)
  estimatedTokens += estimateTokens(header)

  // Priority order: gotchas first, then conventions, architecture, decisions, patterns, rest
  const priorityOrder: Array<{ types: string[]; title: string; subtitle?: string }> = [
    { types: ['anti_pattern', 'lesson'], title: 'STOP: Known Gotchas', subtitle: 'Check every change against these.' },
    { types: ['convention'], title: 'Conventions', subtitle: 'Follow these patterns.' },
    { types: ['architecture'], title: 'Architecture' },
    { types: ['decision'], title: 'Decisions' },
    { types: ['pattern'], title: 'Patterns' },
    { types: ['entity'], title: 'Key Entities' },
    { types: ['execution'], title: 'Execution Flows' },
    { types: ['operational'], title: 'Operational' },
    { types: ['environment'], title: 'Environment' },
    { types: ['preference'], title: 'Preferences' },
  ]

  const covered = new Set<string>()

  for (const group of priorityOrder) {
    const items: Memory[] = []
    for (const t of group.types) {
      if (grouped[t]) items.push(...grouped[t])
      covered.add(t)
    }
    if (items.length === 0) continue

    const section = formatSection(group.title, items, group.subtitle)
    const tokens = estimateTokens(section)
    if (estimatedTokens + tokens > budget) {
      // Try truncated version with fewer items
      const truncated = formatSection(group.title, items.slice(0, 3), group.subtitle)
      const truncTokens = estimateTokens(truncated)
      if (estimatedTokens + truncTokens <= budget) {
        sections.push(truncated)
        estimatedTokens += truncTokens
      }
      break // budget exhausted
    }
    sections.push(section)
    estimatedTokens += tokens
  }

  if (args.task) {
    const taskSection = `\n## Current Task\n${args.task}\n`
    const tokens = estimateTokens(taskSection)
    if (estimatedTokens + tokens <= budget) {
      sections.push(taskSection)
      estimatedTokens += tokens
    }
  }

  sections.push(`\n---\n_~${estimatedTokens} tokens | Generated ${new Date().toISOString()}_\n`)

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
  }
}

function formatSection(title: string, items: Memory[], subtitle?: string): string {
  const lines = [`## ${title}`]
  if (subtitle) lines.push(`_${subtitle}_\n`)
  else lines.push('')

  for (const item of items) {
    lines.push(`- **${item.key}**: ${item.value}`)
    if (item.filePaths?.length) {
      lines.push(`  _Files: ${item.filePaths.join(', ')}_`)
    }
  }

  return lines.join('\n') + '\n'
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
