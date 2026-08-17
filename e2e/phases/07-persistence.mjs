// Phase 07 — PERSISTENCE: the memory lives on the server, not in one laptop's
// SQLite file.
//
// Everything up to here could be satisfied by a local cache that happens to be
// warm. Wiping the cache and recalling again is the only assertion that
// distinguishes "stored" from "cached", and it is exactly the scenario of a new
// laptop, a fresh clone, or a teammate onboarding next month.
//
// This phase also pins a known limitation rather than working around it: CLI
// recall queries Supabase directly and sees new data immediately, while the MCP
// server hydrates once at startup, so an agent must be restarted to see a
// teammate's write. That asymmetry is documented to the team; if it ever gets
// worse, this phase is what notices.

import { poll, pollDetail, head } from '../lib/harness.mjs'
import { cli, mcp, mcpText } from '../lib/cli.mjs'
import * as fs from 'fs'

export const id = '07-persistence'
export const title = '07 · PERSISTENCE — memories survive a wiped machine, not just a warm cache'

export async function run(ctx) {
  const { report, bins, project, ids, state } = ctx
  const B = ids.B

  if (!state.joined) {
    report.check('teammate joined before persistence is exercised', false, 'phase 04 did not complete')
    return
  }

  // ---- cold cache --------------------------------------------------------
  const cachePath = B.cachePath(project.slug)
  const hadCache = fs.existsSync(cachePath)
  report.check(
    'a local SQLite cache exists before the wipe (so the wipe proves something)',
    hadCache,
    hadCache ? cachePath : `no cache at ${cachePath} — the cold-start assertion below would pass vacuously`,
  )

  const removed = B.wipeLocalState(project.slug)
  report.check('local cache removed to simulate a new machine', removed.length > 0, `removed: ${removed.join(', ') || 'nothing'}`)

  const coldRecall = cli(bins.cliBin, B, ['recall', 'stale migration lock deploy gate'])
  report.check(
    "after a full local wipe, the teammate still recalls the owner's memory (it is genuinely server-side)",
    coldRecall.out.includes(state.keyA) || coldRecall.out.includes(state.markerNew),
    head(coldRecall.out, 4),
  )
  report.check(
    'the cold recall returns the CURRENT value, not a resurrected stale one',
    coldRecall.out.includes(state.markerNew) && !coldRecall.out.includes(state.markerOld),
    coldRecall.out.includes(state.markerOld) ? 'stale text came back from the server' : 'current value',
  )

  // ---- cold agent start ---------------------------------------------------
  const coldMcp = await mcp(bins.serverBin, B, [
    { method: 'tools/call', params: { name: 'recall', arguments: { query: 'stale migration lock deploy gate', limit: 5 } } },
  ])
  const coldText = coldMcp.ok ? mcpText(coldMcp.responses.at(-1)) : ''
  report.check(
    'a freshly started MCP server hydrates from the cloud and answers',
    coldMcp.ok,
    coldMcp.ok ? `boot ${coldMcp.bootMs}ms` : `${coldMcp.why} :: ${coldMcp.stderr.slice(0, 200)}`,
  )
  report.check(
    "the agent on a wiped machine still receives the team's memory",
    coldText.includes(state.keyA) || coldText.includes(state.markerNew),
    head(coldText, 3) || 'no content',
  )

  // ---- propagation to a running agent -------------------------------------
  // Documented behaviour: sync is push-only and hydration happens at startup,
  // so a memory written after an agent booted is not visible to it until
  // restart. Pinning it here means a regression that makes propagation *worse*
  // (e.g. not visible even after restart) fails the suite.
  const lateKey = `${ctx.fixturePrefix}-written-after-boot`
  const lateValue = 'The nightly index rebuild starts at 02:15 UTC and holds an advisory lock for about four minutes.'
  cli(bins.cliBin, ids.A, ['remember', lateKey, lateValue, '--type', 'lesson'])

  const lateInCloud = await poll(
    async () => {
      const rows = await ctx.api.memoryByKey(project.id, lateKey, 'id', { token: ids.A.token })
      return rows.length === 1 ? rows[0] : null
    },
    { timeoutMs: 45000, label: 'late memory reaches Supabase' },
  )
  report.check('a memory written after the teammate booted reaches the cloud', lateInCloud.ok, pollDetail(lateInCloud))
  if (lateInCloud.ok) state.lateKey = lateKey

  const afterRestart = await mcp(bins.serverBin, B, [
    { method: 'tools/call', params: { name: 'recall', arguments: { query: 'nightly index rebuild advisory lock', limit: 5 } } },
  ])
  const afterText = afterRestart.ok ? mcpText(afterRestart.responses.at(-1)) : ''
  report.check(
    'restarting the agent surfaces a teammate memory written after the previous boot',
    afterText.includes(lateKey) || afterText.includes('02:15 UTC'),
    afterText.includes(lateKey) || afterText.includes('02:15 UTC')
      ? 'visible after restart, as documented'
      : `NOT visible even after a restart — this is worse than the documented limitation. ${head(afterText, 3)}`,
  )

  const cliSeesLate = cli(bins.cliBin, B, ['recall', 'nightly index rebuild advisory lock'])
  report.check(
    'CLI recall sees a fresh teammate write without any restart (it queries the server directly)',
    cliSeesLate.out.includes(lateKey) || cliSeesLate.out.includes('02:15 UTC'),
    head(cliSeesLate.out, 3),
  )
}
