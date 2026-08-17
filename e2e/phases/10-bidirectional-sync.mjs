// Phase 10 — BIDIRECTIONAL SYNC: the CLI reconciles with the cloud on its own.
//
// Acceptance tests for three requirements, written 2026-08-17 BEFORE the
// implementation so it could not quietly satisfy a weaker version of them:
//
//   1. the CLI scans for new cloud memories when it runs, rather than only at
//      MCP startup — no "restart your agent" step;
//   2. a memory written locally reaches the cloud so it can be evaluated for
//      inclusion in the shared set;
//   3. the database is authoritative: where local and cloud disagree about a
//      memory, the cloud version wins.
//
// Implemented by packages/cli/src/sync/auto-reconcile.ts (a rate-limited
// preAction hook) and `reconcile()` in cli-sync.ts.
//
// ORDERING HAZARD, load-bearing. Requirement 3 is only safe once the
// memory_versions snapshot RLS defect (migration 0069) is fixed. Until then a
// user's push dies permanently after their first edit, so their unsynced work
// lives only in local SQLite — and a naive cloud-wins reconciliation would
// overwrite exactly that. The last check in this phase pins the safe ordering:
// dirty local rows must be PUSHED before cloud state is applied, so precedence
// never becomes deletion.

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'
import { localMemory, localDirty } from '../lib/localdb.mjs'

