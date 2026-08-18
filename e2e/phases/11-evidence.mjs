// Phase 11 — EVIDENCE: how well-established a memory is, recorded and surfaced.
//
// Acceptance tests written BEFORE the implementation, so it cannot satisfy a
// weaker version of the requirement.
//
// THE PROBLEM. A memory carries three fields that circle "how much should I
// trust this" and none that answers it:
//
//   type       what the memory is about        (convention, lesson, …)
//   source     how it was captured             (manual, auto_index, agent)
//   confidence a float                         (0.8 — because a model guessed,
//                                               or because a test proved it?)
//
// An agent reading `confidence: 0.8` cannot tell whether to act on the claim or
// check it first. That distinction is the difference between a useful memory
// store and a confident-sounding one. Adapted from YAIML's evidence discipline
// (github.com/wirsingj/YAIML), which tags every claim by how it is known.
//
// The levels, and why each exists:
//
//   verified   checked against something executable — a test, a command, a file
//   declared   asserted by a human as policy or intent; true because decided
//   observed   seen happening once; empirical, may not generalise
//   inferred   concluded by reasoning without a direct check — a lead, not a fact
//   disputed   contradicted by evidence or by another memory
//   (absent)   unknown; never fabricated for rows written before this existed
//
// `evidence`, not `status`: MemoryStatus is already live/pending/archived.

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli, mcp, mcpText } from '../lib/cli.mjs'

