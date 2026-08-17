// Phase 02 — RETRIEVE: a stored memory comes back when it is needed.
//
// The load-bearing check is the paraphrase. A query that shares words with the
// stored value proves only that trigram matching works — which it does even
// with every embedding NULL. A query that shares *meaning* and no distinctive
// words is the only assertion that can tell a working semantic stack from a
// word-overlap toy. This repo has shipped a state where all 45 production
// memories had no embedding at all and nothing failed.

import { head } from '../lib/harness.mjs'
import { cli, mcp, mcpText } from '../lib/cli.mjs'

export const id = '02-retrieve'
export const title = '02 · RETRIEVE — stored memories come back to the person who needs them'

export async function run(ctx) {
  const { report, bins, ids, state } = ctx
  const A = ids.A

  // ---- literal recall ----------------------------------------------------
  const literal = cli(bins.cliBin, A, ['recall', 'stale migration lock deploy gate'])
  report.check('`tages recall` exits 0', literal.code === 0, head(literal.out, 2))
  report.check(
    'recall returns the memory for a query sharing its wording',
    literal.out.includes(state.keyA) || literal.out.includes('migration lock'),
    head(literal.out, 4),
  )
  report.check(
    'recall returns the readable value, not just a key or an id',
    literal.out.includes('supabase migration list'),
    literal.out.includes('supabase migration list') ? 'value text present' : head(literal.out, 4),
  )

  // ---- semantic recall ---------------------------------------------------
  // No token in this query appears in the stored value: "release", "blocked",
  // "database", "schema", "lock left over". Only an embedding can bridge it.
  const paraphrase = 'why is the release blocked by a leftover database schema lock'
  const semantic = cli(bins.cliBin, A, ['recall', paraphrase])
  const semanticHit = semantic.out.includes(state.keyA) || semantic.out.includes('migration list')
  report.check(
    'recall answers a paraphrase that shares no distinctive words (semantic channel is live)',
    semanticHit,
    semanticHit
      ? `matched on meaning: "${paraphrase}"`
      : `MISS on "${paraphrase}" — retrieval is literal-overlap only; teammates who phrase things differently will find nothing. ${head(semantic.out, 3)}`,
  )

  // ---- precision guard ---------------------------------------------------
  // If recall answers everything, it answers nothing. Without this, every
  // positive recall assertion above could be satisfied by a stack that returns
  // the whole project on any input.
  const nonsense = cli(bins.cliBin, A, ['recall', 'zx9q kelptorium fnargle vantablack quorndish'])
  const returnedOurs = nonsense.out.includes(state.keyA) || nonsense.out.includes(state.keyAgent)
  report.check(
    'recall does NOT return unrelated memories for a nonsense query',
    !returnedOurs,
    returnedOurs
      ? 'nonsense query returned a fixture memory — recall has no precision floor, so every positive result above is uninformative'
      : head(nonsense.out, 2) || 'no results',
  )

  // ---- the agent's path --------------------------------------------------
  const viaMcp = await mcp(bins.serverBin, A, [
    { method: 'tools/call', params: { name: 'recall', arguments: { query: 'stale migration lock deploy gate', limit: 5 } } },
  ])
  const mcpOut = viaMcp.ok ? mcpText(viaMcp.responses.at(-1)) : ''
  report.check(
    'MCP server boots and answers a recall tool call',
    viaMcp.ok,
    viaMcp.ok ? `boot ${viaMcp.bootMs}ms` : `${viaMcp.why} :: ${viaMcp.stderr.slice(0, 200)}`,
  )
  report.check(
    'the agent receives the memory through MCP, not just the CLI',
    mcpOut.includes(state.keyA) || mcpOut.includes('migration lock'),
    head(mcpOut, 3) || 'no content returned',
  )
  report.check(
    'the agent also receives the memory the agent itself wrote',
    mcpOut.includes(state.keyAgent) || (await agentMemoryRecallable(ctx)),
    'checked via MCP recall, then via a targeted CLI recall',
  )
}

/** Second look for the agent-written memory using its own distinctive wording. */
async function agentMemoryRecallable(ctx) {
  const r = cli(ctx.bins.cliBin, ctx.ids.A, ['recall', 'health checks mark a node unhealthy after consecutive misses'])
  return r.out.includes(ctx.state.keyAgent) || r.out.includes('three consecutive misses')
}
