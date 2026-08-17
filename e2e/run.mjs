#!/usr/bin/env node
// Tages end-to-end viability suite.
//
// Drives the real CLI and the real MCP server as four separate authenticated
// identities, each with its own $HOME and its own git work repo, against a real
// Supabase project. Nothing is mocked and nothing is imported from source: the
// suite executes the same artifact a teammate installs.
//
// It answers one question in nine phases — can a team actually run on this? —
// by creating memories, retrieving them, correcting them, admitting a second
// person, sharing in both directions, enforcing roles and isolation, retracting
// a fact, and finally proving the suite itself is capable of failing.
//
// Usage:
//   TAGES_E2E_SERVICE_KEY=... TAGES_E2E_ANON_KEY=... node e2e/run.mjs
//
// See e2e/README.md.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

import { Report, color as c } from './lib/harness.mjs'
import { Api, redact } from './lib/api.mjs'
import { createIdentity } from './lib/identity.mjs'
import { resolveCredentials, setCredentials, checkCredentials } from './lib/credentials.mjs'
import { resolveBinaries, latestReleaseTag, localCliVersion, repoRoot } from './lib/install.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const TARGETS = {
  prod: 'wezagdgpvwfywjoxztfs',
  dev: 'ugogdqzhhnuzwgcaovty',
}

const PHASE_MODULES = [
  './phases/01-create.mjs',
  './phases/02-retrieve.mjs',
  './phases/03-update.mjs',
  './phases/04-invite-join.mjs',
  './phases/05-share.mjs',
  './phases/06-roles.mjs',
  './phases/07-persistence.mjs',
  './phases/08-isolation.mjs',
  './phases/09-lifecycle.mjs',
  './phases/10-bidirectional-sync.mjs',
  './phases/99-controls.mjs',
]

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const args = {
    mode: process.env.TAGES_E2E_MODE || 'npm',
    version: process.env.TAGES_E2E_VERSION || 'latest',
    target: process.env.TAGES_E2E_TARGET || 'prod',
    stopAfter: null,
    setCredentials: false,
    checkCredentials: false,
    keep: false,
    json: process.env.TAGES_E2E_JSON || null,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--mode') args.mode = next()
    else if (a === '--version') args.version = next()
    else if (a === '--target') args.target = next()
    else if (a === '--stop-after') args.stopAfter = next()
    else if (a === '--set-credentials') args.setCredentials = true
    else if (a === '--check-credentials') args.checkCredentials = true
    else if (a === '--keep') args.keep = true
    else if (a === '--json') args.json = next()
    else if (a === '-h' || a === '--help') {
      usage()
      process.exit(0)
    } else {
      console.error(`unknown argument: ${a}`)
      usage()
      process.exit(2)
    }
  }
  if (!['npm', 'local'].includes(args.mode)) throw new Error(`--mode must be npm or local, got "${args.mode}"`)
  return args
}

