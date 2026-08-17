// Phase 99 — NEGATIVE CONTROLS: prove the suite is capable of failing.
//
// A green run is only evidence if the machinery that produced it can go red.
// This project has shipped test suites whose checks could not fail — an eval
// that ran 65 cells against an empty persona, and a verification pass that
// confirmed seven behaviours it never actually exercised. Both were green.
//
// These controls run last so they exercise the same helpers, in the same
// process, that produced every result above.

import { Report, poll } from '../lib/harness.mjs'
import { execFileSync } from 'child_process'
import { cli } from '../lib/cli.mjs'
import { STRIPPED_ENV } from '../lib/identity.mjs'
import * as fs from 'fs'
import * as path from 'path'

export const id = '99-controls'
export const title = '99 · CONTROLS — the suite can detect a failure'

export async function run(ctx) {
  const { api, report, project, ids, state } = ctx

  // ---- control 1: check() records failures --------------------------------
  const sandbox = new Report()
  const origLog = console.log
  console.log = () => {}
  try {
    sandbox.check('deliberately false', false)
    sandbox.check('deliberately true', true)
  } finally {
    console.log = origLog
  }
  report.check(
    'check() records a false assertion as a failure (the pass/fail machinery works)',
    sandbox.failures.length === 1 && sandbox.results.length === 2,
    `${sandbox.results.length} recorded, ${sandbox.failures.length} failed`,
  )

  // ---- control 2: poll() times out rather than falling through ------------
  const neverTrue = await poll(() => false, { timeoutMs: 2000, intervalMs: 250, label: 'impossible condition' })
  report.check(
    'poll() reports a timeout instead of silently returning success',
    neverTrue.ok === false && neverTrue.attempts > 1,
    `ok=${neverTrue.ok} after ${neverTrue.attempts} attempts in ${neverTrue.ms}ms`,
  )

  // ---- control 3: the database read can come back empty -------------------
  const absent = await api.memoryByKey(project.id, `${ctx.fixturePrefix}-never-written`, 'id', { token: ids.A.token })
  report.check(
    'a lookup for a key that was never written returns zero rows',
    Array.isArray(absent) && absent.length === 0,
    `${Array.isArray(absent) ? absent.length : 'non-array'} rows — if this were non-empty, every durability check above would be meaningless`,
  )

  // ---- control 4: the service key really is stripped from child processes --
  // Phase 08 asserts that an outsider sees nothing. That assertion is worthless
  // if children inherit a service_role key, because service_role bypasses RLS.
  const probe = path.join(ctx.root, 'env-probe.mjs')
  fs.writeFileSync(
    probe,
    `const leaked = ${JSON.stringify(STRIPPED_ENV)}.filter(k => process.env[k] !== undefined)\n` +
      `console.log(JSON.stringify({ leaked }))\n`,
  )
  const probeOut = execFileSync('node', [probe], { env: ids.A.env(), encoding: 'utf-8', timeout: 20000 })
  let leaked = ['<unparsed>']
  try {
    leaked = JSON.parse(probeOut).leaked
  } catch {
    /* leave the sentinel */
  }
  report.check(
    'no RLS-bypassing or project-overriding env var reaches a child process',
    Array.isArray(leaked) && leaked.length === 0,
    Array.isArray(leaked) && leaked.length === 0
      ? `all ${STRIPPED_ENV.length} guarded variables absent`
      : `LEAKED: ${leaked.join(', ')} — the isolation results in phase 08 cannot be trusted`,
  )

  // ---- control 5: children really run in the fixture HOME -----------------
  const homeProbe = execFileSync('node', ['-e', 'console.log(process.env.HOME)'], {
    env: ids.B.env(),
    encoding: 'utf-8',
    timeout: 20000,
  }).trim()
  report.check(
    'child processes run under the fixture HOME, not the operator\'s real one',
    homeProbe === ids.B.home,
    homeProbe === ids.B.home ? homeProbe : `HOME was ${homeProbe}, expected ${ids.B.home}`,
  )

  // ---- control 6: recall has a floor --------------------------------------
  // Re-checked here with a different nonsense query than phase 02 used, so a
  // single lucky string cannot carry the claim.
  const noise = cli(ctx.bins.cliBin, ids.A, ['recall', 'wibbleflux ganthorpe zzzqx murmurationally'])
  const matched = [state.keyA, state.keyB, state.keyAgent].filter(Boolean).some(k => noise.out.includes(k))
  report.check(
    'a second nonsense query also returns none of the fixture memories',
    !matched,
    matched ? 'recall returns fixture memories for arbitrary input — its positive results carry no information' : 'no fixture matches',
  )

  fs.rmSync(probe, { force: true })
}
