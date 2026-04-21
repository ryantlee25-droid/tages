import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

// ------------------------------------------------------------
// Cross-package imports from packages/server/src/agents-md/
//
// The CLI tsconfig uses rootDir="../../" (the monorepo root), so relative
// paths three levels up from packages/cli/src/commands/ resolve to the
// server package source.  Vitest's TypeScript resolver handles the .js
// extension aliases at test-time; the compiled dist uses the same relative
// paths after tsc emits everything under dist/.
// ------------------------------------------------------------

/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore
import type { DiffReport, DriftItem, DriftKind, MemoryRow as DiffMemoryRow } from '../../../server/src/agents-md/diff.js'
// @ts-ignore
import type { OwnersMap } from '../../../server/src/agents-md/federate.js'

// Runtime imports (values, not just types)
// We use dynamic patterns so TypeScript's module resolution doesn't fail at
// compile time; the @ts-ignore on the static type-only imports above is enough
// to signal intent.  For values we use a lazy-load wrapper so tests can mock.

async function loadDiffModule() {
  // @ts-ignore
  const mod = await import('../../../server/src/agents-md/diff.js')
  return mod as {
    computeAgentsMdDiff: (filePath: string, fileContent: string, memories: MemoryRow[]) => DiffReport
  }
}

async function loadFederateModule() {
  // @ts-ignore
  const mod = await import('../../../server/src/agents-md/federate.js')
  return mod as {
    readOwnersMap: (projectRoot?: string) => OwnersMap
    writeOwnersMap: (map: OwnersMap, projectRoot?: string) => void
    setOwner: (section: string, team: string, projectRoot?: string) => OwnersMap
    removeOwner: (section: string, projectRoot?: string) => OwnersMap
    ownersFilePath: (projectRoot?: string) => string
  }
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type MemoryRow = {
  key: string
  value: string
  type: string
  file_paths?: string[] | null
  tags?: string[] | null
  confidence?: number | null
}

export interface WriteOptions {
  project?: string
  output?: string
  dryRun?: boolean
  force?: boolean
}

export interface AuditOptions {
  path?: string
  json?: boolean
}

export interface AuditFinding {
  section: string
  severity: 'error' | 'warn' | 'info'
  rule: string
  message: string
}

export interface AuditReport {
  path: string
  findings: AuditFinding[]
  score: number
  passed: boolean
}

export interface DiffOptions {
  file?: string
  project?: string
  json?: boolean
}

export interface FederateOptions {
  section?: string
  team?: string
  list?: boolean
  remove?: boolean
}

// Re-export types from server modules for consumers
export type { DiffReport, DriftItem, DriftKind, OwnersMap }

// ------------------------------------------------------------
// The six canonical AGENTS.md sections
// Per GitHub's analysis of 2,500+ repos:
// github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md
// ------------------------------------------------------------

const SECTION_ORDER = [
  'Commands',
  'Testing',
  'Project structure',
  'Code style',
  'Git workflow',
  'Boundaries',
] as const

type SectionName = (typeof SECTION_ORDER)[number]

// ------------------------------------------------------------
// `tages agents-md write`
// ------------------------------------------------------------

export async function agentsMdWriteCommand(options: WriteOptions): Promise<void> {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('agents-md write requires cloud connection.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data: memories, error } = await supabase
    .from('memories')
    .select('key, value, type, file_paths, tags, confidence')
    .eq('project_id', config.projectId)
    .order('confidence', { ascending: false })
    .returns<MemoryRow[]>()

  if (error) {
    console.error(chalk.red(`Failed to load memories: ${error.message}`))
    process.exit(1)
  }

  // ------------------------------------------------------------
  // Owner-map federation filter
  //
  // If .tages/agents-md-owners.json exists, we read it but cannot yet filter
  // memories by team at query time because the `memories` table schema (as of
  // migration 0053) has no `team_id` column.  The map is loaded here so that:
  //   1. Its presence is acknowledged in the output.
  //   2. When `team_id` is added to the schema, the filter can be wired in
  //      without changing the call-site (just add .eq('team_id', ...) above).
  //
  // NOTE: team_id SCHEMA GAP — see packages/server/src/agents-md/federate.ts
  // for the full explanation.
  // ------------------------------------------------------------
  const federate = await loadFederateModule()
  let ownersMap: OwnersMap = {}
  try {
    ownersMap = federate.readOwnersMap()
  } catch {
    // Not a blocking error — owners file may not exist yet
  }

  const hasFederation = Object.keys(ownersMap).length > 0
  if (hasFederation) {
    console.log(
      chalk.dim(
        `  federation: owner map loaded (${Object.keys(ownersMap).length} section(s) mapped). ` +
          `Memory-level team filtering is pending schema addition of team_id.`,
      ),
    )
  }

  const content = renderAgentsMd(config.slug ?? 'project', memories ?? [])

  if (options.dryRun) {
    process.stdout.write(content)
    return
  }

  const outPath = path.resolve(options.output || 'AGENTS.md')
  if (fs.existsSync(outPath) && !options.force) {
    console.error(chalk.red(`${outPath} exists. Use --force to overwrite.`))
    process.exit(1)
  }

  fs.writeFileSync(outPath, content, 'utf-8')
  console.log(chalk.green(`Wrote ${outPath}`))
  const wordCount = content.trim().split(/\s+/).length
  console.log(chalk.dim(`  ${SECTION_ORDER.length} sections | ~${wordCount} words`))
}

// ------------------------------------------------------------
// Memory → section mapping (heuristic, no LLM)
// ------------------------------------------------------------

export function renderAgentsMd(projectSlug: string, memories: MemoryRow[]): string {
  const grouped = groupMemoriesIntoSections(memories)

  const header =
    `# AGENTS.md\n\n` +
    `_Generated by Tages for \`${projectSlug}\`._\n\n` +
    `This file documents conventions, commands, and boundaries for AI coding agents working in this repository. ` +
    `Tags update it from the project memory graph; run \`tages agents-md write --force\` to regenerate.\n`

  const sections = SECTION_ORDER.map((name) => renderSection(name, grouped[name]))

  return `${header}\n${sections.join('\n')}`
}

function groupMemoriesIntoSections(
  memories: MemoryRow[],
): Record<SectionName, MemoryRow[]> {
  const empty: Record<SectionName, MemoryRow[]> = {
    Commands: [],
    Testing: [],
    'Project structure': [],
    'Code style': [],
    'Git workflow': [],
    Boundaries: [],
  }

  for (const m of memories) {
    const routed = routeMemory(m)
    for (const section of routed) {
      empty[section].push(m)
    }
  }

  return empty
}

export function routeMemory(m: MemoryRow): SectionName[] {
  const tags = (m.tags ?? []).map((t) => t.toLowerCase())
  const k = m.key.toLowerCase()
  const v = m.value.toLowerCase()

  // Explicit tag wins over all heuristics.
  const tagMatch = SECTION_ORDER.find((s) => tags.includes(s.toLowerCase()))
  if (tagMatch) return [tagMatch]

  // Boundaries take precedence for anti_pattern + lesson.
  if (m.type === 'anti_pattern' || m.type === 'lesson' || m.type === 'preference') {
    return ['Boundaries']
  }

  const sections: SectionName[] = []

  if (/\b(git|branch|commit|pr|merge|rebase)\b/i.test(k) || tags.includes('git')) {
    sections.push('Git workflow')
  }
  if (/\b(test|spec|ci|coverage|pytest|vitest|jest)\b/i.test(k) || tags.includes('testing')) {
    sections.push('Testing')
  }
  if (m.type === 'architecture') sections.push('Project structure')
  if (m.type === 'convention') sections.push('Code style')
  if (m.type === 'execution' || m.type === 'pattern') {
    // Routed to Commands by default; also Testing if the key smells like a test command.
    if (!sections.includes('Testing') && /\b(test|spec|ci)\b/i.test(v)) sections.push('Testing')
    else if (!sections.includes('Git workflow')) sections.push('Commands')
  }

  // Fallback: anything else goes to Project structure (background context).
  if (sections.length === 0) sections.push('Project structure')

  return sections
}

function renderSection(name: SectionName, items: MemoryRow[]): string {
  const heading = `## ${name}\n`
  if (items.length === 0) {
    return `${heading}\n_No ${name.toLowerCase()} memories yet. Use \`tages remember\` to add some._\n`
  }

  if (name === 'Boundaries') {
    return `${heading}\n${renderBoundaries(items)}\n`
  }

  if (name === 'Commands' || name === 'Testing' || name === 'Git workflow') {
    return `${heading}\n${renderCommandList(items)}\n`
  }

  return `${heading}\n${renderBulletList(items)}\n`
}

function renderBulletList(items: MemoryRow[]): string {
  return items.map((m) => `- **${m.key}** — ${m.value.trim()}`).join('\n') + '\n'
}

function renderCommandList(items: MemoryRow[]): string {
  const lines: string[] = []
  for (const m of items) {
    const fenced = /\b(pnpm|npm|yarn|bash|python|pytest|git|node|npx)\b/.test(m.value)
    lines.push(`- **${m.key}** — ${m.value.trim()}`)
    if (fenced && !m.value.includes('`')) {
      lines.push('  ```bash')
      lines.push(`  ${m.value.trim().split('\n')[0]}`)
      lines.push('  ```')
    }
  }
  return lines.join('\n') + '\n'
}

function renderBoundaries(items: MemoryRow[]): string {
  const always: MemoryRow[] = []
  const ask: MemoryRow[] = []
  const never: MemoryRow[] = []

  for (const m of items) {
    if (m.type === 'anti_pattern') never.push(m)
    else if (m.type === 'lesson') ask.push(m)
    else always.push(m) // preference + anything tag-routed here
  }

  const lines: string[] = []
  lines.push('**Always do (✅)**')
  lines.push(always.length ? always.map((m) => `- ${m.value.trim()}`).join('\n') : '- _No always-rules yet._')
  lines.push('')
  lines.push('**Ask first (⚠️)**')
  lines.push(ask.length ? ask.map((m) => `- ${m.value.trim()}`).join('\n') : '- _No ask-first rules yet._')
  lines.push('')
  lines.push('**Never do (🚫)**')
  lines.push(never.length ? never.map((m) => `- ${m.value.trim()}`).join('\n') : '- _No never-rules yet._')
  lines.push('')
  return lines.join('\n')
}

// ------------------------------------------------------------
// `tages agents-md audit`
// ------------------------------------------------------------

export async function agentsMdAuditCommand(options: AuditOptions): Promise<void> {
  const filePath = path.resolve(options.path || 'AGENTS.md')

  if (!fs.existsSync(filePath)) {
    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          { path: filePath, exists: false, findings: [], score: 0, passed: false },
          null,
          2,
        ),
      )
    } else {
      console.error(chalk.red(`AGENTS.md not found at ${filePath}`))
    }
    process.exit(1)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const report = runAudit(filePath, content)

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2))
  } else {
    renderAuditReport(report)
  }

  if (!report.passed) process.exit(1)
}