function usage() {
  console.log(`
Tages E2E viability suite

  node e2e/run.mjs [options]

Options
  --mode <npm|local>   npm (default) installs the published packages into a
                       throwaway prefix and tests what a teammate gets.
                       local tests this working tree's dist/ output.
  --version <spec>     npm dist-tag or exact version. Default: latest.
  --target <prod|dev|https://ref.supabase.co>
                       Which Supabase project to run against. Default: prod.
  --stop-after <id>    Run from the beginning through the first phase whose id
                       contains this substring, then stop. Phases build on each
                       other, so there is no way to run one in isolation.
  --keep               Do not delete fixtures. For debugging a failure only.
  --json <path>        Write a machine-readable report.

Credentials
  --set-credentials    Prompt for both keys with echo off, store them in the
                       macOS Keychain, and verify the round trip.
  --check-credentials  Report what is stored, by shape only. Prints no values.

  Do NOT use \`security add-generic-password -w\` interactively: its buffer is
  128 bytes and it truncates a Supabase JWT silently, exit code 0.
  CI uses TAGES_E2E_SERVICE_KEY / TAGES_E2E_ANON_KEY from a secret store.
`)
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv)

  // Credential management runs before anything else and touches no database.
  if (args.setCredentials) process.exit(await setCredentials())
  if (args.checkCredentials) {
    console.log('\nStored Tages E2E credentials (shape only — no values are read out):\n')
    const code = checkCredentials()
    console.log('')
    process.exit(code)
  }

  const report = new Report()
  const startedAt = new Date()

  const supabaseUrl = args.target.startsWith('http')
    ? args.target.replace(/\/$/, '')
    : `https://${TARGETS[args.target] ?? args.target}.supabase.co`

  // A single fixture prefix tags every row and every user this run creates. It
  // is what makes teardown surgical and what the post-run leak assertion looks
  // for. Nothing outside this prefix is ever deleted.
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const fixturePrefix = `tages-e2e-${stamp}`
  const password = `E2E-${stamp}-${Math.random().toString(36).slice(2, 12)}!aA1`

  // Credentials are resolved before any directory, user, or row is created, so
  // a misconfigured run leaves nothing behind to clean up.
  let creds
  try {
    creds = resolveCredentials()
  } catch (err) {
    console.error(c.red(`\n${err.message}`))
    process.exit(2)
  }
  const { serviceKey, anonKey } = creds

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-e2e-'))

  console.log(c.bold('\nTages end-to-end viability suite'))
  console.log(`  target        ${supabaseUrl}${args.target === 'prod' ? c.yellow('  (production)') : ''}`)
  console.log(`  install mode  ${args.mode}${args.mode === 'npm' ? ` @ ${args.version}` : ''}`)
  console.log(`  fixtures      ${fixturePrefix}`)
  console.log(`  workspace     ${root}`)
  console.log(`  credentials   service_role from ${creds.source.service}, anon from ${creds.source.anon}`)

  // ---- preflight, before anything is created ----------------------------
  report.startPhase('00 · PREFLIGHT — refuse to run a suite that cannot prove anything')

  const api = new Api(supabaseUrl, anonKey, serviceKey)

  const health = await api.raw('/auth/v1/settings')
  report.check('Supabase target is reachable', health.status < 500, `HTTP ${health.status} from ${supabaseUrl}`)

  const adminProbe = await api.rest('/projects?select=id&limit=1')
  report.check(
    'the supplied service key has admin access to this project',
    adminProbe.status < 300,
    adminProbe.status < 300 ? 'ok' : `HTTP ${adminProbe.status} — key is wrong, rotated, or from a different project`,
  )
  // Every preflight abort removes the scratch workspace. Nothing was created in
  // the database yet, so exiting here must leave no trace on disk either.
  const abort = code => {
    report.summary()
    fs.rmSync(root, { recursive: true, force: true })
    process.exit(code)
  }

  if (adminProbe.status >= 300) abort(2)

  let bins
  try {
    bins = resolveBinaries(args.mode, { version: args.version, installRoot: path.join(root, 'install') })
  } catch (err) {
    report.check('CLI and MCP server binaries resolve', false, err.message)
    abort(2)
  }
  report.check('CLI and MCP server binaries resolve and exist on disk', true, `cli=${bins.cliBin}`)

  const releaseTag = latestReleaseTag()
  const treeVersion = localCliVersion()
  console.log(
    `  under test    @tages/cli ${bins.cliVersion} · @tages/server ${bins.serverVersion}` +
      `${releaseTag ? ` · latest GitHub release ${releaseTag}` : ''}${treeVersion ? ` · working tree ${treeVersion}` : ''}`,
  )
  if (args.mode === 'npm' && releaseTag && bins.cliVersion && !releaseTag.includes(bins.cliVersion)) {
    report.check(
      'the published CLI matches the latest GitHub release',
      false,
      `npm has ${bins.cliVersion} but the latest release is ${releaseTag} — the team would install a different build than the one you tagged`,
    )
  } else {
    report.check(
      'the artifact under test is identified',
      true,
      `@tages/cli ${bins.cliVersion}${releaseTag ? `, latest release ${releaseTag}` : ''}`,
    )
  }

  // ---- fixtures ----------------------------------------------------------
  const ids = {}
  const project = { id: null, slug: `${fixturePrefix}-project` }
  const state = { leakedKeys: [], extraInvites: [] }
  let cleanupRan = false

  const cleanup = async () => {
    if (cleanupRan) return
    cleanupRan = true
    if (args.keep) {
      console.log(c.yellow(`\n--keep set: fixtures retained. project=${project.id} workspace=${root}`))
      console.log(c.yellow('Delete them manually when you are done; they are live rows in the target database.'))
      return
    }
    report.startPhase('ZZ · TEARDOWN — leave the database exactly as it was found')
    try {
      if (project.id) {
        for (const table of ['memory_chunks', 'memory_versions', 'memories', 'team_members']) {
          await api.rest(`/${table}?project_id=eq.${project.id}`, { method: 'DELETE' })
        }
        await api.rest(`/projects?id=eq.${project.id}`, { method: 'DELETE' })
      }
      for (const identity of Object.values(ids)) {
        if (identity?.userId) await api.deleteUser(identity.userId)
      }

      // The leak assertion. Teardown that is not verified is a hope.
      const leftProject = project.id ? await api.rest(`/projects?id=eq.${project.id}&select=id`) : { body: [] }
      const leftMembers = project.id
        ? await api.rest(`/team_members?project_id=eq.${project.id}&select=id`)
        : { body: [] }
      const leftMemories = project.id ? await api.rest(`/memories?project_id=eq.${project.id}&select=id`) : { body: [] }
      const counts = {
        projects: leftProject.body?.length ?? '?',
        team_members: leftMembers.body?.length ?? '?',
        memories: leftMemories.body?.length ?? '?',
      }
      const clean = Object.values(counts).every(n => n === 0)
      report.check(
        'no fixture rows remain in the target database',
        clean,
        clean
          ? 'projects 0, team_members 0, memories 0'
          : `LEFTOVER FIXTURES: ${JSON.stringify(counts)} — delete them manually (prefix ${fixturePrefix})`,
      )
      if (state.leakedKeys.length) {
        console.log(c.yellow(`  note: these keys were expected to be absent but were written: ${state.leakedKeys.join(', ')}`))
      }
    } catch (err) {
      report.check('teardown completed without error', false, redact(err.message))
    } finally {
      try {
        fs.rmSync(root, { recursive: true, force: true })
      } catch {
        /* a locked SQLite handle is not worth failing the run over */
      }
    }
  }

  // Teardown must survive an unhandled crash mid-suite. Without this, a throw
  // in phase 05 leaves fixture users and a fixture project in the target
  // database with nothing pointing at them.
  const onSignal = async () => {
    await cleanup()
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    // Sweep residue from any earlier run that died where teardown could not
    // run — a SIGKILL, a power loss, a killed terminal. The finally block and
    // the SIGINT/SIGTERM handlers cover everything else, but nothing can catch
    // SIGKILL, so without this a hard kill leaves fixture users in the target
    // auth store permanently. Scoped strictly to the `tages-e2e-` prefix and to
    // projects older than an hour, so it can never touch a real project or a
    // concurrently running suite.
    report.startPhase('00a · SWEEP — remove fixtures orphaned by an earlier hard kill')
    const cutoff = new Date(Date.now() - 3600_000).toISOString()
    const orphans = await api.rest(
      `/projects?slug=like.tages-e2e-*&created_at=lt.${cutoff}&select=id,slug,created_at`,
    )
    const stale = Array.isArray(orphans.body) ? orphans.body : []
    for (const p of stale) {
      for (const table of ['memory_chunks', 'memory_versions', 'memories', 'team_members']) {
        await api.rest(`/${table}?project_id=eq.${p.id}`, { method: 'DELETE' })
      }
      await api.rest(`/projects?id=eq.${p.id}`, { method: 'DELETE' })
    }
    report.check(
      'no fixtures orphaned by earlier runs remain',
      true,
      stale.length ? `swept ${stale.length}: ${stale.map(p => p.slug).join(', ').slice(0, 200)}` : 'none found',
    )

    report.startPhase('00b · FIXTURES — five real identities, five isolated machines')
    // A owner · B admin teammate · C outsider · D read-only member ·
    // E the seat-limit overflow, who must never be able to take a seat.
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      ids[label] = await createIdentity(api, label, { emailPrefix: fixturePrefix, password, root })
    }
    report.check(
      'five isolated identities created (owner, admin, outsider, read-only member, seat overflow)',
      Object.keys(ids).length === 5,
      Object.values(ids)
        .map(i => `${i.label}=${i.userId.slice(0, 8)}`)
        .join(' '),
    )

    const created = await api.insert('projects', {
      slug: project.slug,
      name: 'Tages E2E viability run',
      owner_id: ids.A.userId,
    })
    project.id = created.body?.[0]?.id ?? null
    report.check(
      'a fixture project is created and owned by identity A',
      !!project.id,
      project.id ? `${project.slug} (${project.id})` : `HTTP ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`,
    )
    if (!project.id) throw new Error('fixture project could not be created; aborting before any phase runs')

    const ctx = { api, report, bins, project, ids, state, root, fixturePrefix, args }

    // ---- phases ----------------------------------------------------------
    for (const modPath of PHASE_MODULES) {
      const mod = await import(path.join(HERE, modPath))
      report.startPhase(mod.title)
      try {
        await mod.run(ctx)
      } catch (err) {
        // A phase that throws is a failure, not a reason to abandon the run:
        // later phases still carry information, and teardown must still happen.
        report.check(`${mod.id} completed without an unhandled error`, false, redact(err.stack || err.message))
      }
      if (args.stopAfter && mod.id.includes(args.stopAfter)) {
        console.log(c.yellow(`\n--stop-after ${args.stopAfter}: stopping after ${mod.id}; later phases did not run.`))
        break
      }
    }
  } finally {
    await cleanup()
  }

  // ---- report ------------------------------------------------------------
  const ok = report.summary()

  const jsonPath = args.json || path.join(HERE, 'results', `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`)
  report.writeJson(jsonPath, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    target: supabaseUrl,
    targetName: args.target,
    mode: args.mode,
    cliVersion: bins.cliVersion,
    serverVersion: bins.serverVersion,
    latestReleaseTag: releaseTag,
    workingTreeCliVersion: treeVersion,
    fixturePrefix,
  })
  console.log(c.dim(`report: ${path.relative(repoRoot(), jsonPath)}`))

  process.exit(ok ? 0 : 1)
}

main().catch(err => {
  console.error(c.red(`\nfatal: ${redact(err.stack || err.message)}`))
  process.exit(2)
})
