/**
 * Semantic drift — how much does the VALUE of a given memory key shift
 * across writes by different sessions or agents?
 *
 * Intuition: a memory key whose value is rewritten to N distinct values
 * across the window is less stable than one written to 1 or 2 values.
 * A low-instability key represents consensus; a high-instability key
 * represents either conflict or churn.
 *
 * Formula (v1):
 *   instability(key) = 1 - (1 / distinctValues)
 *     where distinctValues counts unique normalized values observed.
 *   semantic_drift_score = mean(instability) over keys that had ≥1
 *     modification (keys with only "added" but no later write are stable
 *     by definition and contribute 0).
 *
 * This is deliberately simple. v2 will incorporate:
 *   - Semantic similarity (embedding-distance between values) rather than
 *     raw value equality — two rewordings of "use tabs" should not count
 *     as drift.
 *   - Time-decay weighting — a 6-month-old disagreement matters less than
 *     yesterday's.
 *   - Cross-agent weighting — drift BETWEEN agents matters more than
 *     drift within a single session's refinement.
 */

import type {
  FieldChangeRow,
  SemanticDriftKeyReport,
  SemanticDriftReport,
} from './types.js'

export function computeSemanticDrift(
  changes: FieldChangeRow[],
  options: { topK?: number } = {},
): SemanticDriftReport {
  const topK = options.topK ?? 10

  // Group by memory_id (keyed by memory_key when available, falling back to id)
  const byMemory = new Map<
    string,
    {
      memoryKey: string
      memoryId: string
      values: string[]
      sessions: Set<string>
      agents: Set<string>
      totalChanges: number
    }
  >()

  for (const row of changes) {
    if (row.field_name !== 'value') continue // only track value changes for v1
    const memoryId = row.memory_id
    const groupKey = row.memory_key ?? memoryId
    const group = byMemory.get(memoryId) ?? {
      memoryKey: groupKey,
      memoryId,
      values: [],
      sessions: new Set<string>(),
      agents: new Set<string>(),
      totalChanges: 0,
    }
    group.totalChanges++
    const newVal = normalizeValue(row.new_value)
    if (newVal !== null) group.values.push(newVal)
    if (row.session_id) group.sessions.add(row.session_id)
    if (row.agent_name) group.agents.add(row.agent_name)
    byMemory.set(memoryId, group)
  }

  const reports: SemanticDriftKeyReport[] = []
  for (const g of byMemory.values()) {
    const distinct = new Set(g.values).size
    if (distinct === 0) continue
    const instability = distinct <= 1 ? 0 : 1 - 1 / distinct
    reports.push({
      memoryKey: g.memoryKey,
      distinctValues: distinct,
      totalChanges: g.totalChanges,
      instability,
      sessions: [...g.sessions],
      agents: [...g.agents],
    })
  }

  reports.sort((a, b) => b.instability - a.instability || b.totalChanges - a.totalChanges)

  const keysWithDrift = reports.filter((r) => r.instability > 0).length
  const score =
    reports.length === 0
      ? 0
      : reports.reduce((acc, r) => acc + r.instability, 0) / reports.length

  return {
    score,
    keysExamined: reports.length,
    keysWithDrift,
    topKeys: reports.slice(0, topK),
  }
}

/**
 * Normalize a JSONB value to a stable string for equality checks.
 * Returns null for absent/empty so downstream can skip.
 */
function normalizeValue(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    return trimmed.length === 0 ? null : trimmed
  }
  try {
    return JSON.stringify(raw)
  } catch {
    return null
  }
}
