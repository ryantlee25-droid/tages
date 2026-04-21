/**
 * Behavioral drift — do different agents on the same project follow
 * divergent action sequences?
 *
 * v1 implementation status: STUB.
 *
 * Planned v2 formula: Jensen-Shannon divergence between tool-call frequency
 * distributions per agent_name, optionally weighted by tool criticality
 * (recall vs. remember vs. forget).
 *
 * Data needed (available NOW in tool_call_log):
 *   - agent_name, tool_name, session_id, created_at
 *
 * Why stub for v1:
 *   - Requires 2+ distinct agents with sufficient tool-call volume per
 *     project. Small teams and early installs won't have this signal.
 *   - Surfacing noisy drift scores on thin data misleads users; better
 *     to mark not-implemented until calibration in design-partner phase.
 */

import type { MetricStub, ToolCallRow } from './types.js'

export function computeBehavioralDrift(toolCalls: ToolCallRow[]): MetricStub {
  const agents = new Set(toolCalls.map((c) => c.agent_name).filter((n): n is string => !!n))
  if (agents.size < 2) {
    return {
      score: 0,
      status: 'insufficient_data',
      note: `Behavioral drift requires tool calls from ≥2 agents; found ${agents.size}. Instrument multi-agent sessions before reading this score.`,
    }
  }
  return {
    score: 0,
    status: 'not_implemented',
    note: 'Behavioral drift (JS-divergence across agent tool distributions) is planned for v2. Data is present in tool_call_log; computation pending calibration.',
  }
}
