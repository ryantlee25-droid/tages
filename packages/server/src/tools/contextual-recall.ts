import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

interface RecallContext {
  currentFiles?: string[]
  agentName?: string
  phase?: string
}

export async function handleContextualRecall(
  args: { query: string; context?: RecallContext; limit?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const limit = args.limit || 5
  const context = args.context || {}

  // Get candidate memories via text search
  const candidates = cache.queryMemories(projectId, args.query, undefined, limit * 4)

  // Also get all if query is empty
  const pool: Memory[] = args.query.trim()
    ? candidates
    : cache.getAllForProject(projectId).filter((m) => m.status === 'live')

  // Filter by context
  const filtered = pool.filter((m) => {
    // Agent name filter
    if (context.agentName && m.agentName && m.agentName !== context.agentName) {
      return false
    }

    // Phase filter: memory must include the requested phase
    if (context.phase && m.phases && m.phases.length > 0) {
      if (!m.phases.includes(context.phase)) return false
    }

    // File context: if memory has conditions that look like file paths, check overlap
    if (context.currentFiles && context.currentFiles.length > 0 && m.filePaths && m.filePaths.length > 0) {
      const overlap = m.filePaths.some((fp) =>
        context.currentFiles!.some((cf) => cf.includes(fp) || fp.includes(cf)),
      )
      // If file paths are specified and none overlap, still include but deprioritize
      // We allow all through — conditions is the primary filter
    }

    // Conditions filter: memory conditions must overlap with provided context signals
    if (context.currentFiles && context.currentFiles.length > 0 && m.conditions && m.conditions.length > 0) {
      const contextSignals = [
        ...(context.currentFiles || []),
        context.agentName || '',
        context.phase || '',
      ].filter(Boolean).map((s) => s.toLowerCase())

      const condLower = m.conditions.map((c) => c.toLowerCase())
      const hasMatch = condLower.some((c) =>
        contextSignals.some((s) => s.includes(c) || c.includes(s)),
      )
      if (!hasMatch) return false
    }

    return true
  })

  const results = filtered.slice(0, limit)

  if (results.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No memories found matching "${args.query}" with the given context.`,
      }],
    }
  }

  const contextDesc = [
    context.agentName ? `agent: ${context.agentName}` : '',
    context.phase ? `phase: ${context.phase}` : '',
    context.currentFiles?.length ? `files: ${context.currentFiles.slice(0, 3).join(', ')}` : '',
  ].filter(Boolean).join(', ')

  const lines = results.map((m, i) => {
    const parts = [`${i + 1}. [${m.type}] ${m.key}`, `   ${m.value}`]
    if (m.conditions?.length) parts.push(`   When: ${m.conditions.join('; ')}`)
    if (m.filePaths?.length) parts.push(`   Files: ${m.filePaths.join(', ')}`)
    return parts.join('\n')
  })

  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} memories for "${args.query}"${contextDesc ? ` (${contextDesc})` : ''}:\n\n${lines.join('\n\n')}`,
    }],
  }
}
