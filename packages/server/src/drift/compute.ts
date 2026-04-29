/**
 * Top-level drift computation — aggregates semantic, coordination, and
 * behavioral sub-metrics into a single 0..1 score.
 *
 * v1.1 weights reflect which metrics have real data:
 *   - semantic: 0.7 (fully implemented)
 *   - behavioral: 0.3 (JSD across agent tool-call distributions)
 *   - coordination: 0 (blocked on memories.team_id schema)
 *
 * When coordination ships, rebalance to {semantic: 0.5, coordination: 0.25,
 * behavioral: 0.25} — single change in one place here.
 *
 * Note on the rebalance: projects with no multi-agent tool-call history will
 * see behavioral return 'insufficient_data' (score 0), which dilutes the
 * overall driftScore vs. the v1.0 ({1.0, 0, 0}) numbers. Documented in the
 * release notes for the v0.3.1 ship.
 */

import { computeSemanticDrift } from './semantic-drift.js'
import { computeCoordinationDrift } from './coordination-drift.js'
import { computeBehavioralDrift } from './behavioral-drift.js'
import type { DriftInput, DriftReport } from './types.js'

const WEIGHTS = { semantic: 0.7, coordination: 0, behavioral: 0.3 } as const

export function computeDrift(input: DriftInput): DriftReport {
  const semantic = computeSemanticDrift(input.fieldChanges)
  const coordination = computeCoordinationDrift()
  const behavioral = computeBehavioralDrift(input.toolCalls, {
    baselineSince: input.baselineSince,
    currentSince: input.currentSince,
  })

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