export const id = '11-evidence'
export const title = '11 · EVIDENCE — how well-established a memory is, recorded and surfaced'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A

  // ---- 1. the level is recorded ------------------------------------------
  const verifiedKey = `${ctx.fixturePrefix}-ev-verified`
  const write = cli(bins.cliBin, A, [
    'remember',
    verifiedKey,
    'The staging smoke suite completes in under four minutes on CI.',
    '--type',
    'lesson',
    '--evidence',
    'verified',
  ])
  report.check('`remember --evidence verified` is accepted', write.code === 0, tail(write.out, 2))

  const landed = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, verifiedKey, 'id,evidence', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'evidence level reaches Supabase' },
  )
  report.check(
    'the evidence level is persisted server-side, not just locally',
    landed.ok && landed.value?.evidence === 'verified',
    landed.ok ? `evidence=${landed.value.evidence}` : pollDetail(landed),
  )
  if (landed.ok) state.leakedKeys.push(verifiedKey)

  // ---- 2. an invalid level is refused ------------------------------------
  const badKey = `${ctx.fixturePrefix}-ev-bogus`
  const bad = cli(bins.cliBin, A, ['remember', badKey, 'Should never be stored.', '--evidence', 'probably-true'])
  const badRows = await api.memoryByKey(project.id, badKey, 'id', { token: A.token })
  report.check(
    'an unrecognised evidence level is refused rather than stored as free text',
    badRows.length === 0 && bad.code !== 0,
    badRows.length === 0
      ? `rejected (exit ${bad.code}): ${tail(bad.out, 1)}`
      : 'a bogus level was persisted — the field is uninterpretable if anything can go in it',
  )
  if (badRows.length > 0) state.leakedKeys.push(badKey)

  // ---- 3. honest defaults -------------------------------------------------
  // A deliberate human `remember` is a declaration. It must NOT be recorded as
  // `verified`, which would manufacture confidence nobody established.
  const defaultKey = `${ctx.fixturePrefix}-ev-default`
  cli(bins.cliBin, A, ['remember', defaultKey, 'All API routes use snake_case.', '--type', 'convention'])
  const defaulted = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, defaultKey, 'id,evidence', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'default evidence level' },
  )
  report.check(
    'an unflagged human `remember` defaults to `declared`, never to `verified`',
    defaulted.ok && defaulted.value?.evidence === 'declared',
    defaulted.ok ? `evidence=${defaulted.value.evidence}` : pollDetail(defaulted),
  )
  if (defaulted.ok) state.leakedKeys.push(defaultKey)

  // An agent's own write is a conclusion, not a check.
  const agentKey = `${ctx.fixturePrefix}-ev-agent`
  await mcp(bins.serverBin, A, [
    {
      method: 'tools/call',
      params: {
        name: 'remember',
        arguments: { key: agentKey, value: 'The retry backoff appears to be exponential.', type: 'lesson' },
      },
    },
  ])
  const agentRow = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, agentKey, 'id,evidence', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'agent-written evidence level' },
  )
  report.check(
    'a memory an agent wrote itself defaults to `inferred`, not `declared`',
    agentRow.ok && agentRow.value?.evidence === 'inferred',
    agentRow.ok ? `evidence=${agentRow.value.evidence}` : pollDetail(agentRow),
  )
  if (agentRow.ok) state.leakedKeys.push(agentKey)

  // ---- 4. the reader can see it -------------------------------------------
  // Storing the level and hiding it at read time would be pointless: the whole
  // purpose is that whoever acts on the claim knows how it is known.
  const recall = cli(bins.cliBin, A, ['recall', 'staging smoke suite CI duration'])
  report.check(
    'CLI recall shows the evidence level alongside the memory',
    /verified/i.test(recall.out) && recall.out.includes('four minutes'),
    head(recall.out, 4),
  )

  const viaMcp = await mcp(bins.serverBin, A, [
    { method: 'tools/call', params: { name: 'recall', arguments: { query: 'staging smoke suite CI duration', limit: 5 } } },
  ])
  const mcpOut = viaMcp.ok ? mcpText(viaMcp.responses.at(-1)) : ''
  report.check(
    'MCP recall shows the evidence level to the agent',
    /verified/i.test(mcpOut) && mcpOut.includes('four minutes'),
    viaMcp.ok ? head(mcpOut, 3) : `${viaMcp.why} :: ${viaMcp.stderr.slice(0, 200)}`,
  )

  // ---- 5. weak evidence ranks below strong --------------------------------
  // Two memories answering the same question, one verified and one inferred.
  // The verified one must come first, or the level is decorative.
  const q = 'connection pool ceiling for the reporting database'
  const strongKey = `${ctx.fixturePrefix}-ev-strong`
  const weakKey = `${ctx.fixturePrefix}-ev-weak`
  cli(bins.cliBin, A, [
    'remember', strongKey,
    'The reporting database connection pool ceiling is 40, confirmed against the running config.',
    '--type', 'operational', '--evidence', 'verified',
  ])
  cli(bins.cliBin, A, [
    'remember', weakKey,
    'The reporting database connection pool ceiling is probably around 100 based on the driver default.',
    '--type', 'operational', '--evidence', 'inferred',
  ])
  for (const k of [strongKey, weakKey]) state.leakedKeys.push(k)

  await poll(
    async () => {
      const rows = await api.rest(
        `/memories?project_id=eq.${project.id}&key=in.(${encodeURIComponent(strongKey)},${encodeURIComponent(weakKey)})&select=key`,
        { as: { token: A.token } },
      )
      return Array.isArray(rows.body) && rows.body.length === 2
    },
    { timeoutMs: 45000, label: 'both ranking fixtures reach the cloud' },
  )

  // A wide limit on purpose. The assertion is about RELATIVE order, so both
  // rows must be inside the returned window — and at the default limit of 5 the
  // weighting demoted the inferred guess out of the results entirely, which is
  // correct behaviour but makes the ordering unjudgeable.
  const ranked = cli(bins.cliBin, A, ['recall', q, '--limit', '25'])
  const iStrong = ranked.out.indexOf(strongKey)
  const iWeak = ranked.out.indexOf(weakKey)
  report.check(
    'both competing memories are returned (control for the ordering assertion)',
    iStrong !== -1 && iWeak !== -1,
    `verified@${iStrong} inferred@${iWeak}`,
  )
  report.check(
    'a verified memory outranks an inferred one answering the same question',
    iStrong !== -1 && iWeak !== -1 && iStrong < iWeak,
    iStrong !== -1 && iWeak !== -1
      ? iStrong < iWeak
        ? 'verified ranked first'
        : 'the inferred guess outranked the verified fact — an agent acts on the guess'
      : 'one of the two was not returned, so ordering could not be judged',
  )

  // ---- 6. disputed is loud ------------------------------------------------
  const disputedKey = `${ctx.fixturePrefix}-ev-disputed`
  cli(bins.cliBin, A, [
    'remember', disputedKey,
    'Deploys must be run from the release branch only, contradicted by the current CI config.',
    '--type', 'operational', '--evidence', 'disputed',
  ])
  state.leakedKeys.push(disputedKey)
  await poll(
    async () => (await api.memoryByKey(project.id, disputedKey, 'id', { token: A.token })).length === 1,
    { timeoutMs: 45000, label: 'disputed memory reaches the cloud' },
  )
  const disputedOut = cli(bins.cliBin, A, ['recall', 'which branch may deploys be run from'])
  report.check(
    'a disputed memory is marked as disputed when returned, not served as a plain fact',
    !disputedOut.out.includes(disputedKey) || /disputed/i.test(disputedOut.out),
    disputedOut.out.includes(disputedKey)
      ? /disputed/i.test(disputedOut.out)
        ? 'returned and flagged'
        : 'returned with no indication it is contradicted — the reader acts on a known-bad claim'
      : 'not returned for this query',
  )

  // ---- 7. existing rows are not backfilled with a guess -------------------
  // Every memory written before this feature has unknown provenance. Stamping
  // them `declared` would be inventing evidence, which is the exact failure the
  // feature exists to prevent.
  const legacy = await api.insert(
    'memories',
    {
      project_id: project.id,
      key: `${ctx.fixturePrefix}-ev-legacy`,
      value: 'Written directly, with no evidence level, exactly as a pre-existing row would be.',
      type: 'lesson',
      source: 'manual',
      status: 'live',
      confidence: 1,
    },
    { as: { token: A.token } },
  )
  state.leakedKeys.push(`${ctx.fixturePrefix}-ev-legacy`)
  const legacyEvidence = legacy.body?.[0]?.evidence ?? null
  report.check(
    'a row written without an evidence level stays null rather than being assigned one',
    legacyEvidence === null,
    legacyEvidence === null
      ? 'null, correctly meaning "unknown"'
      : `backfilled to "${legacyEvidence}" — evidence was invented for a claim nobody assessed`,
  )
}
