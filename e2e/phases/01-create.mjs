// Phase 01 — CREATE: a memory written by a human or an agent becomes durable
// server-side state, not a line of green text.
//
// Every assertion here reads Supabase back as the writing user (anon key + that
// user's JWT, never service_role) because service_role bypasses RLS and would
// confirm a row exists that the user themselves cannot see.

import { poll, pollDetail, tail } from '../lib/harness.mjs'
import { cli, mcp, mcpText } from '../lib/cli.mjs'

export const id = '01-create'
export const title = '01 · CREATE — memories are written and durably stored'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A

  // ---- owner binds the project ------------------------------------------
  const link = cli(bins.cliBin, A, ['link', '--project-id', project.id])
  report.check('owner links their work repo to the project', link.code === 0, tail(link.out, 3))

  const status = cli(bins.cliBin, A, ['status'])
  report.check('`tages status` shows the project slug', status.out.includes(project.slug), tail(status.out, 4))
  report.check(
    '`tages status` prints the project ID (teammates cannot be invited without it)',
    status.out.includes(project.id),
    status.out.includes(project.id) ? `found ${project.id}` : 'project ID absent from status output',
  )

  // ---- CLI write --------------------------------------------------------
  state.keyA = `${ctx.fixturePrefix}-owner-cli`
  state.valueA =
    'The staging deploy gate blocks on a stale migration lock; run supabase migration list --linked before retrying.'

  const remember = cli(bins.cliBin, A, ['remember', state.keyA, state.valueA, '--type', 'lesson'])
  report.check('`tages remember` exits 0', remember.code === 0, tail(remember.out, 2))
  report.check(
    '`tages remember` reports a durable cloud write, not "stored locally only"',
    /stored/i.test(remember.out) && !/local(ly)? only/i.test(remember.out),
    tail(remember.out, 1),
  )

  // The CLI writes SQLite first and flushes asynchronously. Poll rather than
  // sleep: the timeout is the assertion, so a sync that never completes fails
  // loudly instead of being absorbed by a generous fixed wait.
  const landed = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, state.keyA, 'id,value,status,embedding', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'owner memory reaches Supabase' },
  )
  report.check('memory reaches Supabase, readable by its author under RLS', landed.ok, pollDetail(landed))

  const row = landed.value
  state.memoryIdA = row?.id ?? null
  report.check(
    'memory has status=live (a "pending" row is invisible to every recall path)',
    row?.status === 'live',
    `status=${row?.status ?? 'no row'}`,
  )
  report.check(
    'memory carries an embedding (without one, recall degrades to literal word overlap)',
    row?.embedding != null,
    row?.embedding == null
      ? 'embedding is NULL — semantic recall is inert for this memory; paraphrased queries will miss'
      : 'embedding present',
  )
  report.check(
    'stored value matches what was written, byte for byte',
    row?.value === state.valueA,
    row?.value === state.valueA ? 'exact match' : `stored: ${String(row?.value).slice(0, 120)}`,
  )

  // Chunk rows back chunk-aware recall (migrations 0063/0064). Absent chunks
  // silently disable one of the three retrieval channels.
  const chunks = await poll(
    async () => {
      const r = await api.rest(`/memory_chunks?memory_id=eq.${state.memoryIdA}&select=id`, { as: { token: A.token } })
      return Array.isArray(r.body) && r.body.length > 0 ? r.body : null
    },
    { timeoutMs: 30000, label: 'chunk rows' },
  )
  report.check(
    'per-chunk rows were persisted (chunk-aware recall channel is fed)',
    chunks.ok,
    chunks.ok ? `${chunks.value.length} chunk(s), ${pollDetail(chunks)}` : pollDetail(chunks),
  )

  // ---- agent write, through MCP ------------------------------------------
  // The CLI is what a human types; MCP is what the agent calls. They are
  // different code paths (the server defers embedding generation where the CLI
  // awaits it), so exercising only one leaves the other unproven.
  state.keyAgent = `${ctx.fixturePrefix}-owner-agent`
  state.valueAgent =
    'Pod controller health checks run every 30 seconds and mark a node unhealthy after three consecutive misses.'

  const agentWrite = await mcp(bins.serverBin, A, [
    {
      method: 'tools/call',
      params: { name: 'remember', arguments: { key: state.keyAgent, value: state.valueAgent, type: 'lesson' } },
    },
  ])
  report.check(
    'MCP server accepts a `remember` tool call from an agent',
    agentWrite.ok && !agentWrite.responses.at(-1)?.error,
    agentWrite.ok
      ? `booted in ${agentWrite.bootMs}ms; ${mcpText(agentWrite.responses.at(-1)).slice(0, 160)}`
      : `${agentWrite.why} :: ${agentWrite.stderr.slice(0, 200)}`,
  )

  const agentLanded = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, state.keyAgent, 'id,status', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'agent-written memory reaches Supabase' },
  )
  report.check(
    'agent-written memory reaches Supabase with status=live',
    agentLanded.ok && agentLanded.value?.status === 'live',
    agentLanded.ok ? `status=${agentLanded.value.status}, ${pollDetail(agentLanded)}` : pollDetail(agentLanded),
  )
  state.memoryIdAgent = agentLanded.value?.id ?? null

  // ---- safety gate --------------------------------------------------------
  // AKIAIOSFODNN7EXAMPLE is AWS's own published example key, not a live
  // credential. A team memory store that persists secrets is a liability the
  // moment more than one person can read it — and the moment it is read back
  // into an agent's context.
  //
  // Both write paths are probed separately because they do not share this
  // code. The MCP server scans and blocks (tools/remember.ts:65, gated on
  // `force`). The CLI does not import the safety module at all. Asserting only
  // one of them would report a protection the other half does not have.
  const secretValue = 'Deploy uses AKIAIOSFODNN7EXAMPLE for the artifact bucket.'

  const cliSecretKey = `${ctx.fixturePrefix}-secret-probe-cli`
  const cliSecret = cli(bins.cliBin, A, ['remember', cliSecretKey, secretValue, '--type', 'lesson'])
  const cliRows = await api.memoryByKey(project.id, cliSecretKey, 'id', { token: A.token })
  report.check(
    'CLI: a value containing a high-severity secret is refused, not stored',
    cliRows.length === 0,
    cliRows.length === 0
      ? `blocked (exit ${cliSecret.code}): ${tail(cliSecret.out, 1)}`
      : 'SECRET PERSISTED via the CLI — packages/cli/src/commands/remember.ts never calls scanForSensitiveData, ' +
        'so every project member can now read it and every agent recalls it into context',
  )
  if (cliRows.length > 0) state.leakedKeys.push(cliSecretKey)

  const mcpSecretKey = `${ctx.fixturePrefix}-secret-probe-mcp`
  const mcpSecret = await mcp(bins.serverBin, A, [
    {
      method: 'tools/call',
      params: { name: 'remember', arguments: { key: mcpSecretKey, value: secretValue, type: 'lesson' } },
    },
  ])
  const mcpRows = await api.memoryByKey(project.id, mcpSecretKey, 'id', { token: A.token })
  report.check(
    'MCP: a value containing a high-severity secret is refused, not stored',
    mcpRows.length === 0,
    mcpRows.length === 0
      ? `blocked: ${mcpText(mcpSecret.responses.at(-1) ?? {}).slice(0, 140)}`
      : 'SECRET PERSISTED via MCP — the server-side safety gate did not fire',
  )
  if (mcpRows.length > 0) state.leakedKeys.push(mcpSecretKey)
}
