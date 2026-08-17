// Phase 06 — ROLES + SEATS: read-only members and plan limits behave the way a
// person would predict from the UI that granted them.
//
// The documented behaviour is that a Member's writes "fail silently". If that
// is still true, it is the single worst failure mode for a team rollout: the
// engineer types `tages remember`, sees green, and their knowledge is never
// shared with anyone. They will not report a bug, because from where they sit
// nothing went wrong.
//
// So this phase does not merely assert that the write is rejected. It asserts
// that the person is *told*.

import { poll, pollDetail, tail, head } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'

export const id = '06-roles'
export const title = '06 · ROLES + SEATS — read-only members are told they are read-only'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const D = ids.D

  // ---- invite as member --------------------------------------------------
  const invite = await api.insert(
    'team_members',
    { project_id: project.id, email: D.email, role: 'member', status: 'pending' },
    { as: { token: A.token } },
  )
  report.check('owner can invite a read-only member', invite.status < 300, `HTTP ${invite.status}`)

  const accept = await api.rpc('accept_pending_invites', {}, { as: { token: D.token } })
  report.check('member accepts their invite', accept.body === 1 || accept.body === '1', `returned ${JSON.stringify(accept.body)}`)

  const link = cli(bins.cliBin, D, ['link', '--project-id', project.id])
  report.check('member can join the project', link.code === 0, tail(link.out, 3))

  // ---- read works --------------------------------------------------------
  const read = cli(bins.cliBin, D, ['recall', 'stale migration lock deploy gate'])
  report.check(
    'member can read the team\'s memories',
    read.out.includes(state.keyA) || read.out.includes('migration lock'),
    head(read.out, 3),
  )

  // ---- authorization is what the server says ------------------------------
  // is_write_authorized(uid, pid) — migration 0031. The role check the write
  // policies themselves consult, so this is the server's own answer rather
  // than an inference from CLI output.
  const authz = await api.rpc('is_write_authorized', { uid: D.userId, pid: project.id }, { as: { token: D.token } })
  report.check(
    'server reports the member is NOT write-authorized',
    authz.status < 300 && authz.body === false,
    `is_write_authorized returned ${JSON.stringify(authz.body)} (HTTP ${authz.status})`,
  )

  const ownerAuthz = await api.rpc('is_write_authorized', { uid: A.userId, pid: project.id }, { as: { token: A.token } })
  report.check(
    'control — the owner IS write-authorized (the check is not blanket-false)',
    ownerAuthz.body === true,
    `is_write_authorized returned ${JSON.stringify(ownerAuthz.body)}`,
  )

  // ---- the write itself --------------------------------------------------
  const deniedKey = `${ctx.fixturePrefix}-member-write`
  const write = cli(bins.cliBin, D, ['remember', deniedKey, 'A read-only member should not be able to publish this.', '--type', 'lesson'])

  // Give any async flush a fair chance to land before concluding it did not.
  const appeared = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, deniedKey, 'id', { token: A.token })
      return rows.length > 0 ? rows : null
    },
    { timeoutMs: 12000, intervalMs: 1500, label: "member's write reaching the cloud" },
  )

  report.check(
    "a read-only member's write does not reach shared storage",
    !appeared.ok,
    appeared.ok ? 'the row IS in Supabase — the member role does not actually restrict writes' : pollDetail(appeared),
  )
  if (appeared.ok) state.leakedKeys.push(deniedKey)

  const warned = write.code !== 0 || /denied|not authorized|read[- ]only|local(ly)? only|fail/i.test(write.out)
  report.check(
    'the member is TOLD their write did not go to the team',
    warned,
    warned
      ? `exit ${write.code}: ${tail(write.out, 1)}`
      : `SILENT DATA LOSS: exit 0 and output "${tail(write.out, 1)}" while nothing reached the cloud. ` +
        'This engineer believes they shared knowledge with the team and did not.',
  )

  // ---- seat limit --------------------------------------------------------
  // Free tier is owner plus two, and both seat triggers count rows with
  // status='active'. So a pending invite for a third teammate is NOT supposed
  // to be refused — enforcement happens when they accept
  // (check_seat_limit_on_update, migration 0051). Asserting on the invite
  // would have been a test of the wrong transition.
  const E = ids.E
  const overflow = await api.insert(
    'team_members',
    { project_id: project.id, email: E.email, role: 'member', status: 'pending' },
    { as: { token: A.token } },
  )
  report.check(
    'a third teammate can still be INVITED (seats are counted on acceptance, not invitation)',
    overflow.status < 300,
    `HTTP ${overflow.status}`,
  )

  const overflowAccept = await api.rpc('accept_pending_invites', {}, { as: { token: E.token } })
  const seated = await api.rest(
    `/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(E.email)}&select=status`,
  )
  const becameActive = seated.body?.[0]?.status === 'active'
  const acceptMsg =
    typeof overflowAccept.body === 'object' ? JSON.stringify(overflowAccept.body).slice(0, 220) : String(overflowAccept.body)
  report.check(
    'the plan seat limit blocks the third teammate from taking a seat',
    !becameActive,
    becameActive
      ? 'a fourth participant went active on a plan documented as owner + 2 — the seat limit is not enforced, or the owner is not on the free plan'
      : `refused, status stayed "${seated.body?.[0]?.status ?? 'none'}" (RPC: HTTP ${overflowAccept.status} ${acceptMsg})`,
  )
  report.check(
    'the seat refusal names the cause, so it is diagnosable mid-demo',
    becameActive || /seat/i.test(acceptMsg) || overflowAccept.body === 0 || overflowAccept.body === '0',
    /seat/i.test(acceptMsg) ? 'message names the seat limit' : `RPC returned ${acceptMsg}`,
  )
  if (becameActive) state.extraInvites.push(E.email)

  state.memberJoined = true
}
