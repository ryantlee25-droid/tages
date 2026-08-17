// Phase 05 — SHARE: two people work out of one memory, in both directions.
//
// This is the product. Everything before it is setup. The specific claims:
//
//   - B sees what A wrote, including A's *correction*, not the original —
//     a shared store that propagates creates but not edits is a store that
//     quietly serves retracted facts to everyone except their author;
//   - B writes and A sees it;
//   - A edits B's memory and B sees A's edit — the memory belongs to the
//     project, not to whoever typed it first;
//   - provenance survives the round trip, so a reader can tell whose claim
//     they are acting on.

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli, mcp, mcpText } from '../lib/cli.mjs'

export const id = '05-share'
export const title = '05 · SHARE — both people read and write one shared memory'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B

  if (!state.joined) {
    report.check('teammate joined before sharing is exercised', false, 'phase 04 did not complete — sharing cannot be tested')
    return
  }

  // ---- B reads A's memory ------------------------------------------------
  const bRecall = cli(bins.cliBin, B, ['recall', 'stale migration lock deploy gate'])
  report.check(
    "teammate recalls the owner's memory",
    bRecall.out.includes(state.keyA) || bRecall.out.includes('migration lock'),
    head(bRecall.out, 4),
  )
  report.check(
    "teammate sees the owner's CORRECTION, not the superseded original",
    bRecall.out.includes(state.markerNew) && !bRecall.out.includes(state.markerOld),
    bRecall.out.includes(state.markerOld)
      ? `teammate is being served the retracted text ("${state.markerOld}") — edits do not propagate across users`
      : bRecall.out.includes(state.markerNew)
        ? 'corrected text served'
        : 'neither version returned',
  )

  const bViaMcp = await mcp(bins.serverBin, B, [
    { method: 'tools/call', params: { name: 'recall', arguments: { query: 'stale migration lock deploy gate', limit: 5 } } },
  ])
  const bMcpText = bViaMcp.ok ? mcpText(bViaMcp.responses.at(-1)) : ''
  report.check(
    "teammate's AGENT receives the owner's memory over MCP",
    bMcpText.includes(state.keyA) || bMcpText.includes('migration lock'),
    bViaMcp.ok ? head(bMcpText, 3) : `${bViaMcp.why} :: ${bViaMcp.stderr.slice(0, 200)}`,
  )

  // ---- B writes back -----------------------------------------------------
  state.keyB = `${ctx.fixturePrefix}-teammate`
  state.valueB = 'Pod controller listens on port 3463 and needs a restart after certificate rotation.'

  const bWrite = cli(bins.cliBin, B, ['remember', state.keyB, state.valueB, '--type', 'lesson'])
  report.check('teammate (admin) `remember` exits 0', bWrite.code === 0, tail(bWrite.out, 2))
  report.check(
    "teammate's write reports a durable cloud write (admin role really grants write)",
    /stored/i.test(bWrite.out) && !/local(ly)? only/i.test(bWrite.out),
    tail(bWrite.out, 1),
  )

  const bLanded = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, state.keyB, 'id,status,value', { token: B.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: "teammate's memory reaches Supabase" },
  )
  report.check("teammate's memory reaches Supabase with status=live", bLanded.ok && bLanded.value?.status === 'live', pollDetail(bLanded))
  state.memoryIdB = bLanded.value?.id ?? null

  const aRecallB = cli(bins.cliBin, A, ['recall', 'pod controller port certificate rotation'])
  report.check(
    "owner recalls the teammate's memory (the loop closes both ways)",
    aRecallB.out.includes(state.keyB) || aRecallB.out.includes('3463'),
    head(aRecallB.out, 4),
  )

  // ---- A edits B's memory ------------------------------------------------
  // Shared memory means the project owns the fact. If A's correction to B's
  // entry forks into a second row, or never reaches B, the team is running on
  // two private stores that happen to share a name.
  state.valueBUpdated =
    'Pod controller listens on port 3463; since firmware 16.1.3 it reloads certificates in place and no longer needs a restart.'
  state.markerBNew = 'reloads certificates in place'
  state.markerBOld = 'needs a restart after certificate rotation'

  const aEdit = cli(bins.cliBin, A, ['remember', state.keyB, state.valueBUpdated, '--type', 'lesson'])
  report.check("owner can correct the teammate's memory", aEdit.code === 0, tail(aEdit.out, 2))

  const edited = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, state.keyB, 'id,value', { token: A.token })
      const hit = rows.find(r => r.value === state.valueBUpdated)
      return hit ? { rows, hit } : null
    },
    { timeoutMs: 45000, label: "owner's edit to the teammate's memory" },
  )
  report.check("owner's edit reaches Supabase", edited.ok, pollDetail(edited))
  report.check(
    "the edit updates the teammate's row rather than forking a second one",
    edited.value?.rows?.length === 1 && edited.value?.hit?.id === state.memoryIdB,
    edited.ok
      ? `${edited.value.rows.length} row(s), id ${edited.value.hit.id === state.memoryIdB ? 'preserved' : 'CHANGED'}`
      : 'edit never landed',
  )

  const bSeesEdit = cli(bins.cliBin, B, ['recall', 'pod controller port certificate rotation'])
  report.check(
    "teammate sees the owner's edit to the teammate's own memory",
    bSeesEdit.out.includes(state.markerBNew) && !bSeesEdit.out.includes(state.markerBOld),
    bSeesEdit.out.includes(state.markerBOld)
      ? 'teammate still reads their own stale text — the two users are not sharing one record'
      : head(bSeesEdit.out, 3),
  )

  // ---- provenance --------------------------------------------------------
  // A shared claim is only actionable if a reader can tell whose claim it is.
  // Authorship lives in two columns (migration 0048): created_by survives the
  // edit, updated_by moves to whoever last touched it.
  const provenance = await api.rest(
    `/memories?id=eq.${state.memoryIdB}&select=created_by,updated_by`,
    { as: { token: B.token } },
  )
  const p = provenance.body?.[0]
  report.check(
    'the memory still records the teammate as its original author after the owner edits it',
    p?.created_by === B.userId,
    p?.created_by === B.userId ? 'created_by = teammate' : `created_by = ${p?.created_by ?? 'null'}`,
  )
  report.check(
    'the memory records the owner as its most recent editor',
    p?.updated_by === A.userId,
    p?.updated_by === A.userId ? 'updated_by = owner' : `updated_by = ${p?.updated_by ?? 'null'}`,
  )

  // get_memory_authors(uuid[]) deliberately returns a display name and never a
  // raw email. "Unknown" means the authorship column was never populated, so
  // the team cannot attribute the claim at all.
  const authors = await api.rpc('get_memory_authors', { memory_ids: [state.memoryIdB] }, { as: { token: B.token } })
  const displayName = Array.isArray(authors.body) ? authors.body[0]?.display_name : null
  report.check(
    'the authorship RPC resolves a real display name for the shared memory',
    !!displayName && displayName !== 'Unknown',
    displayName
      ? `display_name = "${displayName}"`
      : `RPC returned HTTP ${authors.status}: ${JSON.stringify(authors.body).slice(0, 160)}`,
  )
  report.check(
    'the authorship RPC does not leak a raw email address',
    !displayName || !displayName.includes('@'),
    displayName?.includes('@') ? `leaked "${displayName}"` : 'no email in the display name',
  )

  const versionsB = await api.rest(
    `/memory_versions?memory_id=eq.${state.memoryIdB}&select=version,value,changed_by&order=version.desc`,
    { as: { token: B.token } },
  )
  const vRows = Array.isArray(versionsB.body) ? versionsB.body : []
  report.check(
    "the teammate's original wording is retained as a version after the owner's edit",
    vRows.some(v => v.value === state.valueB),
    vRows.length ? `${vRows.length} version(s) retained` : 'no version snapshot — the teammate cannot see or restore what they originally wrote',
  )
}
