// Phase 15 — SESSION LONGEVITY: a login keeps working after the agent has run.
//
// PR #79's bug. Supabase rotates the refresh token on every refresh and kills
// the previous one. The long-lived MCP server refreshed on its own, kept the
// result in memory, and never wrote the rotation back to
// ~/.config/tages/auth.json, which the CLI shares. The CLI then presented a
// refresh token that had already been spent and the login was dead about an
// hour after `tages login`. It stayed dead until a manual re-login, and the
// CLI hid it: `tages recall` printed "No memories found" and exited 0.
//
// SIMULATION. We cannot wait an hour. We forge the on-disk access token with an
// `exp` in the past (the signature is irrelevant: supabase-js only decodes it
// to decide whether to refresh) and keep the real refresh token R0. The MCP
// server's setSession() then spends R0 at boot, which is the exact
// "first rotation" the fix comments describe. A fixed build has written R1 to
// disk afterwards; a broken one still holds the spent R0. See the note before
// the CLI checks for why that on-disk comparison, not a CLI failure, is the
// discriminating assertion in a few-minute test.
//
// Everything runs on a CLONE of identity B (fresh $HOME, independent session
// lineage), so burning a session cannot poison phases 01-11 and 99.

import * as fs from 'fs'
import { head, tail } from '../lib/harness.mjs'
import { cli, mcpOne } from '../lib/cli.mjs'
import { cloneIdentity } from '../lib/identity.mjs'

export const id = '15-session-longevity'
export const title = '15 · SESSION LONGEVITY — the login survives the agent refreshing it, and dies loudly when dead'

const b64url = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

/** An access token that decodes fine and is expired. Unsigned on purpose. */
function forgeExpired(realToken) {
  const [h, p] = realToken.split('.')
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
  const now = Math.floor(Date.now() / 1000)
  return `${h}.${b64url({ ...payload, iat: now - 7200, exp: now - 3600 })}.${b64url('forged-signature')}`
}

const readAuth = who => JSON.parse(fs.readFileSync(who.authPath(), 'utf-8'))
const writeAuth = (who, a) => fs.writeFileSync(who.authPath(), JSON.stringify(a, null, 2), { mode: 0o600 })

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  if (!state.joined) {
    report.check('teammate joined before session longevity is exercised', false, 'phase 04 did not complete')
    return
  }

  // ---- 1. the agent rotates the token; the CLI must still work ---------------
  const M = await cloneIdentity(api, ids.B, 'B15', { password: ctx.password, root: ctx.root })
  const link = cli(bins.cliBin, M, ['link', '--project-id', project.id])
  report.check('a second machine for the admin joins the project', link.code === 0, tail(link.out, 2))
  const base = cli(bins.cliBin, M, ['status'])
  report.check('control — `tages status` works on the fresh session', base.code === 0 && base.out.includes(project.slug), head(base.out, 2))

  const a0 = readAuth(M)
  const R0 = a0.refreshToken
  writeAuth(M, { ...a0, accessToken: forgeExpired(a0.accessToken) })

  const agent = await mcpOne(bins.serverBin, M, 'recall', { query: 'stale migration lock deploy gate', limit: 3 })
  report.check(
    'the MCP server boots on an expired access token and serves a recall (it refreshes the session itself)',
    agent.ok && !/session expired/i.test(agent.stderr),
    agent.ok ? head(agent.text, 1) : agent.why,
  )

  const a1 = readAuth(M)
  const rotated = a1.refreshToken !== R0
  report.check(
    'the server that spent the refresh token WROTE THE ROTATED ONE to auth.json',
    rotated,
    rotated
      ? 'auth.json now holds a different refresh token than the one the server spent'
      : 'auth.json still holds the refresh token the server already spent: the rotation was kept in memory and lost when the agent exited (no persistSessionOnRefresh)',
  )

  // WHAT THESE CLI CHECKS CAN AND CANNOT PROVE. Measured against this Supabase
  // project: a spent refresh token R0 is still accepted 105s later, as long as
  // its child R1 has not itself been spent. One server boot spends R0 once, so
  // the pre-fix CLI keeps working here even though auth.json is stale. The
  // production death needs a SECOND rotation (the server's hourly tick spending
  // R1), which cannot be provoked in minutes. So the discriminating assertion is
  // the on-disk one above (did the spender write the replacement back?); the CLI
  // checks below guard the user-visible outcome and pass on both builds.
  const notDead = o => !/session (has )?expired|not signed in|tages login/i.test(o)
  const recall = cli(bins.cliBin, M, ['recall', 'stale migration lock deploy gate'])
  report.check(
    'after the agent refreshed, `tages recall` still returns the team\'s memories (not "No memories found" with exit 0)',
    recall.code === 0 && notDead(recall.out) && (recall.out.includes(state.keyA) || recall.out.includes('migration lock')),
    `exit ${recall.code}: ${head(recall.out, 2)}`,
  )
  const status = cli(bins.cliBin, M, ['status'])
  report.check('after the agent refreshed, `tages status` is authenticated and shows the project', status.code === 0 && notDead(status.out) && status.out.includes(project.slug), `exit ${status.code}: ${head(status.out, 2)}`)
  const team = cli(bins.cliBin, M, ['team', 'list'])
  report.check('after the agent refreshed, `tages team list` lists the team', team.code === 0 && notDead(team.out) && !/no team members/i.test(team.out), `exit ${team.code}: ${head(team.out, 2)}`)
  const onboard = cli(bins.cliBin, M, ['onboard'])
  report.check('after the agent refreshed, `tages onboard` prints a briefing', onboard.code === 0 && notDead(onboard.out) && /PROJECT BRIEFING/.test(onboard.out), `exit ${onboard.code}: ${head(onboard.out, 2)}`)

  // ---- 2. a GENUINELY dead session must fail loudly ----------------------------
  const D = await cloneIdentity(api, ids.B, 'B15dead', { password: ctx.password, root: ctx.root })
  cli(bins.cliBin, D, ['link', '--project-id', project.id])
  const ad = readAuth(D)
  writeAuth(D, { ...ad, accessToken: forgeExpired(ad.accessToken), refreshToken: 'not-a-real-refresh-token' })

  const loud = (label, args) => {
    const r = cli(bins.cliBin, D, args)
    const clear = /expired|log ?in|not signed in/i.test(r.out)
    report.check(
      `dead session: \`tages ${label}\` exits non-zero with a message that says to log in`,
      r.code !== 0 && clear,
      r.code !== 0 && clear ? `exit ${r.code}: ${head(r.out, 1)}` : `exit ${r.code} and said: "${head(r.out, 2)}" — a dead login looks like an empty project`,
    )
  }
  loud('recall', ['recall', 'stale migration lock deploy gate'])
  loud('status', ['status'])
  loud('team list', ['team', 'list'])
  loud('onboard', ['onboard'])
  // Named in the PR as not yet covered ("29 other commands"): the review queue
  // is the core of the new-team workflow, so it is held to the same standard.
  loud('pending', ['pending'])

  // Signed out is the other way to be anonymous.
  const O = await cloneIdentity(api, ids.B, 'B15out', { password: ctx.password, root: ctx.root })
  cli(bins.cliBin, O, ['link', '--project-id', project.id])
  cli(bins.cliBin, O, ['logout'])
  const out = cli(bins.cliBin, O, ['team', 'list'])
  report.check(
    'signed out: `tages team list` exits non-zero and says to log in',
    out.code !== 0 && /log ?in|not signed in/i.test(out.out),
    `exit ${out.code}: ${head(out.out, 2)}`,
  )
}
