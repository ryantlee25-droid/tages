import type { Memory } from '@tages/shared'

export type CheckResult = 'compliant' | 'warning' | 'violation'

export interface ConventionCheckResult {
  status: CheckResult
  conflictingConvention?: Memory
  reason?: string
}

/**
 * Tokenize text to a set of lowercase words.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1)
}

/**
 * Check if two texts negation-conflict:
 * One says "always X", the other says "never X" (or similar).
 */
function hasNegationConflict(existingValue: string, newValue: string): boolean {
  const positiveMarkers = ['always', 'must', 'should', 'required', 'use', 'prefer']
  const negativeMarkers = ['never', 'avoid', 'must not', 'do not', 'dont', 'prohibited', 'disallowed']

  const existingLower = existingValue.toLowerCase()
  const newLower = newValue.toLowerCase()

  const existingIsPositive = positiveMarkers.some(m => existingLower.includes(m))
  const existingIsNegative = negativeMarkers.some(m => existingLower.includes(m))
  const newIsPositive = positiveMarkers.some(m => newLower.includes(m))
  const newIsNegative = negativeMarkers.some(m => newLower.includes(m))

  // Both talk about the same concept (token overlap > 30%)
  const tokA = new Set(tokenize(existingValue))
  const tokB = new Set(tokenize(newValue))
  const intersection = [...tokA].filter(t => tokB.has(t))
  const union = new Set([...tokA, ...tokB])
  const overlap = union.size > 0 ? intersection.length / union.size : 0

  if (overlap < 0.3) return false

  // Positive vs negative conflict
  return (existingIsPositive && newIsNegative) || (existingIsNegative && newIsPositive)
}

/**
 * Given a candidate memory, check it against all existing convention memories.
 * Returns the worst status found.
 */
export function checkAgainstConventions(
  candidate: Memory,
  conventions: Memory[],
): ConventionCheckResult {
  for (const conv of conventions) {
    if (conv.id === candidate.id) continue
    if (conv.type !== 'convention') continue

    // Check for negation conflicts
    if (hasNegationConflict(conv.value, candidate.value)) {
      return {
        status: 'violation',
        conflictingConvention: conv,
        reason: `Conflicts with convention "${conv.key}": "${conv.value.slice(0, 80)}"`,
      }
    }

    // Check for keyword overlap suggesting the same topic with different guidance
    const tokA = new Set(tokenize(conv.value))
    const tokB = new Set(tokenize(candidate.value))
    const intersection = [...tokA].filter(t => tokB.has(t))
    const union = new Set([...tokA, ...tokB])
    const overlap = union.size > 0 ? intersection.length / union.size : 0

    // High overlap (>40%) but not negation conflict → warning (may be a duplicate)
    if (overlap > 0.4 && conv.key !== candidate.key) {
      return {
        status: 'warning',
        conflictingConvention: conv,
        reason: `Overlaps with convention "${conv.key}" (${(overlap * 100).toFixed(0)}% similarity)`,
      }
    }
  }

  return { status: 'compliant' }
}
