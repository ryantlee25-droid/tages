/**
 * 3-Way Memory Merge
 *
 * Implements automatic conflict resolution using LCS diff for text values
 * and recursive merge for structured fields (arrays, executionFlow, etc.)
 */
import type { Memory } from '@tages/shared'

export interface MergeResult {
  merged: Partial<Memory>
  conflicts: string[] // field names that had unresolvable conflicts
  strategy: 'clean' | 'partial' | 'conflict'
}

/**
 * Compute Longest Common Subsequence of two arrays.
 */
function lcs<T>(a: T[], b: T[]): T[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const result: T[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result
}

/**
 * Merge two text values using LCS-based diff.
 *
 * Strategy: find the common subsequence of words, then interleave
 * additions from both sides. When both sides add different text at
 * the same position, concatenate with a separator.
 */
export function lcsTextMerge(a: string, b: string): string {
  if (a === b) return a
  if (!a) return b
  if (!b) return a

  const wordsA = a.split(/\s+/).filter(Boolean)
  const wordsB = b.split(/\s+/).filter(Boolean)
  const common = lcs(wordsA, wordsB)

  // Build merged text by walking both word sequences
  const result: string[] = []
  let ia = 0, ib = 0, ic = 0

  while (ic < common.length) {
    const word = common[ic]
    // Collect additions from A before this common word
    const addedA: string[] = []
    while (ia < wordsA.length && wordsA[ia] !== word) addedA.push(wordsA[ia++])
    // Collect additions from B before this common word
    const addedB: string[] = []
    while (ib < wordsB.length && wordsB[ib] !== word) addedB.push(wordsB[ib++])

    // Add unique additions (avoid duplication)
    for (const w of addedA) {
      if (!addedB.includes(w)) result.push(w)
    }
    for (const w of addedB) result.push(w)

    result.push(word)
    ia++; ib++; ic++
  }

  // Trailing additions
  const trailingA = wordsA.slice(ia)
  const trailingB = wordsB.slice(ib)
  for (const w of trailingA) {
    if (!trailingB.includes(w)) result.push(w)
  }
  for (const w of trailingB) result.push(w)

  return result.join(' ')
}

/**
 * Merge structured fields (arrays, executionFlow) from two memory versions.
 * Arrays are merged as union (deduplication). ExecutionFlow steps are LCS-merged.
 */
export function mergeStructuredFields(a: Partial<Memory>, b: Partial<Memory>): Partial<Memory> {
  const result: Partial<Memory> = {}

  // Array union fields
  const arrayFields = ['filePaths', 'tags', 'conditions', 'phases', 'crossSystemRefs'] as const
  for (const field of arrayFields) {
    const arrA = (a as Record<string, unknown>)[field] as string[] | undefined
    const arrB = (b as Record<string, unknown>)[field] as string[] | undefined
    if (arrA || arrB) {
      const combined = [...(arrA || []), ...(arrB || [])]
      const deduped = [...new Set(combined)]
      ;(result as Record<string, unknown>)[field] = deduped
    }
  }

  // Merge executionFlow
  if (a.executionFlow || b.executionFlow) {
    if (!a.executionFlow) {
      result.executionFlow = b.executionFlow
    } else if (!b.executionFlow) {
      result.executionFlow = a.executionFlow
    } else {
      const stepsA = a.executionFlow.steps
      const stepsB = b.executionFlow.steps
      const mergedSteps = [...new Set([...stepsA, ...stepsB])]
      // Preserve order from LCS
      const orderedSteps = lcs(stepsA, stepsB)
      const extras = mergedSteps.filter(s => !orderedSteps.includes(s))
      result.executionFlow = {
        trigger: a.executionFlow.trigger || b.executionFlow.trigger,
        steps: [...orderedSteps, ...extras],
        phases: a.executionFlow.phases || b.executionFlow.phases,
        hooks: [...new Set([...(a.executionFlow.hooks || []), ...(b.executionFlow.hooks || [])])],
      }
    }
  }

  // Merge examples — union by input key
  if (a.examples || b.examples) {
    const examplesA = a.examples || []
    const examplesB = b.examples || []
    const byInput = new Map<string, (typeof examplesA)[number]>()
    for (const ex of examplesA) byInput.set(ex.input, ex)
    for (const ex of examplesB) {
      if (!byInput.has(ex.input)) byInput.set(ex.input, ex)
    }
    result.examples = [...byInput.values()]
  }

  return result
}

/**
 * Perform a 3-way merge of memory fields.
 *
 * @param base  - The common ancestor (before both left and right diverged)
 * @param left  - One diverged version
 * @param right - The other diverged version
 */
export function threeWayMerge(
  base: Partial<Memory>,
  left: Partial<Memory>,
  right: Partial<Memory>,
): MergeResult {
  const conflicts: string[] = []
  const merged: Partial<Memory> = {}

  // Text value: 3-way merge
  if (left.value !== undefined || right.value !== undefined) {
    const baseVal = base.value || ''
    const leftVal = left.value || ''
    const rightVal = right.value || ''

    if (leftVal === rightVal) {
      merged.value = leftVal
    } else if (leftVal === baseVal) {
      // Only right changed
      merged.value = rightVal
    } else if (rightVal === baseVal) {
      // Only left changed
      merged.value = leftVal
    } else {
      // Both changed — use LCS text merge
      merged.value = lcsTextMerge(leftVal, rightVal)
    }
  }

  // Confidence: take the higher confidence, or average if both changed from base
  if (left.confidence !== undefined || right.confidence !== undefined) {
    const leftConf = left.confidence ?? base.confidence ?? 1.0
    const rightConf = right.confidence ?? base.confidence ?? 1.0
    merged.confidence = Math.max(leftConf, rightConf)
  }

  // Merge structured fields
  const structuredMerge = mergeStructuredFields(left, right)
  Object.assign(merged, structuredMerge)

  // Scalar fields: if only one side changed from base, take the changed value
  const scalarFields = ['type', 'source', 'status', 'agentName', 'verifiedAt'] as const
  for (const field of scalarFields) {
    const baseVal = (base as Record<string, unknown>)[field]
    const leftVal = (left as Record<string, unknown>)[field]
    const rightVal = (right as Record<string, unknown>)[field]

    if (leftVal === rightVal) {
      if (leftVal !== undefined) (merged as Record<string, unknown>)[field] = leftVal
    } else if (leftVal === baseVal || leftVal === undefined) {
      if (rightVal !== undefined) (merged as Record<string, unknown>)[field] = rightVal
    } else if (rightVal === baseVal || rightVal === undefined) {
      if (leftVal !== undefined) (merged as Record<string, unknown>)[field] = leftVal
    } else {
      // Both changed differently — flag as conflict, take left (newer-wins fallback)
      conflicts.push(field)
      if (leftVal !== undefined) (merged as Record<string, unknown>)[field] = leftVal
    }
  }

  const strategy: MergeResult['strategy'] =
    conflicts.length === 0 ? 'clean' :
    Object.keys(merged).length > 0 ? 'partial' : 'conflict'

  return { merged, conflicts, strategy }
}
