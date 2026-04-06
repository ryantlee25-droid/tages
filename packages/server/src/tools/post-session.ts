import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { Memory } from '@tages/shared'
import { handleSessionEnd } from './session-end'

/**
 * Inline brief generation — mirrors the logic in packages/cli/src/commands/brief.ts
 * and packages/server/src/tools/brief.ts without importing across package boundaries.
 *
 * Returns a brief markdown string from a set of memories.
 */
function generateBriefFromMemories(memories: Memory[]): string {
  const grouped: Record<string, Memory[]> = {}
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }

  for (const items of Object.values(grouped)) {
    items.sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
  }

  const sections: string[] = []
  const header = `# Project Brief\n_Tages context — ${memories.length} memories. Follow these rules._\n`
  sections.push(header)

  // 1. GOTCHAS
  const gotchas = [...(grouped.anti_pattern || []), ...(grouped.lesson || [])]
  if (gotchas.length > 0) {
    const lines = [`## STOP — Read Before Coding\n`]
    for (const m of gotchas) {
      lines.push(`- **${m.key}**: ${m.value}`)
      if (m.filePaths?.length) lines.push(`  → \`${m.filePaths.join('`, `')}\``)
    }
    sections.push(lines.join('\n') + '\n')
  }

  // 2. INTEGRATION RECIPES
  const recipes = [...(grouped.execution || []), ...(grouped.pattern || [])]
  if (recipes.length > 0) {
    const lines = [`## Integration Recipes\n`]
    for (const m of recipes) {
      lines.push(`### ${m.key}`)
      lines.push(`- ${m.value}`)
      if (m.filePaths?.length) lines.push(`_Touch: \`${m.filePaths.join('`, `')}\`_`)
      lines.push('')
    }
    sections.push(lines.join('\n') + '\n')
  }

  // 3. CONVENTIONS
  if (grouped.convention) {
    const lines = [`## Conventions\n`]
    for (const m of grouped.convention) {
      lines.push(`- **${m.key}**: ${m.value}`)
      if (m.filePaths?.length) lines.push(`  → \`${m.filePaths.join('`, `')}\``)
    }
    sections.push(lines.join('\n') + '\n')
  }

  // 4. ARCHITECTURE
  if (grouped.architecture) {
    const lines = [`## Architecture\n`]
    for (const m of grouped.architecture) lines.push(`- **${m.key}**: ${m.value}`)
    sections.push(lines.join('\n') + '\n')
  }

  // 5. DECISIONS
  if (grouped.decision) {
    const lines = [`## Decisions\n`]
    for (const m of grouped.decision) lines.push(`- **${m.key}**: ${m.value}`)
    sections.push(lines.join('\n') + '\n')
  }

  sections.push(`\n---\n_Generated ${new Date().toISOString()}_\n`)
  return sections.join('\n')
}

/**
 * Post-session MCP tool handler.
 *
 * Extracts memories from a session summary (via handleSessionEnd), then
 * optionally regenerates the project brief from cache.
 *
 * Returns a combined result: extraction summary + brief (if refreshBrief=true).
 */
export async function handlePostSession(
  args: { summary: string; refreshBrief?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // Step 1: Extract and persist memories
  const sessionResult = await handleSessionEnd(
    { summary: args.summary, extractMemories: true },
    projectId,
    cache,
    sync,
  )

  const sessionText = sessionResult.content.map((c) => c.text).join('\n')

  // Step 2: Optionally regenerate brief
  if (!args.refreshBrief) {
    return {
      content: [
        { type: 'text', text: sessionText },
        { type: 'text', text: 'Brief refresh skipped (refreshBrief=false).' },
      ],
    }
  }

  const allMemories = cache.getAllForProject(projectId)

  if (allMemories.length === 0) {
    return {
      content: [
        { type: 'text', text: sessionText },
        { type: 'text', text: 'Brief refresh skipped — no memories in cache.' },
      ],
    }
  }

  const briefContent = generateBriefFromMemories(allMemories)

  return {
    content: [
      { type: 'text', text: sessionText },
      { type: 'text', text: `Brief regenerated (${allMemories.length} memories):\n\n${briefContent}` },
    ],
  }
}
