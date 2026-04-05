import { randomUUID } from 'crypto'
import type { Memory, MemoryType } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { scanForSensitiveData } from './safety'
import { tokenize } from '../search/tokenizer'

/**
 * Passive observation tool. Agents call this during work to report
 * what they're doing. Tages silently extracts memories from the report.
 *
 * Unlike `remember` (explicit, user-driven), `observe` is agent-driven
 * and automatic. Memories extracted have lower confidence (0.7) and
 * source: 'agent'.
 *
 * Usage: Agent calls observe("I'm using snake_case for all API routes
 * because the existing endpoints follow that pattern") → Tages extracts
 * a convention memory automatically.
 */

const PATTERNS: Array<{
  match: RegExp
  type: MemoryType
  keyPrefix: string
}> = [
  // Decisions
  { match: /\b(decided|chose|went with|picked|selected|opted for|using .+ instead of|switched to|migrated to)\b/i, type: 'decision', keyPrefix: 'decision' },
  // Conventions
  { match: /\b(always|never|must|should|convention|pattern|rule|naming|style|format|we use|the standard is|follow the)\b/i, type: 'convention', keyPrefix: 'convention' },
  // Architecture
  { match: /\b(architecture|module|component|layer|boundary|directory|structure|lives in|defined in|imports from|exports)\b/i, type: 'architecture', keyPrefix: 'arch' },
  // Lessons
  { match: /\b(learned|gotcha|watch out|careful|bug|issue|mistake|avoid|don't|broke|fixed because|the reason is)\b/i, type: 'lesson', keyPrefix: 'lesson' },
  // Entities
  { match: /\b(created|added|new|built|implemented|introduced|this (?:class|function|component|module|service))\b/i, type: 'entity', keyPrefix: 'entity' },
]

export async function handleObserve(
  args: { observation: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const text = args.observation.trim()
  if (text.length < 15) {
    return { content: [{ type: 'text', text: 'Observation noted.' }] }
  }

  // Check for sensitive data
  const warnings = scanForSensitiveData(text)
  if (warnings.some(w => w.severity === 'high')) {
    return {
      content: [{
        type: 'text',
        text: 'Observation skipped — contains potentially sensitive data (API key, password, or credential detected).',
      }],
    }
  }

  // Try to classify the observation
  let matchedType: MemoryType | null = null
  let keyPrefix = ''

  for (const pattern of PATTERNS) {
    if (pattern.match.test(text)) {
      matchedType = pattern.type
      keyPrefix = pattern.keyPrefix
      break
    }
  }

  if (!matchedType) {
    // Not classifiable — note but don't store
    return { content: [{ type: 'text', text: 'Observation noted.' }] }
  }

  // Generate a key from the first meaningful phrase
  const key = `${keyPrefix}-${slugify(text.slice(0, 60))}-${Date.now().toString(36).slice(-4)}`
  const now = new Date().toISOString()

  const memory: Memory = {
    id: randomUUID(),
    projectId,
    key,
    value: text,
    type: matchedType,
    source: 'agent',
    status: 'pending' as const,
    confidence: 0.7,
    filePaths: [],
    tags: ['auto-observed'],
    createdAt: now,
    updatedAt: now,
  }

  cache.upsertMemory(memory, true)

  // T8: Tokenize and index for full-text search
  const tokens = tokenize(`${key} ${text}`)
  if (tokens.length > 0) {
    cache.indexMemoryTokens(memory.id, projectId, tokens)
  }

  if (sync) {
    const ok = await sync.remoteInsert(memory)
    if (ok) cache.markSynced([memory.id])
  }

  return {
    content: [{
      type: 'text',
      text: `Noted (pending verification): "${key}" (${matchedType})`,
    }],
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}
