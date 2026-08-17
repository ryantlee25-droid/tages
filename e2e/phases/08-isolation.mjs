// Phase 08 — ISOLATION: someone outside the project sees nothing, and an admin
// cannot promote themselves.
//
// Tenant isolation is the one property that must be checked on every data path
// rather than sampled, because each recall RPC carries its own copy of the
// guard and a single omission leaks the whole project. Migration 0066 added the
// guard to four functions; this phase asserts all four, not the two an earlier
// harness happened to cover.
//
// Every call here runs as a real user JWT over the anon key. A service_role
// call would bypass RLS and turn each of these into a vacuous pass — which is
// why the fixture environment strips TAGES_SERVICE_KEY from every child
// process.

import { tail } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'

// The four recall paths, each of which carries its own copy of the 0066 guard.
// They do not share a signature: two take a text query, two take a pgvector.
// Calling the vector ones with `p_query` returns PGRST202 (404) — which is NOT
// a pass, because the guard is never reached. The `arg` builder below gives
// each its real parameters.
const RECALL_RPCS = [
  { name: 'recall_memories', kind: 'text' },
  { name: 'hybrid_recall', kind: 'text' },
  { name: 'semantic_recall', kind: 'vector' },
  { name: 'chunk_semantic_recall', kind: 'vector' },
]

