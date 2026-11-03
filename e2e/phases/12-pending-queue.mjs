// Phase 12 — PENDING QUEUE: agent-captured memories wait for a human, and the
// human's approval actually takes effect for the whole team.
//
// `observe` and `session_end` are how an agent writes without being asked. They
// land as status='pending' so that a guess never reaches teammates' context
// unreviewed. That promise has three halves, and a team rollout depends on all
// of them:
//
//   1. pending rows are INVISIBLE to every read surface (recall, briefs,
//      onboarding), for the author and for teammates;
//   2. `tages verify` / `tages pending --approve-all` make them live for
//      everyone, including an agent whose local SQLite cache already holds the
//      pending copy;
//   3. a person who is NOT allowed to approve is told so. PostgREST returns
//      success with zero rows when RLS blocks an UPDATE that has no
//      `.select()`, and verify.ts / pending.ts / settings.ts / remoteVerifyMemory
//      all update without one. The suspicion is that the CLI says "Verified"
//      while the row stays pending. The member checks assert either a non-zero
//      exit OR a row that really became live; "exit 0, says Verified, row still
//      pending" is a FAIL and is not softened.
//
// Opt-in auto-promotion (`tages settings auto-save <t>`) is checked last:
// only rows with confidence >= t are promoted, and session_end rows are
// documented to stay pending regardless (server/src/sync/auto-save.ts header).

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli, mcp, mcpOne, toolCall, mcpText } from '../lib/cli.mjs'
import { withLocalDb } from '../lib/localdb.mjs'
import { stampOf, has, cacheNote, cliRecall, mcpRecall, converge } from '../lib/surfaces.mjs'

