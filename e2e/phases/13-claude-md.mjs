// Phase 13 — CLAUDE.md: the file every team already has, going in and coming out.
//
// A team adopting Tages does not start from an empty store. They start from a
// CLAUDE.md that is committed to the repo, hand-edited, and read by every agent.
// Three things can go wrong, and each one is a trust-ending event:
//
//   IMPORT   `import_claude_md` must turn the file into typed, shared memories,
//            strip code, not duplicate on re-import, and reach teammates. It
//            writes only to the local SQLite cache and relies on the background
//            flush, so "imported" and "shared" are different claims.
//   EXPORT   `tages export` writes ./CLAUDE.md with fs.writeFileSync and no
//            existence check (export.ts:64). Running it in a repo that already
//            has a hand-written CLAUDE.md destroys the file. It also exports
//            every row regardless of status, and only six of the types.
//   SETUP    `tages link` / `init` write .mcp.json. They must merge into an
//            existing one (other MCP servers!) and must not touch CLAUDE.md or
//            .claude/settings*.json.

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli, mcpOne } from '../lib/cli.mjs'
import { cloneIdentity } from '../lib/identity.mjs'
import { stampOf, has, cliRecall, mcpRecall, converge } from '../lib/surfaces.mjs'

export const id = '13-claude-md'
export const title = '13 · CLAUDE.md — import is shared, export does not destroy, link does not clobber'

