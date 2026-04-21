/**
 * Top-level drift computation — aggregates semantic, coordination, and
 * behavioral sub-metrics into a single 0..1 score.
 *
 * v1 weights reflect which metrics have real data:
 *   - semantic: 1.0 (fully implemented)
 *   - coordination: 0 (blocked on schema)
 *   - behavioral: 0 (stub pending v2)
 *
 * When other metrics come online, re-balance weights in one place here.
 */

import { computeSemanticDrift } from './semantic-drift.js'
import { computeCoordinationDrift } from './coordination-drift.js'
import { computeBehavioralDrift } from './behavioral-drift.js'
import type { DriftInput, DriftReport } from './types.js'

const WEIGHTS = { semantic: 1.0, coordination: 0, behavioral: 0 } as const

export function computeDrift(input: DriftInput): DriftReport {
  const semantic = computeSemanticDrift(input.fieldChanges)
  const coordination = computeCoordinationDrift()
  const behavioral = computeBehavioralDrift(input.toolCalls)

  const weighted =
    semantic.score * WEIGHTS.semantic +
    coordination.score * WEIGHTS.coordination +
    behavioral.score * WEIGHTS.behavioral

  const totalWeight = WEIGHTS.semantic + WEIGHTS.coordination + WEIGHTS.behavioral
  const driftScore = totalWeight === 0 ? 0 : weighted / totalWeight

  return {
    projectId: input.projectId,
    window: { since: input.since, generatedAt: new Date().toISOString() },
    agentFilter: input.agentFilter,
    experimental: true,
    driftScore,
    weights: { ...WEIGHTS },
    semantic,
    coordination,
    behavioral,
  }
}