export const id = '12-pending-queue'
export const title = '12 · PENDING QUEUE — staged memories stay hidden until approved, then reach everyone'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B
  const D = ids.D

  if (!state.joined || !state.memberJoined) {
    report.check('owner, admin and member are all joined before the pending queue is exercised', false, 'phase 04 or 06 did not complete')
    return
  }

  const stamp = stampOf(ctx)
  const tok = `pq${stamp}`
  const asA = { token: A.token }

  const rows = async (filter, select = 'id,key,value,status,confidence,tags,source,verified_at,created_by') => {
    const r = await api.rest(`/memories?project_id=eq.${project.id}&${filter}&select=${select}`, { as: asA })
    return Array.isArray(r.body) ? r.body : []
  }
  const byMarker = m => rows(`value=ilike.*${m}*`)
  const statusOf = async key => (await rows(`key=eq.${encodeURIComponent(key)}`, 'status'))[0]?.status ?? null
  const pendingIds = async () => (await rows('status=eq.pending', 'id,key')).map(r => r)
  const seed = async (suffix, confidence) => {
    const key = `${ctx.fixturePrefix}-pq-seed-${suffix}`
    const r = await api.insert(
      'memories',
      {
        project_id: project.id,
        key,
        value: `Seeded pending fact ${tok}${suffix}: the ${suffix} runbook step is gated on a manual approval.`,
        type: 'lesson',
        source: 'agent',
        status: 'pending',
        confidence,
        tags: ['e2e-seed'],
      },
      { as: asA },
    )
    return { key, ok: r.status < 300, status: r.status }
  }

  // Phase 08 revokes D to prove revocation works. A revoked member sees nothing,
  // which would turn every member check below into a test of revocation instead
  // of a test of the read-only role. Re-seat D as a plain member with the
  // service key. This is fixture setup, not an authorization assertion, and it
  // is verified with D's own token straight afterwards.
  await api.rest(`/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(D.email)}`, { method: 'PATCH', body: { status: 'active' } })
  const dRead = cli(bins.cliBin, D, ['recall', 'stale migration lock deploy gate'])
  const dAuthz = await api.rpc('is_write_authorized', { uid: D.userId, pid: project.id }, { as: { token: D.token } })
  report.check(
    'setup — the read-only member (revoked by phase 08) is re-seated: can read, still not write-authorized',
    (dRead.out.includes(state.keyA) || dRead.out.includes('migration lock')) && dAuthz.body === false,
    `read ok: ${dRead.out.includes('migration lock') || dRead.out.includes(state.keyA)}; is_write_authorized=${JSON.stringify(dAuthz.body)}`,
  )

  // ---- (a) an agent's observation becomes a PENDING row ---------------------
  const observation = `We decided to quarantine flaky payment webhook retries behind the ${tok} dead-letter queue instead of replaying them inline.`
  const query = 'quarantine flaky payment webhook retries dead-letter queue'
  const obs = await mcpOne(bins.serverBin, A, 'observe', { observation })
  report.check(
    'MCP `observe` accepts an agent observation and stages it',
    obs.ok && /staged/i.test(obs.text),
    obs.ok ? head(obs.text, 2) : obs.why,
  )

  const landed = await poll(async () => (await byMarker(tok))[0] ?? null, { timeoutMs: 45000, label: 'observed row reaches Supabase' })
  const P1 = landed.value
  report.check(
    'the observation reaches Supabase as status=pending, source=agent, authored by the caller',
    landed.ok && P1.status === 'pending' && P1.source === 'agent' && P1.created_by === A.userId,
    landed.ok ? `status=${P1.status} source=${P1.source} confidence=${P1.confidence} key=${P1.key}` : pollDetail(landed),
  )
  if (!landed.ok) {
    report.skip('rest of the pending-queue phase', 'no pending row to work with')
    return
  }

  // ---- warm both agents' caches so the stale-copy case is real -------------
  // Boot A's and B's MCP servers now (this is also the MCP half of check (b)).
  // B's boot hydrates the pending row into B's SQLite; A's cache holds it from
  // the observe call. The verify below then happens within the 60s hydration
  // TTL, which is exactly when a teammate restarts their agent after approval.
  state.pqKey = P1.key
  B.wipeLocalState(project.slug) // a cold cache forces a full hydration, which includes the pending row
  const aWarm = await mcpRecall(bins, A, query)
  const bWarm = await mcpRecall(bins, B, query)

  const bCache = withLocalDb(B, project.slug, db => db.prepare('SELECT status FROM memories WHERE key = ?').get(P1.key))
  report.check(
    'control — B\'s local cache already holds the PENDING copy (so the stale-cache check below is a real test)',
    bCache?.status === 'pending',
    bCache ? `B's SQLite has the row with status=${bCache.status}` : "B's cache has no such row or no cache file at all",
  )

  // ---- (b) pending is invisible on every read surface ------------------------
  const leak = text => has(text, P1.key, tok)
  const aCli = cliRecall(bins, A, query)
  const bCli = cliRecall(bins, B, query)
  const dCli = cliRecall(bins, D, query)
  report.check('CLI recall does not return a pending memory to its author', !leak(aCli.out), head(aCli.out, 2) || 'no results')
  report.check('CLI recall does not return a pending memory to a teammate (admin)', !leak(bCli.out), head(bCli.out, 2) || 'no results')
  report.check('CLI recall does not return a pending memory to a read-only member', !leak(dCli.out), head(dCli.out, 2) || 'no results')
  report.check('MCP recall does not return a pending memory to its author', aWarm.ok && !leak(aWarm.text), aWarm.ok ? head(aWarm.text, 2) : aWarm.why)
  report.check(
    'MCP recall does not return a pending memory to a teammate whose cache holds the pending copy',
    bWarm.ok && !leak(bWarm.text),
    bWarm.ok ? head(bWarm.text, 2) : bWarm.why,
  )

  // Other surfaces that put memories in front of an agent or a new hire. These
  // do not share recall's status filter, so they are checked on their own.
  const bBrief = await mcpOne(bins.serverBin, B, 'project_brief', {})
  report.check(
    'MCP `project_brief` (injected into agent context) does not include a pending memory',
    bBrief.ok && !leak(bBrief.text),
    leak(bBrief.text)
      ? 'a pending, unreviewed memory is in the brief — cache.getAllForProject (sqlite.ts:541) has no status filter'
      : head(bBrief.text, 2),
  )
  const bOnboard = cli(bins.cliBin, B, ['onboard'])
  report.check(
    '`tages onboard` (a new hire\'s briefing) does not include a pending memory',
    !leak(bOnboard.out),
    leak(bOnboard.out)
      ? 'onboard prints the pending memory — cli/src/commands/onboard.ts selects all rows with no status=live filter'
      : 'not present',
  )

  // ---- (c) `tages pending` lists it ------------------------------------------
  const listA = cli(bins.cliBin, A, ['pending'])
  report.check('`tages pending` lists the staged memory for the owner', listA.code === 0 && listA.out.includes(P1.key), head(listA.out, 3))
  const listB = cli(bins.cliBin, B, ['pending'])
  report.check('`tages pending` lists it for a teammate too (the queue is shared)', listB.code === 0 && listB.out.includes(P1.key), head(listB.out, 3))

  // ---- (d) verify promotes it for everyone ------------------------------------
  const verify = cli(bins.cliBin, A, ['verify', P1.key])
  report.check('`tages verify <key>` exits 0 and reports the promotion', verify.code === 0 && /verified/i.test(verify.out), tail(verify.out, 2))
  const live = await poll(async () => ((await statusOf(P1.key)) === 'live' ? true : null), { timeoutMs: 20000, label: 'row becomes live' })
  report.check('the row is status=live in Supabase after verify', live.ok, live.ok ? pollDetail(live) : `status is still ${await statusOf(P1.key)}`)

  // An agent can only retrieve what is in its SQLite cache WITH an embedding
  // (sqlite.ts scoredQuery: status='live' AND embedding IS NOT NULL). observe
  // and session_end store no embedding, and neither does verify, so an approved
  // memory may be live in the cloud and still unreachable by any agent.
  const promoted = (await rows(`key=eq.${encodeURIComponent(P1.key)}`, 'status,embedding'))[0]
  report.check(
    'the approved memory carries an embedding (agents retrieve from a cache that requires one)',
    promoted?.embedding != null,
    promoted?.embedding != null ? 'embedding present' : 'embedding is NULL after approval: observe.ts/verify.ts never request one, so MCP recall (scoredQuery needs embedding IS NOT NULL) cannot surface it while other results exist',
  )
  const localState = who => withLocalDb(who, project.slug, db => db.prepare('SELECT status, embedding IS NOT NULL AS emb FROM memories WHERE key = ?').get(P1.key))
  const diag = who => { const l = localState(who); return l ? `local status=${l.status} embedding=${l.emb ? 'yes' : 'NO'}` : 'not in local cache' }

  const aCli2 = cliRecall(bins, A, query)
  const bCli2 = cliRecall(bins, B, query)
  report.check('control — CLI recall now returns it to the author (the negative checks above could have passed vacuously)', leak(aCli2.out), head(aCli2.out, 2))
  report.check('CLI recall returns it to the teammate', leak(bCli2.out), head(bCli2.out, 2))

  // Immediately restart both agents: this is what a teammate does after being
  // told "I approved it". The caches still hold the pending copy.
  const bAfter = await mcpRecall(bins, B, query)
  const aAfter = await mcpRecall(bins, A, query)
  report.check(
    "teammate's agent sees the approved memory on its FIRST restart after approval (cache held the pending copy)",
    bAfter.ok && leak(bAfter.text),
    bAfter.ok && leak(bAfter.text)
      ? `served; ${cacheNote(bAfter.stderr)}`
      : `cloud row is live but B's restarted agent does not return it. ${cacheNote(bAfter.stderr)}; B ${diag(B)}. ` +
        'index.ts skips hydration when the cache is under 60s old and recall.ts answers from SQLite first',
  )
  report.check(
    "owner's own agent sees the approved memory on its first restart (author's cache also held the pending copy)",
    aAfter.ok && leak(aAfter.text),
    aAfter.ok && leak(aAfter.text) ? `served; ${cacheNote(aAfter.stderr)}` : `the approver's own restarted agent does not return it. ${cacheNote(aAfter.stderr)}; A ${diag(A)}`,
  )
  const bEventually = await converge(
    () => mcpRecall(bins, B, query),
    r => r.ok && leak(r.text),
  )
  report.check(
    "teammate's agent converges on the approved memory within 100s of restarts",
    bEventually.ok,
    bEventually.ok ? `after ${bEventually.attempts} restart(s), ${bEventually.ms}ms` : `never converged. B ${diag(B)}. Per-restart cache log: ${bEventually.trail.join(' | ')}`,
  )

  // ---- agent session summary: multiple pending rows ---------------------------
  const summary = [
    `Decided to route ${tok} canary traffic through the blue ingress for one week.`,
    `Always tag ${tok} release branches with the rc- prefix before merging.`,
    `Gotcha: ${tok} cron jobs skip the daylight saving transition hour.`,
  ].join('\n')
  const se = await mcpOne(bins.serverBin, A, 'session_end', { summary })
  const sessionKeys = [...se.text.matchAll(/^- \[[a-z_]+\] (\S+):/gm)].map(m => m[1])
  report.check('MCP `session_end` stages one pending memory per extractable line', se.ok && sessionKeys.length === 3, se.ok ? `${sessionKeys.length} staged` : se.why)

  const sessionRows = await poll(
    async () => {
      const r = await byMarker(`${tok} `)
      const s = r.filter(x => sessionKeys.includes(x.key))
      return s.length === 3 ? s : null
    },
    { timeoutMs: 45000, label: 'session_end rows reach Supabase' },
  )
  report.check(
    'session_end rows reach Supabase as pending, confidence 0.8, tagged session-extract',
    sessionRows.ok && sessionRows.value.every(r => r.status === 'pending' && Number(r.confidence) === 0.8 && (r.tags ?? []).includes('session-extract')),
    sessionRows.ok ? sessionRows.value.map(r => `${r.status}/${r.confidence}`).join(' ') : pollDetail(sessionRows),
  )
  const sessLeak = text => has(text, ...sessionKeys, `${tok} canary`, `${tok} release branches`, `${tok} cron`)
  const sA = cliRecall(bins, A, 'canary traffic blue ingress release branches rc prefix cron jobs daylight saving')
  const sB = cliRecall(bins, B, 'canary traffic blue ingress release branches rc prefix cron jobs daylight saving')
  report.check('session_end rows are not returned by CLI recall to author or teammate', !sessLeak(sA.out) && !sessLeak(sB.out), head(sA.out + sB.out, 2) || 'no results')

  // Pending rows with a high confidence, for the member and approve-all tests.
  const s1 = await seed('one', 0.9)
  const s2 = await seed('two', 0.9)
  const s3 = await seed('three', 0.9)
  report.check('three further pending rows are seeded (control for the bulk and member tests)', s1.ok && s2.ok && s3.ok, `HTTP ${s1.status}/${s2.status}/${s3.status}`)

  const listAll = cli(bins.cliBin, A, ['pending'])
  report.check(
    '`tages pending` lists every staged memory (3 session_end + 3 seeded)',
    [...sessionKeys, s1.key, s2.key, s3.key].every(k => listAll.out.includes(k)),
    head(listAll.out, 2),
  )

  // ---- (f) a read-only member tries to approve -------------------------------
  // PostgREST: an UPDATE that RLS filters to zero rows is a SUCCESS with no
  // error. Without `.select()` the CLI cannot tell that from a real update.
  const memberVerify = cli(bins.cliBin, D, ['verify', s1.key])
  const afterMemberVerify = await statusOf(s1.key)
  report.check(
    'a read-only member running `tages verify` gets an error, OR the row really became live',
    memberVerify.code !== 0 || afterMemberVerify === 'live',
    memberVerify.code !== 0
      ? `refused (exit ${memberVerify.code}): ${tail(memberVerify.out, 1)}`
      : afterMemberVerify === 'live'
        ? 'the row became live (a member can approve; confirm that is intended)'
        : `SILENT NO-OP: exit 0, CLI said "${tail(memberVerify.out, 1)}", but the row is still ${afterMemberVerify}. ` +
          'verify.ts:50 updates without .select(), so an RLS-blocked update looks like success',
  )

  D.wipeLocalState(project.slug) // force a full hydration so the pending rows are in D's cache
  const memberMcpVerify = await mcpOne(bins.serverBin, D, 'verify_memory', { key: s2.key })
  const afterMcp = await statusOf(s2.key)
  const claimed = /verified:/i.test(memberMcpVerify.text)
  report.check(
    "a read-only member's agent calling `verify_memory` is not told it succeeded while the row stays pending",
    !claimed || afterMcp === 'live',
    !claimed
      ? `not claimed: ${head(memberMcpVerify.text, 1)}`
      : afterMcp === 'live'
        ? 'the row became live'
        : `SILENT NO-OP: tool said "${head(memberMcpVerify.text, 1)}" but the cloud row is ${afterMcp} (supabase-sync.ts remoteVerifyMemory has no .select())`,
  )

  const beforeBulk = (await pendingIds()).length
  const memberBulk = cli(bins.cliBin, D, ['pending', '--approve-all', '--yes'])
  const afterBulk = (await pendingIds()).length
  report.check(
    'a read-only member running `pending --approve-all --yes` gets an error, OR rows really became live',
    memberBulk.code !== 0 || afterBulk < beforeBulk,
    memberBulk.code !== 0
      ? `refused (exit ${memberBulk.code}): ${tail(memberBulk.out, 1)}`
      : afterBulk < beforeBulk
        ? `${beforeBulk - afterBulk} rows became live`
        : `SILENT NO-OP: exit 0, CLI said "${tail(memberBulk.out, 1)}", ${afterBulk}/${beforeBulk} rows still pending (pending.ts bulkApprove updates without .select())`,
  )

  // ---- (e) bulk approval by someone allowed to approve -----------------------
  const pendingBefore = await pendingIds()
  const bulk = cli(bins.cliBin, A, ['pending', '--approve-all', '--yes'])
  const approved = Number((bulk.out.match(/Approved (\d+)/) || [])[1] ?? -1)
  report.check(
    '`tages pending --approve-all --yes` approves every pending memory, no prompt',
    bulk.code === 0 && approved === pendingBefore.length && pendingBefore.length >= 3,
    `exit ${bulk.code}: ${tail(bulk.out, 1)} (pending before: ${pendingBefore.length})`,
  )
  const stillPending = await pendingIds()
  report.check('no pending rows remain in Supabase afterwards', stillPending.length === 0, `${stillPending.length} still pending`)
  const sessionLive = await rows(`key=in.(${sessionKeys.map(k => `"${k}"`).join(',')})`, 'status')
  report.check('the session_end rows are now live', sessionLive.length === 3 && sessionLive.every(r => r.status === 'live'), sessionLive.map(r => r.status).join(','))
  const sB2 = cliRecall(bins, B, `${tok} canary traffic blue ingress`)
  report.check('control — a teammate now recalls an approved session_end memory over the CLI', sessLeak(sB2.out), head(sB2.out, 2))

  // ---- (g) auto-save threshold --------------------------------------------------
  const thresholdOf = async () => (await api.rest(`/projects?id=eq.${project.id}&select=auto_save_threshold`, { as: asA })).body?.[0]?.auto_save_threshold
  const set = cli(bins.cliBin, A, ['settings', 'auto-save', '0.75', '--yes'])
  const t1 = await thresholdOf()
  report.check('owner sets the auto-save threshold to 0.75', set.code === 0 && Number(t1) === 0.75, `exit ${set.code}, stored ${t1}`)

  const memberSet = cli(bins.cliBin, D, ['settings', 'auto-save', '0.1', '--yes'])
  const t2 = await thresholdOf()
  report.check('a read-only member cannot change the project auto-save threshold', Number(t2) === 0.75, `stored value is ${t2}`)
  report.check(
    'and the member is told it did not apply',
    memberSet.code !== 0 || !/set to/i.test(memberSet.out) || Number(t2) === 0.1,
    memberSet.code !== 0 ? `refused (exit ${memberSet.code})` : `SILENT NO-OP: exit 0, CLI said "${tail(memberSet.out, 1)}" but the threshold is still ${t2} (settings.ts:122 has no .select())`,
  )

  // In-process: the server loads the threshold at boot; observe (0.7) is below it,
  // session_end (0.8) is above it. Neither may be promoted by the call itself.
  const oText = `We decided to cap ${tok}b exponential backoff at five minutes for the nightly sync.`
  const tText = `Always pin the ${tok}c worker image to a digest rather than a floating tag.`
  const inproc = await mcp(bins.serverBin, A, [toolCall('observe', { observation: oText }), toolCall('session_end', { summary: tText })])
  const oRow = await poll(async () => (await byMarker(`${tok}b`))[0] ?? null, { timeoutMs: 30000 })
  const tRow = await poll(async () => (await byMarker(`${tok}c`))[0] ?? null, { timeoutMs: 30000 })
  report.check(
    'at threshold 0.75: an observe (0.7) and a session_end row (0.8) are both staged, not auto-promoted by the call',
    inproc.ok && oRow.ok && tRow.ok && oRow.value.status === 'pending' && tRow.value.status === 'pending',
    `observe=${oRow.value?.status}/${oRow.value?.confidence} session_end=${tRow.value?.status}/${tRow.value?.confidence}`,
  )

  const hi = await seed('hi', 0.9)
  const lo = await seed('lo', 0.5)
  // A fresh server start runs the sweep (index.ts:200) before serving tools.
  const sweepBoot = await mcpRecall(bins, A, 'startup sweep trigger')
  const hiS = await statusOf(hi.key)
  const loS = await statusOf(lo.key)
  const oS = await statusOf(oRow.value?.key)
  const tS = await statusOf(tRow.value?.key)
  report.check(
    'the sweep promotes a pending row at/above the threshold (0.9 >= 0.75)',
    sweepBoot.ok && hiS === 'live',
    `0.9 row is ${hiS}; server log: ${(sweepBoot.stderr.match(/Auto-saved[^\n]*/) || ['no sweep line'])[0]}`,
  )
  report.check('and leaves rows below it pending (0.5 and the 0.7 observation)', loS === 'pending' && oS === 'pending', `0.5 row ${loS}, 0.7 observe row ${oS}`)
  report.check(
    'session_end rows stay pending regardless of the threshold (auto-save.ts header: "always go to pending for review")',
    tS === 'pending',
    tS === 'pending'
      ? 'still pending'
      : `PROMOTED: the 0.8 session_end row went ${tS} on the next server start. The comment says the sweep does not run in session_end, ` +
        'but index.ts:200 sweeps ALL pending rows with confidence >= threshold at boot, so session-extracted text bypasses review',
  )

  // Immediate promotion inside observe (the id-vs-key fix in observe.ts:114).
  cli(bins.cliBin, A, ['settings', 'auto-save', '0.7', '--yes'])
  const imText = `We chose to keep ${tok}d feature flags in the database instead of environment variables.`
  const im = await mcpOne(bins.serverBin, A, 'observe', { observation: imText })
  const imRow = await poll(async () => {
    const r = (await byMarker(`${tok}d`))[0]
    return r?.status === 'live' ? r : null
  }, { timeoutMs: 20000 })
  report.check(
    'at threshold 0.7 an observation is auto-saved and the REMOTE row is live (teammates can see it)',
    im.ok && /auto-saved/i.test(im.text) && imRow.ok,
    imRow.ok ? head(im.text, 1) : `tool said "${head(im.text, 1)}" but the cloud row is ${(await byMarker(`${tok}d`))[0]?.status ?? 'missing'}`,
  )

  const off = cli(bins.cliBin, A, ['settings', 'auto-save', 'off', '--yes'])
  const t3 = await thresholdOf()
  report.check('auto-save can be switched off again (NULL)', off.code === 0 && t3 === null, `exit ${off.code}, stored ${t3}`)
}