export function runAudit(filePath: string, content: string): AuditReport {
  const findings: AuditFinding[] = []

  // 1. Missing section headers
  for (const section of SECTION_ORDER) {
    const pattern = new RegExp(`^##\\s+${escapeRegex(section)}\\b`, 'im')
    if (!pattern.test(content)) {
      findings.push({
        section,
        severity: section === 'Boundaries' || section === 'Commands' ? 'error' : 'warn',
        rule: 'missing-section',
        message: `No "## ${section}" heading found.`,
      })
    }
  }

  // 2. Vagueness phrases
  const vague = [
    /\b(helpful coding assistant|ai assistant|follow best practices)\b/i,
    /\btest your changes\b/i,
    /\bformat code properly\b/i,
    /\bkeep files organized\b/i,
  ]
  for (const re of vague) {
    const match = content.match(re)
    if (match) {
      findings.push({
        section: 'whole-file',
        severity: 'warn',
        rule: 'vagueness',
        message: `Vague phrase "${match[0]}" detected. Prefer specific, verifiable instructions.`,
      })
    }
  }

  // 3. Missing-commands check: does the Commands section contain any runnable snippet?
  const commandsBlock = extractSection(content, 'Commands')
  if (commandsBlock) {
    const hasRunnable =
      /\b(pnpm|npm|yarn|bash|python|pytest|git|node|npx|cargo|go test)\b/.test(commandsBlock)
    if (!hasRunnable) {
      findings.push({
        section: 'Commands',
        severity: 'error',
        rule: 'missing-commands',
        message: 'Commands section has no runnable invocations (pnpm/npm/pytest/git/etc).',
      })
    }
  }

  // 4. Missing-boundaries check
  const boundariesBlock = extractSection(content, 'Boundaries')
  if (boundariesBlock) {
    const hasTier =
      /(Always|✅)/i.test(boundariesBlock) &&
      /(Never|🚫)/i.test(boundariesBlock)
    if (!hasTier) {
      findings.push({
        section: 'Boundaries',
        severity: 'error',
        rule: 'missing-boundaries',
        message: 'Boundaries section should use the three-tier pattern (Always/Ask/Never, ✅/⚠️/🚫).',
      })
    }
  }

  // 5. Missing tech-stack versions (Project structure)
  const projectBlock = extractSection(content, 'Project structure')
  if (projectBlock) {
    // If project mentions common stacks but never a version number, flag it.
    const mentionsStack = /\b(react|python|node|typescript|go|rust|django|rails|fastapi|next|vue|svelte)\b/i.test(
      projectBlock,
    )
    const hasVersion = /\b\d+(?:\.\d+)?(?:\.\d+)?\b/.test(projectBlock)
    if (mentionsStack && !hasVersion) {
      findings.push({
        section: 'Project structure',
        severity: 'warn',
        rule: 'missing-tech-versions',
        message: 'Project structure mentions a tech stack but no version numbers.',
      })
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length
  const warnCount = findings.filter((f) => f.severity === 'warn').length
  const score = Math.max(0, 100 - errorCount * 20 - warnCount * 5)
  const passed = errorCount === 0

  return { path: filePath, findings, score, passed }
}

function extractSection(content: string, name: string): string | null {
  // `(^|\n)##` matches either a header at the start of the file or one after a newline.
  // The lookahead `(?=\n##\s+|$)` stops at the next `## ` header OR end-of-string.
  // (Do NOT use `\Z` — JavaScript regex does not support it; it matches literal `Z`.)
  const pattern = new RegExp(
    `(^|\\n)##\\s+${escapeRegex(name)}\\b([\\s\\S]*?)(?=\\n##\\s+|$)`,
    'i',
  )
  const m = content.match(pattern)
  return m ? m[2] : null
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderAuditReport(report: AuditReport): void {
  console.log(chalk.bold(`AGENTS.md audit — ${report.path}`))
  console.log('')
  if (report.findings.length === 0) {
    console.log(chalk.green(`✓ No issues found. Score ${report.score}/100.`))
    return
  }
  for (const f of report.findings) {
    const tag =
      f.severity === 'error'
        ? chalk.red('error')
        : f.severity === 'warn'
          ? chalk.yellow('warn')
          : chalk.dim('info')
    console.log(`  ${tag} [${f.section}] ${f.rule}: ${f.message}`)
  }
  console.log('')
  const summary = `${report.findings.filter((f) => f.severity === 'error').length} error(s), ${report.findings.filter((f) => f.severity === 'warn').length} warning(s). Score ${report.score}/100.`
  console.log(report.passed ? chalk.green(`✓ ${summary}`) : chalk.red(`✗ ${summary}`))
}

// ------------------------------------------------------------
// `tages agents-md diff`
// ------------------------------------------------------------

export async function agentsMdDiffCommand(options: DiffOptions): Promise<void> {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('agents-md diff requires cloud connection.'))
    process.exit(1)
  }

  const filePath = path.resolve(options.file || 'AGENTS.md')
  if (!fs.existsSync(filePath)) {
    console.error(chalk.red(`AGENTS.md not found at ${filePath}`))
    process.exit(1)
  }
  const fileContent = fs.readFileSync(filePath, 'utf-8')

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data: memories, error } = await supabase
    .from('memories')
    .select('key, value, type, file_paths, tags, confidence')
    .eq('project_id', config.projectId)
    .eq('status', 'live')
    .order('confidence', { ascending: false })
    .returns<MemoryRow[]>()

  if (error) {
    console.error(chalk.red(`Failed to load memories: ${error.message}`))
    process.exit(1)
  }

  const { computeAgentsMdDiff } = await loadDiffModule()
  const report = computeAgentsMdDiff(filePath, fileContent, memories ?? [])

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2))
  } else {
    renderDiffReport(report)
  }

  if (!report.clean) process.exit(1)
}

