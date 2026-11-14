// Phase 16 — ONBOARDING SMOKE: a teammate on a brand new machine.
//
// Everything else in this suite runs on identities that have been used for
// several phases. This one starts from nothing: a fresh $HOME (so a fresh npm
// cache, fresh SQLite, no project config), the admin's credentials, and the
// commands the README tells a new hire to run, in order. Each line below is a
// step where an actual rollout has stalled.

import * as fs from 'fs'
import { head, tail } from '../lib/harness.mjs'
import { cli, mcp, toolCall } from '../lib/cli.mjs'
import { cloneIdentity } from '../lib/identity.mjs'

export const id = '16-onboarding-smoke'
export const title = '16 · ONBOARDING SMOKE — a fresh machine goes from nothing to the team\'s knowledge'

const EXPECTED_TOOLS = ['remember', 'recall', 'forget', 'observe', 'session_end', 'verify_memory', 'pending_memories', 'project_brief', 'import_claude_md']

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  if (!state.joined) {
    report.check('teammate joined before the onboarding smoke test', false, 'phase 04 did not complete')
    return
  }
  const N = await cloneIdentity(api, ids.B, 'B16', { password: ctx.password, root: ctx.root })

  const ver = cli(bins.cliBin, N, ['--version'])
  const reported = ver.stdout.trim().split('\n').pop().trim()
  report.check('`tages --version` matches the artifact under test', ver.code === 0 && reported === bins.cliVersion, `reported "${reported}", expected "${bins.cliVersion}"`)

  const link = cli(bins.cliBin, N, ['link', '--project-id', project.id])
  report.check('`tages link --project-id` joins from the fresh machine', link.code === 0, tail(link.out, 2))

  // Boot exactly what .mcp.json says to run: this is what the agent does. (The
  // harness strips TAGES_PROJECT_* from child env on purpose, so the server
  // resolves the project from the repo's .tages/config.json marker, as it does
  // for a teammate whose .mcp.json env is absent.)
  let cfg = null
  try { cfg = JSON.parse(fs.readFileSync(N.mcpConfigPath(), 'utf-8')).mcpServers?.tages } catch { /* asserted below */ }
  report.check('link wrote a tages entry into .mcp.json', !!cfg?.command, JSON.stringify(cfg ?? {}).slice(0, 160))
  const toolNames = r => (r.responses.at(-1)?.result?.tools ?? []).map(t => t.name)
  if (cfg?.command) {
    const r = await mcp(bins.serverBin, N, [{ method: 'tools/list', params: {} }], { command: cfg.command, args: cfg.args, timeoutMs: 180000 })
    const names = r.ok ? toolNames(r) : []
    const missing = EXPECTED_TOOLS.filter(t => !names.includes(t))
    report.check(
      `the command in .mcp.json (${cfg.command} ${(cfg.args ?? []).join(' ').slice(0, 60)}) boots and lists the Tages tools`,
      r.ok && missing.length === 0,
      r.ok ? `${names.length} tools, boot ${r.bootMs}ms${missing.length ? `, MISSING ${missing}` : ''}` : `${r.why} :: ${r.stderr.slice(0, 200)}`,
    )
  }

  // The published package, byte for byte what a stock `npx` entry downloads.
  const npx = await mcp(bins.serverBin, N, [{ method: 'tools/list', params: {} }], {
    command: 'npx',
    args: ['-y', '@tages/server'],
    timeoutMs: 240000,
  })
  const npxNames = npx.ok ? toolNames(npx) : []
  report.check(
    '`npx -y @tages/server` (published) boots from a clean npm cache and lists tools',
    npx.ok && EXPECTED_TOOLS.every(t => npxNames.includes(t)),
    npx.ok ? `${npxNames.length} tools, boot ${npx.bootMs}ms` : `${npx.why} :: ${npx.stderr.slice(0, 200)}`,
  )

  const doctor = cli(bins.cliBin, N, ['doctor'])
  report.check('`tages doctor` from the linked repo passes with no failures', doctor.code === 0 && !/\bFAIL\b/.test(doctor.out), `exit ${doctor.code}: ${doctor.out.split('\n').filter(l => /FAIL|passed/.test(l)).join(' | ').slice(0, 200)}`)

  const onboard = cli(bins.cliBin, N, ['onboard'])
  const known = [state.keyA, state.keyB, state.keyAgent].filter(Boolean)
  report.check(
    '`tages onboard` prints the project\'s memories, not an empty briefing',
    onboard.code === 0 && /PROJECT BRIEFING/.test(onboard.out) && !/No memories stored yet/.test(onboard.out) && known.some(k => onboard.out.includes(k)),
    `exit ${onboard.code}: ${(onboard.out.match(/\d+ memories across \d+ categories/) || [head(onboard.out, 2)])[0]}`,
  )

  const first = cli(bins.cliBin, N, ['recall', 'stale migration lock deploy gate'])
  report.check('the new hire\'s first `tages recall` returns the owner\'s memory', first.code === 0 && (first.out.includes(state.keyA) || first.out.includes('migration lock')), head(first.out, 2))
}
