import type { Memory } from '@tages/shared'

export interface ConsolidationResult {
  surviving: Memory
  deletedKey: string
  mergeNote: string
}

/**
 * Merge two memories, keeping survivorId as the surviving memory.
 * Unions all metadata arrays, concats unique examples, keeps higher confidence.
 * The surviving memory absorbs all crossSystemRefs from the deleted one.
 */
export function applyConsolidation(
  survivor: Memory,
  victim: Memory,
  mergedValue?: string,
): ConsolidationResult {
  const now = new Date().toISOString()

  // Union array fields
  const unionArr = <T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => {
    const combined = [...(a || []), ...(b || [])]
    if (combined.length === 0) return undefined
    // Deduplicate by string representation
    const seen = new Set<string>()
    return combined.filter(item => {
      const key = JSON.stringify(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // Redirect victim's crossSystemRefs to point to survivor key
  const victimRefs = (victim.crossSystemRefs || []).filter(ref => ref !== survivor.key)
  const survivorRefs = (survivor.crossSystemRefs || []).filter(ref => ref !== victim.key)
  const mergedRefs = unionArr(survivorRefs, victimRefs)

  const merged: Memory = {
    ...survivor,
    value: mergedValue ?? (survivor.value.length >= victim.value.length ? survivor.value : victim.value),
    confidence: Math.max(survivor.confidence, victim.confidence),
    conditions: unionArr(survivor.conditions, victim.conditions),
    phases: unionArr(survivor.phases, victim.phases),
    crossSystemRefs: mergedRefs,
    examples: unionArr(survivor.examples, victim.examples),
    tags: unionArr(survivor.tags, victim.tags),
    filePaths: unionArr(survivor.filePaths, victim.filePaths),
    updatedAt: now,
  }

  return {
    surviving: merged,
    deletedKey: victim.key,
    mergeNote: `Consolidated "${victim.key}" into "${survivor.key}" (confidence: ${merged.confidence.toFixed(2)})`,
  }
}
