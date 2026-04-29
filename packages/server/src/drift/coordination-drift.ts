/**
 * Coordination drift — fraction of memories that have NOT propagated to the
 * teams that own their sections.
 *
 * v1 implementation status: STUB.
 *
 * Planned formula: for each memory M with a designated owning team T
 * (derived from .tages/agents-md-owners.json section mapping), check
 * whether members of T have the memory visible. Drift rises when memories
 * are federation-inaccessible to their owning team.
 *
 * Blocked on schema: memories table has no `team_id` column (noted in
 * packages/server/src/agents-md/diff.ts:36-39). The agents-md federate
 * command writes section→team mappings to disk but cannot yet filter the
 * memory store by team. Until a migration adds team_id, this metric has
 * no source data.
 *
 * When team_id ships:
 *   1. Replace the stub with a computation over (memory, owning_team) pairs.
 *   2. Lift this metric's weight in compute.ts from 0 to ~0.33.
 */

import type { MetricStub } from './types.js'

export function computeCoordinationDrift(): MetricStub {
  return {
    score: 0,
    status: 'not_implemented',
    note: 'Coordination drift is blocked on the memories.team_id column. Once federation-aware memory filtering ships, this metric will quantify memories that have not propagated to their owning team.',
  }
}