// Mirrors import-claude-md.ts generateKey(): first 60 chars, slugified, prefixed.
const slugify = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const keyFor = value => `claude-md-${slugify(value.trim().slice(0, 60))}`
const sha = s => crypto.createHash('sha256').update(s).digest('hex')

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A
  const B = ids.B
  if (!state.joined) {
    report.check('teammate joined before CLAUDE.md interaction is exercised', false, 'phase 04 did not complete')
    return
  }
  const s = stampOf(ctx)
  const asA = { token: A.token }

  const items = {
    conv1: { type: 'convention', value: `Always prefix every fixture identifier with cm${s} so cleanup can find it later.` },
    conv2: { type: 'convention', value: `Use snake_case for every public REST route name in the cm${s} gateway.` },
    arch: { type: 'architecture', value: `The cm${s} ingest worker lives in services/ingest and talks to the queue over NATS.` },
    dec: { type: 'decision', value: `We chose Postgres over DynamoDB for the cm${s} audit log because we need transactional writes.` },
    dont: { type: 'anti_pattern', value: `Do not call the cm${s} billing API from the render path.` },
    never: { type: 'anti_pattern', value: `Never commit the cm${s} signing key material to the repository.` },
  }
  for (const it of Object.values(items)) it.key = keyFor(it.value)
  const codeSentinel = `CODEBLOCK_SENTINEL_${s}`
  const handSentinel = `SENTINEL_HANDWRITTEN_${s}`

  const claudeMd = [
    '# Fixture service',
    '',
    `<!-- ${handSentinel}: written by a human, must survive \`tages export\` -->`,
    '',
    'Intro paragraph before any heading. It is a preamble and is not a rule.',
    '',
    '## Conventions',
    `- ${items.conv1.value}`,
    `- ${items.conv2.value}`,
    '',
    '## Architecture',
    `- ${items.arch.value}`,
    '',
    '```yaml',
    `- ${codeSentinel} this list item sits inside a fenced block and must be stripped`,
    '```',
    '',
    '## Decisions',
    `- ${items.dec.value}`,
    '',
    "## Don't",
    `- ${items.dont.value}`,
    '',
    '## Never',
    `- ${items.never.value}`,
    '',
  ].join('\n')
  const claudePath = path.join(A.work, 'CLAUDE.md')
  fs.writeFileSync(claudePath, claudeMd)

  const cloudRows = async (select = 'id,key,value,type,status,embedding,created_by,updated_by,source') => {
    const r = await api.rest(`/memories?project_id=eq.${project.id}&value=ilike.*cm${s}*&select=${select}`, { as: asA })
    return (Array.isArray(r.body) ? r.body : []).filter(x => x.key.startsWith('claude-md-'))
  }

  // ---- IMPORT ---------------------------------------------------------------
  // graceful: import_claude_md writes dirty rows to SQLite and never calls
  // sync.remoteInsert, so the rows reach Supabase only via the 60s flush or the
  // SIGTERM drain. A real MCP client sends SIGTERM when the session ends.
  const imp = await mcpOne(bins.serverBin, A, 'import_claude_md', { content: fs.readFileSync(claudePath, 'utf-8') }, { graceful: true })
  const m1 = imp.text.match(/Imported (\d+) memories \((\d+) skipped\)/)
  report.check('MCP `import_claude_md` imports every rule in the file (6) and skips none', imp.ok && m1 && +m1[1] === 6 && +m1[2] === 0, imp.ok ? head(imp.text, 1) : imp.why)

  const landed = await poll(async () => ((await cloudRows()).length >= 6 ? await cloudRows() : null), { timeoutMs: 60000, label: 'imported rows reach Supabase' })
  report.check('imported memories reach Supabase (they are shared, not just cached on the importer\'s laptop)', landed.ok, landed.ok ? `${landed.value.length} rows, ${pollDetail(landed)}` : `${pollDetail(landed)} — import-claude-md.ts never calls sync; rows depend on the shutdown flush`)
  if (!landed.ok) {
    report.skip('remaining import checks', 'nothing reached the cloud to inspect')
  } else {
    const rows = landed.value
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
    const wrongType = Object.entries(items).filter(([, it]) => byKey[it.key]?.type !== it.type).map(([n, it]) => `${n}:${byKey[it.key]?.type ?? 'missing'}!=${it.type}`)
    report.check('each rule has the expected claude-md-* key and type (convention / architecture / decision / anti_pattern)', wrongType.length === 0, wrongType.length ? wrongType.join(' ') : `${rows.length} rows, keys and types match`)
    report.check('values are the bullet text, byte for byte', Object.values(items).every(it => byKey[it.key]?.value === it.value), 'compared all 6')
    const leaked = (await api.rest(`/memories?project_id=eq.${project.id}&value=ilike.*${codeSentinel}*&select=key`, { as: asA })).body
    report.check('fenced code is stripped (no memory contains the code-block list item)', Array.isArray(leaked) && leaked.length === 0, leaked?.length ? `leaked into ${leaked.map(l => l.key)}` : 'absent')
    const statuses = [...new Set(rows.map(r => r.status))]
    report.check('RECORDED: imported rows are created status=live, source=import (so they are visible to recall immediately)', statuses.length === 1 && statuses[0] === 'live', `statuses: ${statuses.join(',')}; sources: ${[...new Set(rows.map(r => r.source))].join(',')}`)
    const noEmb = rows.filter(r => r.embedding == null).length
    const embedded = await poll(async () => ((await cloudRows('id,key,embedding')).every(r => r.embedding != null) ? true : null), { timeoutMs: 30000, intervalMs: 3000 })
    report.check('imported memories get embeddings (otherwise paraphrased recall cannot find them)', embedded.ok, embedded.ok ? 'all embedded' : `${noEmb}/${rows.length} rows still have embedding NULL after 30s; import-claude-md.ts never requests one`)
    state.importedIds = Object.fromEntries(rows.map(r => [r.key, r.id]))

    // teammate reads an imported item
    const q = `cm${s} ingest worker services/ingest queue NATS`
    const bCli = await converge(async () => cliRecall(bins, B, q), r => has(r.out, items.arch.key, `cm${s} ingest worker`), { timeoutMs: 30000, intervalMs: 4000 })
    report.check('teammate B recalls an imported rule over the CLI', bCli.ok, head(bCli.last.out, 2))
    const bMcp = await converge(() => mcpRecall(bins, B, q), r => r.ok && r.text.includes(items.arch.key), { timeoutMs: 100000 })
    report.check("teammate B's agent recalls an imported rule over MCP (within 100s of restarts)", bMcp.ok, bMcp.ok ? `after ${bMcp.attempts} restart(s)` : head(bMcp.last?.text ?? '', 2))

    // ---- re-import: skip ----
    const skip = await mcpOne(bins.serverBin, A, 'import_claude_md', { content: claudeMd, strategy: 'skip' }, { graceful: true })
    const m2 = skip.text.match(/Imported (\d+) memories \((\d+) skipped\)/)
    const afterSkip = await cloudRows('id,key,value')
    report.check("re-import with strategy 'skip' creates nothing and skips all 6", m2 && +m2[1] === 0 && +m2[2] === 6 && afterSkip.length === 6, head(skip.text, 1))
    report.check('and the row ids are unchanged (no delete-and-recreate)', afterSkip.every(r => state.importedIds[r.key] === r.id), `${afterSkip.length} rows`)

    // teammate imports the same committed file
    const bImp = await mcpOne(bins.serverBin, B, 'import_claude_md', { content: claudeMd }, { graceful: true })
    const afterB = await cloudRows('id,key,created_by,updated_by')
    const mB = bImp.text.match(/Imported (\d+) memories \((\d+) skipped\)/)
    report.check(
      'a teammate importing the same committed CLAUDE.md creates no duplicate rows and keeps the owner as author',
      afterB.length === 6 && afterB.every(r => r.created_by === A.userId && state.importedIds[r.key] === r.id),
      `${afterB.length} rows, created_by owner: ${afterB.filter(r => r.created_by === A.userId).length}/6, updated_by teammate: ${afterB.filter(r => r.updated_by === B.userId).length}/6`,
    )
    report.check(
      "and strategy 'skip' is judged against the shared store: the teammate's import skips all 6 instead of re-writing them",
      mB && +mB[1] === 0 && +mB[2] === 6,
      `${head(bImp.text, 1)}${mB && +mB[1] > 0 ? ' — skip consults only the importer\'s local cache (import-claude-md.ts getByKey), which is empty or stale on any machine that has not hydrated, so it re-wrote rows another person owns' : ''}`,
    )

    // ---- skip honours the OLD value, overwrite replaces it ----
    const tailOld = 'so cleanup can find it later.'
    const edited = claudeMd.replace(tailOld, 'so cleanup can find it later, and never reuse a prefix across runs.')
    const oldKey = items.conv1.key
    const mark = 'never reuse a prefix across runs'
    await mcpOne(bins.serverBin, A, 'import_claude_md', { content: edited, strategy: 'skip' }, { graceful: true })
    const stillOld = (await cloudRows('key,value')).find(r => r.key === oldKey)
    report.check("control — 'skip' with an edited rule leaves the stored value alone (same key, different text)", stillOld && !stillOld.value.includes(mark), head(stillOld?.value ?? 'missing', 1))
    const ow = await mcpOne(bins.serverBin, A, 'import_claude_md', { content: edited, strategy: 'overwrite' }, { graceful: true })
    const updated = await poll(async () => ((await cloudRows('id,key,value')).find(r => r.key === oldKey)?.value.includes(mark) ? await cloudRows('id,key,value') : null), { timeoutMs: 60000 })
    report.check("strategy 'overwrite' updates the edited rule in the shared store", updated.ok, updated.ok ? head(ow.text, 1) : `${pollDetail(updated)} — ${head(ow.text, 1)}`)
    if (updated.ok) {
      report.check('overwrite keeps ids and leaves the other 5 rules untouched', updated.value.length === 6 && updated.value.every(r => state.importedIds[r.key] === r.id) && Object.values(items).filter(i => i.key !== oldKey).every(i => updated.value.find(r => r.key === i.key)?.value === i.value), `${updated.value.length} rows`)
      const bNew = await converge(async () => cliRecall(bins, B, `cm${s} fixture identifier prefix cleanup`), r => r.out.includes(mark), { timeoutMs: 30000, intervalMs: 4000 })
      report.check('teammate B recalls the OVERWRITTEN text, not the original', bNew.ok && !bNew.last.out.includes(tailOld), head(bNew.last.out, 2))
    }

    // headings inside a fence are not headings
    const fence = ['## Conventions', `- Real rule for cm${s}fence that is long enough to import.`, '```md', '## Example output', `- FENCEHEAD_SENTINEL_${s} sample list item inside a fence`, '```', ''].join('\n')
    await mcpOne(bins.serverBin, A, 'import_claude_md', { content: fence }, { graceful: true })
    const fenceLeak = await api.rest(`/memories?project_id=eq.${project.id}&value=ilike.*FENCEHEAD_SENTINEL_${s}*&select=key,type`, { as: asA })
    // Positive control: the import itself ran, so an absent sentinel means stripped, not rejected.
    const fenceReal = await api.rest(`/memories?project_id=eq.${project.id}&value=ilike.*cm${s}fence*&select=key`, { as: asA })
    report.check('control — the real rule next to the fence was imported', Array.isArray(fenceReal.body) && fenceReal.body.length === 1, `${fenceReal.body?.length ?? 'error'} rows`)
    report.check('a heading-looking line INSIDE a fenced block does not split the section or leak code', Array.isArray(fenceLeak.body) && fenceLeak.body.length === 0, fenceLeak.body?.length ? `leaked as ${fenceLeak.body.map(b => `${b.type}:${b.key}`)} (import-claude-md.ts splits on /^#{2,3}/ before stripping fences)` : 'absent')
  }

  // ---- EXPORT: the hand-written file ----------------------------------------
  fs.writeFileSync(claudePath, claudeMd)
  const original = fs.readFileSync(claudePath, 'utf-8')
  const exp = cli(bins.cliBin, A, ['export'])
  const survivors = fs.readdirSync(A.work).filter(f => fs.statSync(path.join(A.work, f)).isFile() && sha(fs.readFileSync(path.join(A.work, f), 'utf-8')) === sha(original))
  report.check(
    '`tages export` run in a repo with a hand-written CLAUDE.md does not destroy it (refuses, writes elsewhere, or backs up)',
    survivors.length > 0,
    survivors.length ? `original preserved in: ${survivors.join(', ')}` : `DESTROYED: exit ${exp.code}, "${tail(exp.out, 1)}". ./CLAUDE.md no longer contains ${handSentinel}; export.ts:64 is an unconditional fs.writeFileSync`,
  )
  report.check(
    'and the refusal is explicit: exit 1, message names --output and --force',
    exp.code === 1 && /already exists/i.test(exp.out) && /--output/.test(exp.out) && /--force/.test(exp.out),
    `exit ${exp.code}: ${tail(exp.out, 2)}`,
  )
  const expForce = cli(bins.cliBin, A, ['export', '--force'])
  const forced = fs.readFileSync(claudePath, 'utf-8')
  report.check('`tages export --force` does replace the file (with the live rules)', expForce.code === 0 && forced !== original && forced.includes(items.conv2.value), `exit ${expForce.code}`)
  fs.writeFileSync(claudePath, original) // restore for the checks below

  // ---- EXPORT: content fidelity ------------------------------------------------
  const pendKey = `${ctx.fixturePrefix}-export-pending`
  const archKey = `${ctx.fixturePrefix}-export-archived`
  const pendTok = `EXPORTLEAK_PENDING_${s}`
  const archTok = `EXPORTLEAK_ARCHIVED_${s}`
  await api.insert('memories', { project_id: project.id, key: pendKey, value: `Unreviewed guess ${pendTok} about the deploy order.`, type: 'convention', source: 'agent', status: 'pending', confidence: 0.7 }, { as: asA })
  await api.insert('memories', { project_id: project.id, key: archKey, value: `Retired rule ${archTok} about the old deploy order.`, type: 'convention', source: 'manual', status: 'archived', confidence: 1 }, { as: asA })
  const outFile = path.join(ctx.root, 'export-A.md')
  const exp2 = cli(bins.cliBin, A, ['export', '--output', outFile])
  const exported = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf-8') : ''
  report.check('control — `tages export --output` writes a file containing the live imported rules', exp2.code === 0 && exported.includes(items.conv2.value), `exit ${exp2.code}, ${exported.length} bytes`)
  report.check('export omits pending (unreviewed) memories', !exported.includes(pendTok), exported.includes(pendTok) ? 'a PENDING memory was written into the team CLAUDE.md — export.ts selects every status' : 'absent')
  report.check('export omits archived (retired) memories', !exported.includes(archTok), exported.includes(archTok) ? 'an ARCHIVED memory was written into the team CLAUDE.md' : 'absent')
  const expectedAfterEdit = { ...items, conv1: { ...items.conv1, value: items.conv1.value.replace('so cleanup can find it later.', 'so cleanup can find it later, and never reuse a prefix across runs.') } }
  const missing = Object.entries(expectedAfterEdit).filter(([, it]) => !exported.includes(it.value)).map(([n, it]) => `${n}(${it.type})`)
  report.check('round trip: every rule imported from CLAUDE.md comes back out in `tages export`', missing.length === 0, missing.length ? `LOST ON EXPORT: ${missing.join(', ')} — exportAsCLAUDEmd only emits convention/architecture/decision/pattern/lesson/entity` : 'all 6 present')

  // ---- SETUP: link / init must not touch CLAUDE.md or .claude ------------------
  const claudeDir = path.join(A.work, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(echo:*)'] }, e2e: s }, null, 2))
  fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), JSON.stringify({ e2eLocal: s }, null, 2))
  const snap = dir => ({
    claude: fs.existsSync(path.join(dir, 'CLAUDE.md')) ? sha(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')) : null,
    settings: fs.existsSync(path.join(dir, '.claude')) ? fs.readdirSync(path.join(dir, '.claude')).sort().map(f => `${f}:${sha(fs.readFileSync(path.join(dir, '.claude', f), 'utf-8'))}`) : [],
  })
  const before = snap(A.work)
  const relink = cli(bins.cliBin, A, ['link', '--project-id', project.id])
  const after = snap(A.work)
  report.check('re-running `tages link` leaves CLAUDE.md and .claude/settings*.json byte-identical', relink.code === 0 && JSON.stringify(before) === JSON.stringify(after), `exit ${relink.code}; ${JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'CHANGED'}`)

  // A fresh machine whose repo already has other MCP servers configured.
  const B13 = await cloneIdentity(api, B, 'B13', { password: ctx.password, root: ctx.root })
  const other = { command: 'node', args: ['other-server.js'], env: { KEEP: 'me' } }
  fs.writeFileSync(path.join(B13.work, '.mcp.json'), JSON.stringify({ mcpServers: { other, tages: { command: 'stale', args: [] } }, e2eCustomTopLevel: s }, null, 2))
  fs.writeFileSync(path.join(B13.work, 'CLAUDE.md'), original)
  fs.mkdirSync(path.join(B13.work, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(B13.work, '.claude', 'settings.json'), JSON.stringify({ e2e: s }))
  const b13Before = snap(B13.work)
  const join = cli(bins.cliBin, B13, ['link', '--project-id', project.id])
  report.check('a teammate with an existing .mcp.json can still join', join.code === 0, tail(join.out, 2))
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(path.join(B13.work, '.mcp.json'), 'utf-8')) } catch { /* asserted below */ }
  report.check('link MERGES into .mcp.json: the other MCP server entry survives unchanged', JSON.stringify(cfg.mcpServers?.other) === JSON.stringify(other), JSON.stringify(cfg.mcpServers?.other) ?? 'entry missing')
  report.check('link preserves unrelated top-level keys of .mcp.json', cfg.e2eCustomTopLevel === s, String(cfg.e2eCustomTopLevel))
  report.check('and replaces the stale tages entry with one carrying this project id', JSON.stringify(cfg.mcpServers?.tages ?? {}).includes(project.id), JSON.stringify(cfg.mcpServers?.tages ?? {}).slice(0, 140))
  report.check('link does not modify CLAUDE.md or .claude/settings.json in the joining repo', JSON.stringify(snap(B13.work)) === JSON.stringify(b13Before), 'compared sha256 of both')

  // An unparsable .mcp.json must not be overwritten.
  const garbage = '{ "mcpServers": { this is not json'
  fs.writeFileSync(path.join(B13.work, '.mcp.json'), garbage)
  const bad = cli(bins.cliBin, B13, ['link', '--project-id', project.id])
  report.check('link refuses to overwrite an unparsable .mcp.json (and says so)', fs.readFileSync(path.join(B13.work, '.mcp.json'), 'utf-8') === garbage && bad.code !== 0 && /could not parse/i.test(bad.out) && !/\n\s+at /.test(bad.out), `exit ${bad.code}: ${tail(bad.out, 1)}`)

  // init --local, in yet another empty repo, must not write CLAUDE.md either.
  const L = await cloneIdentity(api, B, 'L13', { password: ctx.password, root: ctx.root })
  fs.writeFileSync(path.join(L.work, 'CLAUDE.md'), original)
  const lBefore = snap(L.work)
  const init = cli(bins.cliBin, L, ['init', '--local', '--slug', `${ctx.fixturePrefix}-localinit`])
  report.check('`tages init --local` does not modify an existing CLAUDE.md', init.code === 0 && JSON.stringify(snap(L.work)) === JSON.stringify(lBefore), `exit ${init.code}: ${tail(init.out, 1)}`)
}
