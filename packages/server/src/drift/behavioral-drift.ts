/**
 * Behavioral drift — has each agent's tool-call distribution shifted between
 * a baseline window and a current window?
 *
 * Approach: for each agent active in BOTH windows, build Laplace-smoothed
 * probability vectors over the union tool vocabulary, compute Jensen-Shannon
 * divergence between baseline and current, normalize to [0,1] (divide by ln 2),
 * and average across eligible agents to produce the drift score.
 *
 * Inter-agent divergence within a single window is a different question
 * (intentionally out of scope for v1); the per-agent temporal framing matches
 * the standard ASI definition of "drift" as a change over time.
 *
 * Windowing:
 *   - If both baselineSince and currentSince are provided → window A spans
 *     [baselineSince, currentSince), window B spans [currentSince, max(t)].
 *   - Otherwise → midpoint split between min(t) and max(t) of the input.
 *
 * Eligibility: an agent contributes a JSD value only if it has ≥
 * MIN_CALLS_PER_WINDOW (5) calls in each window. Below threshold the agent is
 * ignored. If no agents are eligible, status returns 'insufficient_data'.
 */

import type {
  AgentToolDistribution,
  BehavioralDriftReport,
  BehavioralWindow,
  ToolCallRow,
} from './types.js'

const MIN_CALLS_PER_WINDOW = 5
const MAX_AGENTS = 20

interface WindowBounds {
  aStart: number
  bStart: number
  bEnd: number
}

interface ResolvedWindows {
  bounds: WindowBounds
  windowA: ToolCallRow[]
  windowB: ToolCallRow[]
}

function resolveWindows(
  toolCalls: ToolCallRow[],
  baselineSince?: string,
  currentSince?: string,
): ResolvedWindows | null {
  if (toolCalls.length === 0) return null

  const timestamps = toolCalls.map((c) => Date.parse(c.created_at))
  const minT = Math.min(...timestamps)
  const maxT = Math.max(...timestamps)

  let aStart: number
  let bStart: number
  const bEnd = maxT

  if (baselineSince && currentSince) {
    aStart = Date.parse(baselineSince)
    bStart = Date.parse(currentSince)
  } else {
    // Midpoint split — no explicit boundaries given.
    aStart = minT
    bStart = Math.floor((minT + maxT) / 2)
  }

  if (!Number.isFinite(aStart) || !Number.isFinite(bStart) || bStart <= aStart) {
    return null
  }

  const windowA = toolCalls.filter((c) => {
    const t = Date.parse(c.created_at)
    return t >= aStart && t < bStart
  })
  const windowB = toolCalls.filter((c) => {
    const t = Date.parse(c.created_at)
    return t >= bStart && t <= bEnd
  })

  return { bounds: { aStart, bStart, bEnd }, windowA, windowB }
}

function buildAgentToolCounts(calls: ToolCallRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const call of calls) {
    if (!call.agent_name) continue
    const tools = out.get(call.agent_name) ?? new Map<string, number>()
    tools.set(call.tool_name, (tools.get(call.tool_name) ?? 0) + 1)
    out.set(call.agent_name, tools)
  }
  return out
}

/**
 * Convert a count map to a Laplace-smoothed probability vector over `vocab`.
 * Smoothing (add-1) prevents log(0) and treats missing tools as low-probability
 * rather than impossible.
 */
function toProbabilityVector(
  counts: Map<string, number>,
  vocab: string[],
): number[] {
  const smoothed = vocab.map((tool) => (counts.get(tool) ?? 0) + 1)
  const total = smoothed.reduce((s, x) => s + x, 0)
  return smoothed.map((x) => x / total)
}

/**
 * Kullback-Leibler divergence KL(P || Q). Both vectors must sum to 1 with
 * strictly positive entries (Laplace smoothing guarantees this).
 */
function kl(p: number[], q: number[]): number {
  let sum = 0
  for (let i = 0; i < p.length; i++) {
    sum += p[i]! * Math.log(p[i]! / q[i]!)
  }
  return sum
}

/**
 * Jensen-Shannon divergence — symmetric, bounded in [0, ln(2)].
 */
function jsd(p: number[], q: number[]): number {
  const m = p.map((pi, i) => 0.5 * (pi + q[i]!))
  return 0.5 * kl(p, m) + 0.5 * kl(q, m)
}

function topTools(counts: Map<string, number>, k: number): { tool: string; share: number }[] {
  const total = [...counts.values()].reduce((s, x) => s + x, 0)
  if (total === 0) return []
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([tool, count]) => ({ tool, share: count / total }))
}

