// Phase 14 — RECENCY: the team always reads the newest set of memories.
//
// Three ways a shared store serves yesterday's truth:
//
//   STALE VALUE   a key is updated by two people in quick succession and some
//                 read surface (an agent's warm SQLite cache, a brief, an
//                 onboarding page) still returns an earlier value. Marker
//                 phrases for v1/v2/v3 share no distinctive words, so "returns
//                 v3" and "returns v3 plus a stale v1" are distinguishable.
//   TIE ORDER     two memories with the same text score identically. With no
//                 tiebreak on updated_at then id, which one is shown first is
//                 whatever the query planner returned. Recall six times; the
//                 order must not move, and the newer one must lead.
//   RETRACTION    an archived or forgotten memory must leave every read
//                 surface for every identity, including a teammate whose
//                 agent already cached it. Phase 09 covers CLI `forget` + CLI
//                 recall; this extends to MCP archive/forget and to the surfaces
//                 that do not share recall's status filter.

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli, mcp, mcpOne, toolCall, mcpText } from '../lib/cli.mjs'
import { withLocalDb } from '../lib/localdb.mjs'
import { stampOf, has, cacheNote, cliRecall, mcpRecall, converge } from '../lib/surfaces.mjs'

export const id = '14-recency'
export const title = '14 · RECENCY — the newest memories win on every read surface'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B
  if (!state.joined) {
    report.check('teammate joined before recency is exercised', false, 'phase 04 did not complete')
    return
  }
  const s = stampOf(ctx)
  const asA = { token: A.token }
  const cloud = async (key, select = 'id,key,value,status,embedding,updated_at') =>
    (await api.memoryByKey(project.id, key, select, asA))[0] ?? null

  // ======================= STALE VALUE ======================================
  const K = `${ctx.fixturePrefix}-recency-K`
  const v = {
    1: { m: `mondaymorning${s}`, text: `The release train departure schedule is mondaymorning${s} from the platform guild.` },
    2: { m: `wednesdaynoon${s}`, text: `The release train departure schedule is wednesdaynoon${s} after the freeze review.` },
    3: { m: `fridaydusk${s}`, text: `The release train departure schedule is fridaydusk${s} once canary metrics are green.` },
  }
  const q = 'release train departure schedule'

  const w1 = cli(bins.cliBin, A, ['remember', K, v[1].text, '--type', 'convention'])
  const c1 = await poll(async () => ((await cloud(K))?.value === v[1].text ? true : null), { timeoutMs: 45000 })
  report.check('v1 written by the owner over the CLI reaches the cloud', w1.code === 0 && c1.ok, pollDetail(c1))

  // Warm B's agent cache with v1 (hydration) before anyone updates it.
  const bWarm = await mcpRecall(bins, B, q)
  report.check('control — B\'s agent has read v1 (its cache is now warm with the old value)', bWarm.ok && bWarm.text.includes(v[1].m), `${head(bWarm.text, 1)}; ${cacheNote(bWarm.stderr)}`)

  const w2 = await mcpOne(bins.serverBin, A, 'remember', { key: K, value: v[2].text, type: 'convention' })
  const c2 = await poll(async () => ((await cloud(K))?.value === v[2].text ? true : null), { timeoutMs: 45000 })
  report.check('v2 written by the owner\'s AGENT over MCP replaces v1 in the cloud', w2.ok && c2.ok, c2.ok ? pollDetail(c2) : head(w2.text, 1))

  const w3 = cli(bins.cliBin, B, ['remember', K, v[3].text, '--type', 'convention'])
  const c3 = await poll(async () => ((await cloud(K))?.value === v[3].text ? true : null), { timeoutMs: 45000 })
  report.check('v3 written by the admin teammate over the CLI replaces v2 in the cloud', w3.code === 0 && c3.ok, c3.ok ? pollDetail(c3) : tail(w3.out, 2))
  const rowsK = await api.memoryByKey(project.id, K, 'id', asA)
  report.check('there is still exactly one row for the key', rowsK.length === 1, `${rowsK.length} row(s)`)
  if (!c3.ok) return

  const fresh = (t, n = 3) => t.includes(v[n].m) && Object.entries(v).every(([k, x]) => Number(k) === n || !t.includes(x.m))
  const why = t => Object.entries(v).map(([k, x]) => `v${k}:${t.includes(x.m)}`).join(' ')
  const mcpSurfaces = [
    ['recall', who => mcpOne(bins.serverBin, who, 'recall', { query: q, limit: 5 })],
    ['conventions', who => mcpOne(bins.serverBin, who, 'conventions', {})],
    ['project_brief', who => mcpOne(bins.serverBin, who, 'project_brief', {})],
  ]
  const localVal = who => {
    const r = withLocalDb(who, project.slug, db => db.prepare('SELECT value FROM memories WHERE key = ?').get(K))
    return r ? Object.entries(v).find(([, x]) => r.value.includes(x.m))?.[0] ?? '?' : 'none'
  }
  const agentSurfaces = async (who, name, n) => {
    const heldBefore = localVal(who)
    const stale = []
    for (const [tool, call] of mcpSurfaces) {
      const r = await call(who)
      const ok = r.ok && fresh(r.text, n)
      if (!ok) stale.push(tool)
      report.check(
        `${name} agent: MCP \`${tool}\` serves only v${n} on its first restart`,
        ok,
        ok ? `v${n} only (cache held v${heldBefore} before; ${cacheNote(r.stderr)})` : `${r.ok ? why(r.text) : r.why}; local cache held v${heldBefore}; ${cacheNote(r.stderr)}`,
      )
    }
    if (stale.length) {
      const c = await converge(() => mcpRecall(bins, who, q), r => r.ok && fresh(r.text, n))
      report.check(`${name} agent converges on v${n} within 100s of restarts`, c.ok, c.ok ? `${c.ms}ms, ${c.attempts} restart(s)` : `never; ${c.trail.slice(-3).join(' | ')}`)
    }
  }

  // ORDER MATTERS in this block. Any CLI command runs auto-reconcile, which pulls
  // cloud rows into the same SQLite file the agent reads, so a CLI call between
  // the write and the agent restart would hide the staleness being measured.
  // 1. The owner's agent last touched K at v2 (its own write). Teammate wrote v3.
  //    No CLI command has run as the owner since. Restart the agent.
  await agentSurfaces(A, "owner's", 3)

  // 2. CLI surfaces read the cloud directly.
  for (const [who, name] of [[A, 'owner'], [B, 'teammate']]) {
    const r = cliRecall(bins, who, q)
    report.check(`CLI recall serves only the newest value to the ${name}`, fresh(r.out), why(r.out))
  }
  const onb = cli(bins.cliBin, B, ['onboard'])
  report.check('`tages onboard` serves only the newest value', fresh(onb.out), why(onb.out))
  const all = cliRecall(bins, A, '*', ['--all'])
  report.check('`tages recall --all` serves only the newest value', fresh(all.out), why(all.out))

  // 3. v4 by the owner. The teammate's cache last saw v3 (their own write) and
  //    they have run no CLI command since. Restart their agent.
  v[4] = { m: `saturdaydawn${s}`, text: `The release train departure schedule is saturdaydawn${s} for hotfix trains only.` }
  cli(bins.cliBin, A, ['remember', K, v[4].text, '--type', 'convention'])
  const c4 = await poll(async () => ((await cloud(K))?.value === v[4].text ? true : null), { timeoutMs: 45000 })
  report.check('v4 written by the owner over the CLI reaches the cloud', c4.ok, pollDetail(c4))
  await agentSurfaces(B, "teammate's", 4)

  // ======================= TIE ORDER ========================================
  const tieText = `The nightly cache warmup job refreshes every search index shard in a fixed order tie${s}.`
  const tieQ = 'nightly cache warmup job refreshes search index shard'
  const oldKey = `${ctx.fixturePrefix}-tie-old`
  const newKey = `${ctx.fixturePrefix}-tie-new`
  cli(bins.cliBin, A, ['remember', oldKey, tieText, '--type', 'convention'])
  await new Promise(r => setTimeout(r, 2500)) // a real, observable gap in created/updated time
  cli(bins.cliBin, A, ['remember', newKey, tieText, '--type', 'convention'])
  const both = await poll(async () => {
    const o = await cloud(oldKey)
    const n = await cloud(newKey)
    return o && n && o.embedding && n.embedding ? { o, n } : null
  }, { timeoutMs: 45000 })
  report.check('two memories with identical text, written 2.5s apart, both stored with embeddings', both.ok, both.ok ? `old ${both.value.o.updated_at} / new ${both.value.n.updated_at}` : pollDetail(both))

  if (both.ok) {
    const order = text => {
      const o = text.indexOf(oldKey)
      const n = text.indexOf(newKey)
      if (o < 0 && n < 0) return 'none'
      if (o < 0) return 'new-only'
      if (n < 0) return 'old-only'
      return o < n ? 'old-first' : 'new-first'
    }
    const judge = (label, orders) => {
      const distinct = [...new Set(orders)]
      report.check(`${label}: ordering is identical across 6 recalls`, distinct.length === 1, `observed ${orders.join(', ')}`)
      report.check(`${label}: the NEWER of two tied memories leads (or is the one shown)`, orders.every(o => o === 'new-first' || o === 'new-only'), `observed ${orders.join(', ')}`)
    }
    const cliOrders = Array.from({ length: 6 }, () => order(cliRecall(bins, A, tieQ).out))
    judge('CLI recall (cloud RPC)', cliOrders)

    const mcpOrders = []
    for (let i = 0; i < 6; i++) mcpOrders.push(order((await mcpRecall(bins, A, tieQ, 5)).text))
    judge('MCP recall, 6 separate agent restarts', mcpOrders)

    const single = await mcp(bins.serverBin, A, Array.from({ length: 6 }, () => toolCall('recall', { query: tieQ, limit: 5 })))
    const singleOrders = single.ok ? single.responses.slice(1).map(r => order(mcpText(r))) : ['server-failed']
    judge('MCP recall, 6 calls inside one agent session', singleOrders)
  }

  // ======================= RETRACTION =======================================
  const retired = async (kind, tool) => {
    const key = `${ctx.fixturePrefix}-${kind}-target`
    const tokn = `${kind}target${s}`
    const text = `The legacy exporter ${tokn} still runs on the old cluster.`
    // Detect presence by KEY, never by a phrase from the query: MCP recall (and the
    // CLI's "No memories found" line) echo the query text back, which would make
    // an absence check fail, or a presence check pass, for the wrong reason.
    const mark = key
    // The query is the memory's own sentence: trigram similarity is computed over
    // the whole value, so a short query built around one rare token scores below
    // the floor (observed 0.29 against unrelated rows) and misses a row that exists.
    const rq = text
    cli(bins.cliBin, A, ['remember', key, text, '--type', 'lesson'])
    const there = await poll(async () => (await cloud(key)) ?? null, { timeoutMs: 45000 })
    // Presence is established with `recall --all` (a plain live-row listing) so the
    // retraction checks below do not depend on ranking. The ranked query is
    // checked separately, with retries, because a brand-new row has been seen to
    // be absent from ranked CLI recall although its cloud row is live and embedded.
    const listed = () => cliRecall(bins, B, '*', ['--all'])
    const allBefore = listed()
    report.check(`${kind}: control — the memory is live in the cloud and in the teammate's full listing before it is retired`, there.ok && allBefore.out.includes(mark), `cloud row: ${JSON.stringify(there.value ? { status: there.value.status, embedded: there.value.embedding != null } : null)}`)
    if (!there.ok || !allBefore.out.includes(mark)) return
    const ranked = await converge(async () => cliRecall(bins, B, rq, ['--limit', '10']), r => r.out.includes(mark), { timeoutMs: 30000, intervalMs: 4000 })
    report.check(`${kind}: control — ranked CLI recall by the teammate finds the memory by its own sentence`, ranked.ok, ranked.ok ? `after ${ranked.attempts} attempt(s)` : `NOT FOUND after ${ranked.attempts} attempts although the row is live and embedded; diagnostics: ${ranked.last.out.split('\n').filter(l => /embedding|warn|error/i.test(l)).join(' | ').slice(0, 300) || 'none'}; first line: ${ranked.last.out.split('\n')[0]}; returned keys: ${(ranked.last.out.match(/tages-e2e-[0-9a-z]+-[a-z0-9-]+/g) || []).map(k => k.replace(ctx.fixturePrefix + '-', '')).join(', ')}`)
    const warmB = await mcpRecall(bins, B, rq) // B's agent caches it
    const warmA = await mcpRecall(bins, A, rq)
    report.check(`${kind}: control — both agents have it cached`, has(warmB.text, mark) && has(warmA.text, mark), `A:${has(warmA.text, mark)} B:${has(warmB.text, mark)}`)

    const act = await mcpOne(bins.serverBin, A, tool, { key }, { graceful: true })
    // archive_memory is Pro-gated by design, and this phase runs it on a
    // paid-plan fixture (set up below, before the first retired() call). A
    // "requires Tages Pro" reply here means the fixture did not take, which is
    // a failure, never a skip with a back-door PATCH.
    const gated = /requires Tages Pro/i.test(act.text)
    report.check(`${kind}: \`${tool}\` runs on the paid-plan fixture (not refused by the tier gate)`, !gated, gated ? `tool replied "${head(act.text, 1)}"` : 'accepted')
    const gone = await poll(async () => {
      const r = await cloud(key)
      return kind === 'archive' ? (r?.status === 'archived' ? true : null) : r ? null : true
    }, { timeoutMs: 40000 })
    report.check(`${kind}: the cloud row ${kind === 'archive' ? 'becomes status=archived' : 'is deleted'} after the owner's agent calls \`${tool}\``, gone.ok, gone.ok ? pollDetail(gone) : `${head(act.text, 1)}; cloud row is ${JSON.stringify((await cloud(key)) && { status: (await cloud(key)).status })}`)

    for (const [who, name] of [[A, 'owner'], [B, 'teammate']]) {
      const r = cliRecall(bins, who, rq)
      const l = cliRecall(bins, who, '*', ['--all'])
      report.check(`${kind}: CLI recall and full listing no longer return it to the ${name}`, !r.out.includes(mark) && !l.out.includes(mark), `ranked: ${r.out.includes(mark)}, listing: ${l.out.includes(mark)}`)
    }
    const o = cli(bins.cliBin, B, ['onboard'])
    report.check(`${kind}: \`tages onboard\` no longer lists it`, !o.out.includes(mark), o.out.includes(mark) ? 'still listed: onboard.ts has no status=live filter' : 'absent')
    const aM = await mcpRecall(bins, A, rq)
    report.check(`${kind}: owner's restarted agent no longer recalls it`, aM.ok && !aM.text.includes(mark), aM.ok ? head(aM.text, 1) : aM.why)
    const bM = await mcpRecall(bins, B, rq)
    report.check(
      `${kind}: teammate's restarted agent (cache held it) no longer recalls it`,
      bM.ok && !bM.text.includes(mark),
      bM.text.includes(mark) ? `STALE CACHE serves a retired memory; ${cacheNote(bM.stderr)}` : head(bM.text, 1),
    )
    const bBrief = await mcpOne(bins.serverBin, B, 'project_brief', {})
    report.check(`${kind}: teammate's \`project_brief\` no longer includes it`, bBrief.ok && !bBrief.text.includes(mark), bBrief.text.includes(mark) ? `still in the brief; ${cacheNote(bBrief.stderr)}` : 'absent')
    const conv = await converge(() => mcpRecall(bins, B, rq), r => r.ok && !r.text.includes(mark), { timeoutMs: 100000 })
    report.check(`${kind}: teammate's agent stops serving it within 100s of restarts`, conv.ok, conv.ok ? `${conv.ms}ms` : `never stopped; per-restart cache log: ${conv.trail.join(' | ')}${kind === 'forget' ? ' (SupabaseSync.hydrate only upserts remote rows; nothing ever deletes a local row the cloud no longer has)' : ''}`)
  }

  // ---- paid-plan fixture for the retraction block ---------------------------
  // `archive_memory` is Pro-gated, and the fixture owner is on the free plan.
  // With the service key (fixture setup only, never an authorization check),
  // put the owner and the fixture project on `team` for the two retired()
  // calls, then restore the saved values so phases 15, 16 and 99 still see the
  // free-plan fixture. These are this run's own test users and project, never a
  // real account. Each MCP call boots a fresh server, which reads
  // `projects.plan` at boot, so no cache sits between the PATCH and the gate.
  const profilePath = `/user_profiles?user_id=eq.${A.userId}`
  const projectPath = `/projects?id=eq.${project.id}`
  const profileCols = 'plan,is_pro,subscription_quantity,subscription_status'
  const savedProfile = (await api.rest(`${profilePath}&select=${profileCols}`)).body?.[0] ?? null
  const savedProject = (await api.rest(`${projectPath}&select=plan`)).body?.[0] ?? null
  try {
    await api.rest(profilePath, { method: 'PATCH', body: { plan: 'team', is_pro: true, subscription_quantity: 5, subscription_status: 'active' } })
    await api.rest(projectPath, { method: 'PATCH', body: { plan: 'team' } })
    const readProfile = (await api.rest(`${profilePath}&select=${profileCols}`)).body?.[0] ?? null
    const readProject = (await api.rest(`${projectPath}&select=plan`)).body?.[0] ?? null
    const paid = readProfile?.plan === 'team' && readProfile?.is_pro === true && readProject?.plan === 'team'
    report.check(
      'paid-plan fixture: the owner and the project read back as `team` before archive runs',
      paid,
      `profile ${JSON.stringify(readProfile && { plan: readProfile.plan, is_pro: readProfile.is_pro })}, project ${JSON.stringify(readProject)}${savedProfile ? '' : ' (no user_profiles row to patch)'}`,
    )
    await retired('archive', 'archive_memory')
    await retired('forget', 'forget')
  } finally {
    if (savedProfile) await api.rest(profilePath, { method: 'PATCH', body: savedProfile })
    if (savedProject) await api.rest(projectPath, { method: 'PATCH', body: savedProject })
    const back = (await api.rest(`${projectPath}&select=plan`)).body?.[0] ?? null
    report.check('paid-plan fixture: the project plan is restored afterwards', !savedProject || back?.plan === savedProject.plan, `project plan now ${back?.plan}, saved ${savedProject?.plan}`)
  }
}
