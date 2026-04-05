import type { SqliteCache } from '../cache/sqlite'
import { scoreMemory, computeProjectHealth } from '../quality/memory-scorer'
import { findContradictions, findStaleRefs } from '../quality/consistency-checker'

export async function handleMemoryQuality(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return { content: [{ type: 'text', text: `Memory "${args.key}" not found.` }] }
  }

  const allMemories = cache.getAllForProject(projectId)
  const score = scoreMemory(memory, allMemories)

  const grade =
    score.total >= 80 ? 'Excellent' :
    score.total >= 60 ? 'Good' :
    score.total >= 40 ? 'Fair' : 'Poor'

  const lines = [
    `Quality score for "${args.key}": ${score.total}/100 (${grade})`,
    `  Completeness:  ${score.completeness}/25  (conditions:${score.breakdown.hasConditions ? 'Y' : 'N'} examples:${score.breakdown.hasExamples ? 'Y' : 'N'} refs:${score.breakdown.hasCrossRefs ? 'Y' : 'N'} tags:${score.breakdown.hasTags ? 'Y' : 'N'} files:${score.breakdown.hasFilePaths ? 'Y' : 'N'})`,
    `  Freshness:     ${score.freshness}/25  (${Math.round(score.breakdown.freshnessAgeDays)} days old)`,
    `  Consistency:   ${score.consistency}/25  (${score.breakdown.hasContradictions ? 'contradictions found' : 'no contradictions'})`,
    `  Usefulness:    ${score.usefulness}/25  (confidence: ${(score.breakdown.recallHitRate * 100).toFixed(0)}%)`,
  ]

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}

export async function handleProjectHealth(
  _args: Record<string, never>,
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const allMemories = cache.getAllForProject(projectId)
  const health = computeProjectHealth(allMemories)
  const contradictions = findContradictions(allMemories.filter(m => m.status === 'live'))
  const staleRefs = findStaleRefs(allMemories, allMemories)

  const lines = [
    `Project Health Score: ${health.averageScore}/100`,
    `  Excellent (80+): ${health.distribution.excellent}  |  Good (60+): ${health.distribution.good}`,
    `  Fair (40+):      ${health.distribution.fair}  |  Poor (<40): ${health.distribution.poor}`,
    `  Contradictions: ${contradictions.length}  |  Stale refs: ${staleRefs.length}`,
  ]

  if (health.worstMemories.length > 0) {
    lines.push('', 'Lowest scoring memories:')
    for (const w of health.worstMemories) {
      lines.push(`  "${w.key}": ${w.score}/100`)
    }
  }

  if (health.suggestions.length > 0) {
    lines.push('', 'Improvement suggestions:')
    for (const s of health.suggestions) {
      lines.push(`  - ${s}`)
    }
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] }
}
