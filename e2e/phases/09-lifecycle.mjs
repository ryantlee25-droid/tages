// Phase 09 — LIFECYCLE: a retracted memory stops being served, to everyone.
//
// Deletion is the half of "storage" that is easy to get wrong in a shared
// system. A `forget` that clears the author's local cache but leaves the row in
// Supabase produces the worst possible outcome: the person who retracted the
// fact can no longer see it, and everyone else keeps acting on it.

import { poll, pollDetail, tail, head } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'

export const id = '09-lifecycle'
export const title = '09 · LIFECYCLE — retracted memories stop being served to the whole team'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B

  const key = `${ctx.fixturePrefix}-retracted`
  const value = 'Temporary: the load balancer drains connections over 45 seconds during a rolling restart.'
  const marker = 'drains connections over 45 seconds'

  const write = cli(bins.cliBin, A, ['remember', key, value, '--type', 'lesson'])
  report.check('a memory to be retracted is created first', write.code === 0, tail(write.out, 1))

  const landed = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, key, 'id', { token: A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'memory to retract reaches Supabase' },
  )
  report.check('it is durably stored before retraction', landed.ok, pollDetail(landed))
  if (!landed.ok) {
    report.skip('retraction assertions', 'the memory never landed, so forgetting it proves nothing')
    return
  }
  state.leakedKeys.push(key) // in case forget does not remove it; cleanup will

  // Confirm the teammate really can see it — otherwise "gone after forget" is
  // indistinguishable from "never visible".
  const beforeB = cli(bins.cliBin, B, ['recall', 'load balancer drain rolling restart'])
  report.check(
    'control — the teammate can see it before it is retracted',
    beforeB.out.includes(key) || beforeB.out.includes(marker),
    head(beforeB.out, 3),
  )

  // ---- retract -----------------------------------------------------------
  const forget = cli(bins.cliBin, A, ['forget', key])
  report.check('`tages forget` exits 0', forget.code === 0, tail(forget.out, 2))

  const gone = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, key, 'id,status', { token: A.token })
      return rows.length === 0 ? true : null
    },
    { timeoutMs: 30000, label: 'row removed from Supabase' },
  )
  report.check(
    'the row is removed from shared storage, not just the local cache',
    gone.ok,
    gone.ok ? pollDetail(gone) : 'the row is still in Supabase — the author has retracted it locally while every teammate still reads it',
  )
  if (gone.ok) state.leakedKeys = state.leakedKeys.filter(k => k !== key)

  const afterA = cli(bins.cliBin, A, ['recall', 'load balancer drain rolling restart'])
  report.check('the author no longer recalls it', !afterA.out.includes(marker), head(afterA.out, 2) || 'no results')

  const afterB = cli(bins.cliBin, B, ['recall', 'load balancer drain rolling restart'])
  report.check(
    'the TEAMMATE no longer recalls it either',
    !afterB.out.includes(marker),
    afterB.out.includes(marker) ? 'the teammate is still served a retracted fact' : head(afterB.out, 2) || 'no results',
  )

  // ---- idempotence --------------------------------------------------------
  const again = cli(bins.cliBin, A, ['forget', key])
  report.check(
    'forgetting an already-forgotten key is a harmless no-op, not a crash',
    again.code === 0 || /not found|no memory/i.test(again.out),
    `exit ${again.code}: ${tail(again.out, 1)}`,
  )

  // ---- the rest of the store is untouched ---------------------------------
  const survivors = cli(bins.cliBin, A, ['recall', 'stale migration lock deploy gate'])
  report.check(
    'unrelated memories survive the retraction',
    survivors.out.includes(state.keyA) || survivors.out.includes(state.markerNew),
    head(survivors.out, 3),
  )
}
