// Phase 04 — INVITE + JOIN: a second person gets onto the project.
//
// This is the leg that has failed most often in this repo's history, and each
// failure was invisible until a real second identity tried it: an RPC signature
// change that broke acceptance, an ESM/CJS defect that crashed `link`, a
// `doctor` that probed only Claude Desktop paths and then advised `tages init`,
// which wedges a joiner into local-only mode.
//
// The one leg no automated suite can cover is the browser OAuth redirect. The
// fixture identities hold genuine Supabase sessions written into auth.json in
// exactly the shape the OAuth flow produces; everything downstream of the
// browser is real.

import { poll, pollDetail, tail } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'
import * as fs from 'fs'

export const id = '04-invite-join'
export const title = '04 · INVITE + JOIN — a second person is admitted to the project'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B

  // ---- owner invites -----------------------------------------------------
  // Admin, not the default Member: is_write_authorized requires owner or admin,
  // and a Member invited by mistake produces a teammate whose writes vanish.
  // Phase 06 proves that distinction; this phase depends on B being admin.
  const invite = await api.insert(
    'team_members',
    { project_id: project.id, email: B.email, role: 'admin', status: 'pending' },
    { as: { token: A.token } },
  )
  report.check('owner can invite a teammate as admin', invite.status < 300, `HTTP ${invite.status}`)

  // ---- teammate accepts --------------------------------------------------
  // Zero-arg by design (migration 0065). The prior two-argument signature let a
  // caller claim an invite addressed to somebody else.
  const accept = await api.rpc('accept_pending_invites', {}, { as: { token: B.token } })
  report.check(
    'teammate accepts their own invite via the zero-arg RPC',
    accept.body === 1 || accept.body === '1',
    `returned ${JSON.stringify(accept.body)} (HTTP ${accept.status})`,
  )

  const repeat = await api.rpc('accept_pending_invites', {}, { as: { token: B.token } })
  report.check(
    'accepting twice is a harmless no-op, not an error or a duplicate membership',
    repeat.body === 0 || repeat.body === '0',
    `second call returned ${JSON.stringify(repeat.body)}`,
  )

  const member = await api.rest(
    `/team_members?project_id=eq.${project.id}&email=eq.${encodeURIComponent(B.email)}&select=status,role,user_id`,
  )
  const m = member.body?.[0]
  report.check(
    'teammate is now an active admin member bound to their user id',
    m?.status === 'active' && m?.role === 'admin' && m?.user_id === B.userId,
    `status=${m?.status} role=${m?.role} user_id_matches=${m?.user_id === B.userId}`,
  )

  // ---- teammate joins from their own machine -----------------------------
  const link = cli(bins.cliBin, B, ['link', '--project-id', project.id])
  report.check('teammate joins with `tages link --project-id`', link.code === 0, tail(link.out, 4))

  const mcpPath = B.mcpConfigPath()
  const hasMcp = fs.existsSync(mcpPath)
  report.check(
    'link writes .mcp.json into the teammate\'s own work repo',
    hasMcp,
    hasMcp ? mcpPath : `absent at ${mcpPath} — the agent in that repo will never load Tages`,
  )

  if (hasMcp) {
    const cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
    report.check('.mcp.json carries the joined project id', JSON.stringify(cfg).includes(project.id))

    const server = cfg.mcpServers?.tages
    const command = server?.command
    const args = server?.args ?? []
    // Either a resolvable local script or an npx invocation of the published
    // package is legitimate; a path that does not exist is not.
    const scriptPath = args.find(a => typeof a === 'string' && a.endsWith('.js'))
    const resolvable = scriptPath ? fs.existsSync(scriptPath) : /npx|@tages\/server/.test(JSON.stringify(server))
    report.check(
      '.mcp.json points at an MCP server that actually resolves on this machine',
      !!command && resolvable,
      `command=${command} target=${scriptPath ?? JSON.stringify(args).slice(0, 120)}`,
    )
  }

  const exclude = `${B.work}/.git/info/exclude`
  const excluded = fs.existsSync(exclude) && fs.readFileSync(exclude, 'utf-8').includes('.mcp.json')
  report.check(
    '.mcp.json is git-excluded (it carries the project id and anon key)',
    excluded,
    excluded ? 'listed in .git/info/exclude' : 'NOT excluded — a teammate will commit project credentials',
  )

  const projectCfg = await poll(() => fs.existsSync(B.projectConfigPath(project.slug)), {
    timeoutMs: 10000,
    label: 'local project config',
  })
  report.check('local project config was written for the teammate', projectCfg.ok, pollDetail(projectCfg))

  // ---- doctor ------------------------------------------------------------
  const doctor = cli(bins.cliBin, B, ['doctor'])
  const mcpLines = doctor.out
    .split('\n')
    .filter(l => /MCP server/i.test(l))
    .join(' | ')
  report.check(
    '`tages doctor` finds the teammate\'s MCP configuration',
    /MCP server config/i.test(doctor.out) && !/MCP server config[^\n]*not found/i.test(doctor.out),
    mcpLines || tail(doctor.out, 3),
  )
  report.check(
    '`tages doctor` does not tell a joined teammate to run `tages init`',
    !/run `?tages init`?/i.test(doctor.out),
    /run `?tages init`?/i.test(doctor.out)
      ? 'doctor advises `tages init`, which drops a joined member into local-only mode and disconnects them from the team'
      : 'no misleading init advice',
  )

  state.joined = true
}