export const id = '08-isolation'
export const title = '08 · ISOLATION — outsiders see nothing, admins cannot escalate'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B
  const C = ids.C

  // ---- outsider cannot join ----------------------------------------------
  const link = cli(bins.cliBin, C, ['link', '--project-id', project.id])
  report.check(
    'an authenticated non-member is refused the join',
    link.code !== 0,
    link.code !== 0 ? tail(link.out, 2) : 'JOIN SUCCEEDED — anyone with a project id can add themselves to the project',
  )

  // ---- outsider cannot read ----------------------------------------------
  const direct = await api.rest(`/memories?project_id=eq.${project.id}&select=id,key`, { as: { token: C.token } })
  const directRows = Array.isArray(direct.body) ? direct.body : []
  report.check(
    'an outsider reads zero rows from the memories table (RLS)',
    directRows.length === 0,
    directRows.length === 0 ? `HTTP ${direct.status}, 0 rows` : `LEAK: ${directRows.length} rows visible to a non-member`,
  )

  // A control: the same query as the owner must return rows. Without it, a
  // broken query or a wrong project id would make every isolation check above
  // pass while proving nothing.
  const ownerRows = await api.rest(`/memories?project_id=eq.${project.id}&select=id,key`, { as: { token: A.token } })
  report.check(
    'control — the same query as the owner DOES return rows',
    Array.isArray(ownerRows.body) && ownerRows.body.length > 0,
    Array.isArray(ownerRows.body)
      ? `${ownerRows.body.length} rows for the owner`
      : `owner query failed (HTTP ${ownerRows.status}) — the isolation results above are uninterpretable`,
  )

  // ---- outsider gets nothing from any recall path -------------------------
  // The vector paths are queried with the fixture memory's OWN stored embedding,
  // so cosine similarity is 1.0 and the row clears any default threshold. An
  // arbitrary probe vector could fall below the threshold and return zero rows
  // for the owner too, which would make the outsider's zero rows meaningless.
  const embRow = await api.rest(`/memories?id=eq.${state.memoryIdA}&select=embedding`, { as: { token: A.token } })
  const embedding = embRow.body?.[0]?.embedding ?? null
  const argsFor = kind =>
    kind === 'text'
      ? { p_project_id: project.id, p_query: 'migration lock deploy gate', p_limit: 10 }
      : { p_project_id: project.id, p_embedding: embedding, p_limit: 10, p_threshold: 0 }

  for (const { name, kind } of RECALL_RPCS) {
    if (kind === 'vector' && !embedding) {
      report.skip(`outsider gets zero rows from ${name}`, 'the fixture memory has no embedding, so this vector path cannot be probed')
      continue
    }

    // Control first: the owner must get rows, or the outsider's zero rows prove
    // nothing about the guard and everything about a malformed call.
    const asOwner = await api.rpc(name, argsFor(kind), { as: { token: A.token } })
    const ownerCount = Array.isArray(asOwner.body) ? asOwner.body.length : null
    if (ownerCount === null || ownerCount === 0) {
      report.check(
        `control — ${name} returns rows for the owner`,
        false,
        ownerCount === null
          ? `HTTP ${asOwner.status}: ${JSON.stringify(asOwner.body).slice(0, 180)} — the isolation result below is uninterpretable`
          : '0 rows for the owner — the isolation result below would pass vacuously',
      )
    }

    const asOutsider = await api.rpc(name, argsFor(kind), { as: { token: C.token } })
    const rows = Array.isArray(asOutsider.body) ? asOutsider.body : null
    report.check(
      `outsider gets zero rows from ${name} (owner sees ${ownerCount ?? '?'})`,
      rows !== null && rows.length === 0 && ownerCount > 0,
      rows === null
        ? `RPC did not return a row set (HTTP ${asOutsider.status}) — this path was NOT verified: ${JSON.stringify(asOutsider.body).slice(0, 160)}`
        : rows.length > 0
          ? `LEAK: ${rows.length} rows returned to a non-member`
          : ownerCount > 0
            ? '0 rows for the outsider, rows for the owner'
            : 'outsider got 0 rows, but so did the owner — not evidence of a guard',
    )
  }

  // ---- outsider cannot claim somebody else's invite -----------------------
  // The 0065 privilege escalation: the old two-argument signature let a caller
  // accept an invite addressed to another email.
  const legacy = await api.rpc(
    'accept_pending_invites',
    { p_email: B.email, p_project_id: project.id },
    { as: { token: C.token } },
  )
  report.check(
    'the removed two-argument invite RPC signature is gone',
    legacy.status >= 400,
    legacy.status >= 400
      ? `HTTP ${legacy.status} as expected`
      : `the legacy signature still resolves (HTTP ${legacy.status}) — an authenticated stranger can claim a teammate's invite`,
  )

  const stealAttempt = await api.rpc('accept_pending_invites', {}, { as: { token: C.token } })
  report.check(
    'an outsider calling the invite RPC claims nothing',
    stealAttempt.body === 0 || stealAttempt.body === '0',
    `returned ${JSON.stringify(stealAttempt.body)}`,
  )

  const stillOutside = await api.rest(
    `/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(C.email)}&select=status`,
  )
  report.check(
    'the outsider is still not a member afterwards',
    !Array.isArray(stillOutside.body) || stillOutside.body.length === 0,
    Array.isArray(stillOutside.body) ? `${stillOutside.body.length} membership row(s)` : 'none',
  )

  // ---- a revoked member loses access --------------------------------------
  // Deliberately before the escalation checks below, not after. Revoking frees
  // the member's seat, so the owner-invite attempt that follows can only be
  // refused by the role guard — with a seat still occupied, the seat-limit
  // trigger would refuse it first and that check would pass for the wrong
  // reason while proving nothing about privilege escalation.
  if (state.memberJoined) {
    await api.rest(`/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(ids.D.email)}`, {
      method: 'PATCH',
      body: { status: 'revoked' },
    })
    const revokedRead = await api.rpc(
      'recall_memories',
      { p_project_id: project.id, p_query: 'migration lock', p_limit: 10 },
      { as: { token: ids.D.token } },
    )
    const revokedRows = Array.isArray(revokedRead.body) ? revokedRead.body : null
    report.check(
      'a revoked member immediately loses read access',
      revokedRows !== null && revokedRows.length === 0,
      revokedRows === null
        ? `RPC error (HTTP ${revokedRead.status}) — revocation was not verified`
        : revokedRows.length === 0
          ? '0 rows after revocation'
          : `LEAK: ${revokedRows.length} rows still readable by a revoked member`,
    )
  } else {
    report.skip('a revoked member immediately loses read access', 'phase 06 did not seat a member to revoke')
  }

  // ---- an admin cannot promote themselves ---------------------------------
  // Migration 0067. An admin who can mint an owner can lock the real owner out
  // of their own project.
  const selfPromote = await api.rest(
    `/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(B.email)}`,
    { method: 'PATCH', body: { role: 'owner' }, headers: { Prefer: 'return=representation' }, as: { token: B.token } },
  )
  const promoted = await api.rest(
    `/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(B.email)}&select=role`,
  )
  const roleNow = promoted.body?.[0]?.role
  report.check(
    'an admin cannot promote themselves to owner',
    roleNow === 'admin',
    roleNow === 'admin'
      ? `role still admin (PATCH returned HTTP ${selfPromote.status})`
      : `PRIVILEGE ESCALATION: role is now "${roleNow}"`,
  )

  const escalateEmail = `${ctx.fixturePrefix}-escalate@example.test`
  const inviteOwner = await api.insert(
    'team_members',
    { project_id: project.id, email: escalateEmail, role: 'owner', status: 'pending' },
    { as: { token: B.token } },
  )
  const reason = JSON.stringify(inviteOwner.body ?? '').slice(0, 240)
  if (inviteOwner.status < 400) {
    state.extraInvites.push(escalateEmail)
    report.check('an admin cannot invite a new owner', false, `an admin minted an owner invite (HTTP ${inviteOwner.status})`)
  } else if (/seat limit/i.test(reason)) {
    // The seat-limit trigger fired first, so the role guard was never reached.
    // Reporting this as a pass would be the exact failure mode phase 99 exists
    // to catch: a green check that tested nothing.
    report.skip(
      'an admin cannot invite a new owner',
      `refused by the seat-limit trigger, not the role guard — migration 0067 was NOT exercised (${reason})`,
    )
  } else {
    report.check(
      'an admin cannot invite a new owner (refused by the role guard, not by a seat limit)',
      /owner|role|permission|denied|42501/i.test(reason),
      `HTTP ${inviteOwner.status}: ${reason}`,
    )
  }
}
