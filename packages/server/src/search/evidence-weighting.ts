import { evidenceWeight } from '@tages/shared'
import type { ScoredMemory } from './ranker'

/**
 * Scale each result's scores by how well established its claim is
 * (migration 0070), so a verified fact outranks an inferred guess.
 *
 * Extracted rather than left inline in handleRecall because it could not
 * otherwise be tested honestly. Through the full recall stack the local
 * scorer saturates `textScore` at 1.0 for every row that matches all query
 * terms and drops the rest entirely, so two competing memories arrive tied —
 * and a tie is resolved arbitrarily (measured: six identical runs produced two
 * different orders). A test written against that stack passes or fails by
 * chance and proves nothing about the weighting either way.
 *
 * Here the inputs are explicit, so a test can give the weaker claim a strictly
 * higher base score and assert that the weighting is what flips it.
 *
 * Pure: returns new objects and never mutates the input.
 */
export function applyEvidenceWeight(results: ScoredMemory[]): ScoredMemory[] {
  return results.map(r => {
    const w = evidenceWeight(r.memory.evidence)
    return {
      ...r,
      semanticScore: r.semanticScore * w,
      textScore: r.textScore * w,
    }
  })
}