function renderDiffReport(report: DiffReport): void {
  console.log(chalk.bold(`AGENTS.md diff — ${report.filePath}`))
  console.log('')
  if (report.clean) {
    console.log(chalk.green('✓ No drift detected. AGENTS.md is in sync with memory.'))
    return
  }

  const kindLabel = (kind: string): string => {
    if (kind === 'stale') return chalk.yellow('stale')
    if (kind === 'missing') return chalk.red('missing')
    if (kind === 'contradicting') return chalk.magenta('contradicting')
    return chalk.dim(kind)
  }

  for (const item of report.items) {
    console.log(`  ${kindLabel(item.kind)} [${item.section}] ${item.memoryKey}`)
    console.log(`    ${item.message}`)
    if (item.fileFragment) {
      console.log(`    ${chalk.dim('file:')} ${chalk.italic(item.fileFragment)}`)
    }
  }

  console.log('')
  console.log(chalk.red(`✗ ${report.driftCount} drift item(s) found. Run \`tages agents-md write --force\` to regenerate.`))
}

// ------------------------------------------------------------
// `tages agents-md federate`
// ------------------------------------------------------------

export async function agentsMdFederateCommand(options: FederateOptions): Promise<void> {
  const federate = await loadFederateModule()

  // --list
  if (options.list) {
    let map: OwnersMap = {}
    try {
      map = federate.readOwnersMap()
    } catch (err) {
      console.error(chalk.red(`Failed to read owners map: ${String(err)}`))
      process.exit(1)
    }

    const filePath = federate.ownersFilePath()
    if (Object.keys(map).length === 0) {
      console.log(chalk.dim(`No section owners defined. File: ${filePath}`))
      return
    }

    console.log(chalk.bold('AGENTS.md section owners'))
    console.log(chalk.dim(`File: ${filePath}`))
    console.log('')
    for (const [section, team] of Object.entries(map)) {
      console.log(`  ${chalk.cyan(section.padEnd(20))} → ${chalk.green(team)}`)
    }
    return
  }

  // --remove --section <X>
  if (options.remove) {
    if (!options.section) {
      console.error(chalk.red('--remove requires --section <name>'))
      process.exit(1)
    }
    try {
      const updated = federate.removeOwner(options.section)
      const remaining = Object.keys(updated).length
      console.log(chalk.green(`Removed "${options.section}" from owners map. ${remaining} mapping(s) remaining.`))
    } catch (err) {
      console.error(chalk.red(`Failed to update owners map: ${String(err)}`))
      process.exit(1)
    }
    return
  }

  // --section <X> --team <Y>
  if (options.section && options.team) {
    try {
      const updated = federate.setOwner(options.section, options.team)
      const filePath = federate.ownersFilePath()
      console.log(chalk.green(`Mapped section "${options.section}" → team "${options.team}"`))
      console.log(chalk.dim(`Owner map: ${filePath} (${Object.keys(updated).length} mapping(s))`))
      console.log(
        chalk.dim(
          'Note: memory-level team filtering requires schema addition of team_id (pending). ' +
            'The owner map is stored and will take effect once the schema is updated.',
        ),
      )
    } catch (err) {
      console.error(chalk.red(`Failed to update owners map: ${String(err)}`))
      process.exit(1)
    }
    return
  }

  // No valid option combination
  console.error(chalk.red('Usage: tages agents-md federate [--section <name> --team <slug>] [--list] [--remove --section <name>]'))
  process.exit(1)
}