export const id = '10-bidirectional-sync'
export const title = '10 · BIDIRECTIONAL SYNC — the CLI reconciles with the cloud by itself'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B

  if (!state.joined) {
    report.check('teammate joined before sync reconciliation is exercised', false, 'phase 04 did not complete')
    return
  }

  // ---- 1. pull on run ----------------------------------------------------
  // Written directly to Supabase, bypassing every CLI, so the ONLY way it can
  // appear locally is if the CLI pulled it. Writing it through A's CLI would
  // leave open the possibility that B saw it via a live query rather than a
  // reconciliation.
  const pullKey = `${ctx.fixturePrefix}-cloud-origin`
  const pullValue = 'Cloud-origin fact: the artifact cache is purged every Sunday at 04:00 UTC.'
  const seeded = await api.insert(
    'memories',
    {
      project_id: project.id,
      key: pullKey,
      value: pullValue,
      type: 'lesson',
      source: 'manual',
      status: 'live',
      confidence: 1,
    },
    { as: { token: A.token } },
  )
  report.check('a cloud-only memory can be seeded for the pull test', seeded.status < 300, `HTTP ${seeded.status}`)
  if (seeded.status < 300) state.leakedKeys.push(pullKey)

  // Control: the memory must NOT already be local, or "it is local afterwards"
  // proves nothing.
  const beforePull = localMemory(B, project.slug, pullKey)
  report.check(
    'control — the cloud-only memory is absent from the local store before the CLI runs',
    beforePull === null,
    beforePull === null ? 'absent locally, as expected' : 'already present locally — the pull assertion below would pass vacuously',
  )

  // `status` is the cheapest command that should trigger a reconciliation.
  //
  // TAGES_SYNC_TTL_MS=0 disables the rate limiter for this call. Reconciliation
  // is rate-limited to one round trip per minute, and earlier phases have
  // already refreshed this cache — so without the override this would be
  // measuring the rate limiter, not the pull. The limiter gets its own
  // assertion at the end of this phase.
  const noTtl = { TAGES_SYNC_TTL_MS: '0' }
  const statusRun = cli(bins.cliBin, B, ['status'], { env: noTtl })

  // Assert against the SQLite file, NOT against `recall`. `tages recall` and
  // `recall --all` both query Supabase directly, so they answer from the cloud
  // whether or not a pull ever happened — an earlier version of this check did
  // exactly that and passed while proving nothing.
  const afterPull = localMemory(B, project.slug, pullKey)
  report.check(
    'running the CLI pulls a cloud-only memory into the LOCAL store, with no agent restart',
    afterPull !== null,
    afterPull !== null
      ? 'present in the local SQLite cache after a plain CLI invocation'
      : `NOT PULLED — the local store still lacks it, so an agent reading from cache is blind to the teammate's memory ` +
        `until the MCP server restarts. status said: ${head(statusRun.out, 2)}`,
  )

  // ---- 2. local writes reach the shared set ------------------------------
  const localKey = `${ctx.fixturePrefix}-local-origin`
  const write = cli(bins.cliBin, B, ['remember', localKey, 'Local-origin fact: staging rebuilds take eleven minutes.', '--type', 'lesson'])
  const pushed = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, localKey, 'id,status', { token: B.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'locally written memory reaches the cloud' },
  )
  report.check(
    'a memory written locally reaches the cloud so it can be evaluated for the shared set',
    pushed.ok,
    pushed.ok ? `status=${pushed.value.status}, ${pollDetail(pushed)}` : `${pollDetail(pushed)} — CLI said: ${tail(write.out, 2)}`,
  )
  if (pushed.ok) state.leakedKeys.push(localKey)

  // ---- 3. the database is authoritative ----------------------------------
  // Diverge one memory: change it in the cloud only, behind the CLI's back.
  // On the next run the local copy must converge on the cloud value.
  const cloudEdit = 'Cloud-origin fact, AMENDED SERVER-SIDE: the artifact cache is purged nightly at 02:00 UTC.'
  const amend = await api.rest(`/memories?project_id=eq.${project.id}&key=eq.${encodeURIComponent(pullKey)}`, {
    method: 'PATCH',
    body: { value: cloudEdit },
    headers: { Prefer: 'return=representation' },
    as: { token: A.token },
  })
  report.check('a memory can be amended server-side for the precedence test', amend.status < 300, `HTTP ${amend.status}`)

  // Again against SQLite, not recall: the question is whether the LOCAL copy
  // converged on the cloud value, and a cloud-backed query cannot answer that.
  // A key lookup also sidesteps recall's ranking, which is unreliable enough
  // (see phase 02) to mask the result.
  cli(bins.cliBin, B, ['status'], { env: noTtl })
  const converged = localMemory(B, project.slug, pullKey)
  report.check(
    'a server-side amendment wins over the stale local copy (the database is authoritative)',
    converged?.value === cloudEdit,
    converged === null
      ? 'the memory is not in the local store at all, so precedence cannot be evaluated'
      : converged.value === cloudEdit
        ? 'local copy converged on the amended cloud value'
        : `local copy still holds the superseded text — the database is NOT authoritative. local: "${String(converged.value).slice(0, 80)}"`,
  )

  // ---- 3b. precedence must not mean deletion ------------------------------
  // The safety property that makes requirement 3 shippable. A memory written
  // locally and NOT yet in the cloud must survive reconciliation — it should be
  // pushed, not discarded for being absent upstream. Without this, "the cloud
  // wins" silently destroys every write made while sync was failing, which is
  // the exact state the 0069 defect leaves users in today.
  const unsyncedKey = `${ctx.fixturePrefix}-local-only-survivor`
  cli(bins.cliBin, B, ['remember', unsyncedKey, 'Local-only fact: the canary deploy waits four minutes before promoting.', '--type', 'lesson'])

  // Force a reconciliation, then confirm the local write is still there.
  cli(bins.cliBin, B, ['status'], { env: noTtl })
  const stillLocal = localMemory(B, project.slug, unsyncedKey) !== null
  const reachedCloud = (await api.memoryByKey(project.id, unsyncedKey, 'id', { token: B.token })).length === 1
  report.check(
    'cloud precedence does not delete a local memory that has not been pushed yet',
    stillLocal || reachedCloud,
    stillLocal
      ? reachedCloud
        ? 'local write survived reconciliation and was pushed upstream'
        : 'local write survived reconciliation but has not been pushed — recoverable, but not yet shared'
      : 'DATA LOSS: a local memory absent from the cloud was destroyed by reconciliation',
  )
  if (reachedCloud) state.leakedKeys.push(unsyncedKey)

  // The sync queue must drain. A permanently dirty row is the signature of the
  // 0069 failure mode: one rejected write wedges the queue and every later
  // memory silently stops reaching the team.
  const drained = await poll(() => localDirty(B, project.slug).length === 0, {
    timeoutMs: 20000,
    intervalMs: 2000,
    label: 'local sync queue drains',
  })
  const stuck = localDirty(B, project.slug)
  report.check(
    'the local sync queue drains rather than wedging on a rejected row',
    drained.ok,
    drained.ok
      ? pollDetail(drained)
      : `${stuck.length} row(s) still dirty: ${stuck.map(r => r.key).join(', ').slice(0, 200)} — everything written after them stays local`,
  )

  // ---- 4. the rate limiter -----------------------------------------------
  // Reconciling on EVERY invocation would put a network round trip in front of
  // every command. This asserts the limiter actually suppresses a redundant
  // pull, using the default TTL (no override) immediately after the pulls above.
  const rateLimitKey = `${ctx.fixturePrefix}-rate-limited`
  await api.insert(
    'memories',
    {
      project_id: project.id,
      key: rateLimitKey,
      value: 'Seeded to prove the reconcile rate limiter suppresses a redundant round trip.',
      type: 'lesson',
      source: 'manual',
      status: 'live',
      confidence: 1,
    },
    { as: { token: A.token } },
  )
  state.leakedKeys.push(rateLimitKey)

  cli(bins.cliBin, B, ['status']) // no TTL override — must be suppressed
  const suppressed = localMemory(B, project.slug, rateLimitKey) === null
  report.check(
    'the reconcile is rate-limited, so back-to-back commands do not each pay a round trip',
    suppressed,
    suppressed
      ? 'a second immediate invocation did not re-pull, as intended'
      : 'every invocation reconciles — the TTL guard is not being applied, which puts a network round trip in front of every command',
  )
}