export function computeBehavioralDrift(
  toolCalls: ToolCallRow[],
  windows?: { baselineSince?: string; currentSince?: string },
): BehavioralDriftReport {
  const distinctAgents = new Set(
    toolCalls.map((c) => c.agent_name).filter((n): n is string => !!n),
  )

  if (distinctAgents.size === 0) {
    return {
      score: 0,
      status: 'insufficient_data',
      note: 'Behavioral drift requires tool calls with non-null agent_name; none found.',
    }
  }

  const resolved = resolveWindows(toolCalls, windows?.baselineSince, windows?.currentSince)
  if (!resolved) {
    return {
      score: 0,
      status: 'insufficient_data',
      note:
        'Behavioral drift could not resolve baseline/current windows from the available data ' +
        '(either no tool calls or window boundaries collapse to a single point).',
    }
  }

  const { bounds, windowA, windowB } = resolved

  const countsA = buildAgentToolCounts(windowA)
  const countsB = buildAgentToolCounts(windowB)

  // Eligible agents: ≥ MIN_CALLS_PER_WINDOW in BOTH windows.
  const eligibleAgents: string[] = []
  for (const agent of distinctAgents) {
    const a = countsA.get(agent)
    const b = countsB.get(agent)
    if (!a || !b) continue
    const totalA = [...a.values()].reduce((s, x) => s + x, 0)
    const totalB = [...b.values()].reduce((s, x) => s + x, 0)
    if (totalA >= MIN_CALLS_PER_WINDOW && totalB >= MIN_CALLS_PER_WINDOW) {
      eligibleAgents.push(agent)
    }
  }

  const windowABounds: BehavioralWindow = {
    since: new Date(bounds.aStart).toISOString(),
    until: new Date(bounds.bStart).toISOString(),
    toolCallCount: windowA.length,
  }
  const windowBBounds: BehavioralWindow = {
    since: new Date(bounds.bStart).toISOString(),
    until: new Date(bounds.bEnd).toISOString(),
    toolCallCount: windowB.length,
  }

  if (eligibleAgents.length === 0) {
    return {
      score: 0,
      status: 'insufficient_data',
      note:
        `Behavioral drift requires ≥${MIN_CALLS_PER_WINDOW} tool calls per agent in both windows; ` +
        `no agents met that threshold (found ${distinctAgents.size} distinct agent(s)).`,
      windowA: windowABounds,
      windowB: windowBBounds,
    }
  }

  if (eligibleAgents.length > MAX_AGENTS) {
    eligibleAgents.length = MAX_AGENTS
  }

  // Union vocabulary across both windows.
  const vocabSet = new Set<string>()
  for (const counts of countsA.values()) for (const tool of counts.keys()) vocabSet.add(tool)
  for (const counts of countsB.values()) for (const tool of counts.keys()) vocabSet.add(tool)
  const vocab = [...vocabSet].sort()

  // Per-agent JSD between windowA and windowB distributions.
  const agentJsds: number[] = []
  const agentDistributions: AgentToolDistribution[] = []

  const lnTwo = Math.log(2)

  for (const agent of eligibleAgents) {
    const a = countsA.get(agent)!
    const b = countsB.get(agent)!
    const pA = toProbabilityVector(a, vocab)
    const pB = toProbabilityVector(b, vocab)
    const raw = jsd(pA, pB)
    agentJsds.push(raw / lnTwo) // normalise to [0, 1]

    const totalB = [...b.values()].reduce((s, x) => s + x, 0)
    agentDistributions.push({
      agent,
      callCount: totalB,
      topTools: topTools(b, 3),
    })
  }

  const meanJsd = agentJsds.reduce((s, x) => s + x, 0) / agentJsds.length
  const meanRawJsd = (meanJsd * lnTwo) // back-convert for the report

  let note: string
  if (meanJsd < 0.1) {
    note = 'Healthy: agents are using tools consistently between the two windows.'
  } else if (meanJsd < 0.3) {
    note = 'Warning: notable divergence between windows; review agent configurations.'
  } else {
    note = 'High drift: agents are using meaningfully different tool patterns now vs. baseline.'
  }

  return {
    score: meanJsd,
    status: 'ok',
    note,
    jsd: meanRawJsd,
    agentCount: eligibleAgents.length,
    agentDistributions,
    windowA: windowABounds,
    windowB: windowBBounds,
  }
}
