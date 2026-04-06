import type { Memory, MemoryType } from '@tages/shared'

export interface AuditResult {
  typeCounts: Record<MemoryType, number>
  missingTypes: MemoryType[]
  briefCriticalCoverage: number
  imperativeRatio: number
  suggestions: string[]
  score: number
}

const ALL_TYPES: MemoryType[] = [
  'convention', 'decision', 'architecture', 'entity', 'lesson',
  'preference', 'pattern', 'execution', 'operational', 'environment', 'anti_pattern',
]

const BRIEF_CRITICAL_TYPES: MemoryType[] = [
  'anti_pattern', 'lesson', 'pattern', 'execution', 'convention',
]

const IMPERATIVE_WORDS = /\b(ALWAYS|NEVER|MUST|DO NOT|STOP|AVOID|REQUIRE|ENSURE|USE)\b/

const IMPERATIVE_TYPES: MemoryType[] = ['convention', 'anti_pattern', 'lesson']

/**
 * Audit a project's memories for type coverage and imperative phrasing quality.
 *
 * Score breakdown:
 *   60% — type coverage (brief-critical types, 20 pts each, capped at 100)
 *   40% — imperative ratio (fraction of convention/anti_pattern/lesson that start with imperative words)
 */
export function auditMemories(memories: Memory[]): AuditResult {
  // Count by type
  const typeCounts: Record<MemoryType, number> = {} as Record<MemoryType, number>
  for (const t of ALL_TYPES) {
    typeCounts[t] = 0
  }
  for (const m of memories) {
    if (m.type in typeCounts) {
      typeCounts[m.type as MemoryType]++
    }
  }

  // Missing types (zero count)
  const missingTypes: MemoryType[] = ALL_TYPES.filter(t => typeCounts[t] === 0)

  // Brief-critical coverage: 20 pts per covered type, max 100
  const coveredCritical = BRIEF_CRITICAL_TYPES.filter(t => typeCounts[t] > 0)
  const briefCriticalCoverage = coveredCritical.length * 20

  // Imperative ratio: fraction of imperative-type memories that contain imperative words
  const imperativeCandidates = memories.filter(m => IMPERATIVE_TYPES.includes(m.type))
  const imperativeCount = imperativeCandidates.filter(m => IMPERATIVE_WORDS.test(m.value)).length
  const imperativeRatio = imperativeCandidates.length === 0
    ? 0
    : imperativeCount / imperativeCandidates.length

  // Weighted score: 60% type coverage + 40% imperative ratio
  const score = Math.round(briefCriticalCoverage * 0.6 + imperativeRatio * 100 * 0.4)

  // Suggestions
  const suggestions: string[] = []

  const missingCritical = BRIEF_CRITICAL_TYPES.filter(t => typeCounts[t] === 0)
  if (missingCritical.length > 0) {
    suggestions.push(
      `Add memories of type: ${missingCritical.join(', ')} — these are brief-critical and improve context quality by 20 pts each.`
    )
  }

  if (imperativeRatio < 0.5 && imperativeCandidates.length > 0) {
    const nonImperative = imperativeCandidates.filter(m => !IMPERATIVE_WORDS.test(m.value)).length
    suggestions.push(
      `${nonImperative} convention/anti_pattern/lesson memories lack imperative phrasing (ALWAYS/NEVER/MUST). Run \`tages sharpen --all\` to fix.`
    )
  }

  if (memories.length < 10) {
    suggestions.push(`Only ${memories.length} memories stored. Aim for 10+ for meaningful briefs.`)
  }

  if (typeCounts.anti_pattern === 0) {
    suggestions.push('No anti_pattern memories — add gotchas with `tages remember <key> <value> -t anti_pattern`.')
  }

  return {
    typeCounts,
    missingTypes,
    briefCriticalCoverage,
    imperativeRatio,
    suggestions,
    score,
  }
}
