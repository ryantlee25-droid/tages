import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

interface BriefOptions {
  project?: string
  task?: string
  budget?: string
  force?: boolean
  output?: string
  check?: boolean
}

const DEFAULT_BUDGET = 3000  // tokens (~2k words)
const STALE_HOURS = 4        // regenerate if older than this AND git has changes

/**
 * Get the default brief file path for a project.
 */
function getBriefPath(projectRoot: string): string {
  return path.join(projectRoot, '.tages', 'brief.md')
}

/**
 * Find the project root by walking up from cwd looking for .git.
 */
function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
}

/**
 * Check if the brief file is fresh enough to skip regeneration.
 * Returns true if the brief is fresh (no regeneration needed).
 *
 * Fresh = file exists AND (no git changes since file was last modified OR file is < STALE_HOURS old with no diff)
 */
function isBriefFresh(briefPath: string): boolean {
  if (!fs.existsSync(briefPath)) return false

  const stat = fs.statSync(briefPath)
  const ageMs = Date.now() - stat.mtimeMs
  const ageHours = ageMs / (1000 * 60 * 60)

  // If very recent (< 1 hour), always fresh
  if (ageHours < 1) return true

  // Check if there are git changes since the brief was generated
  const briefTime = stat.mtime.toISOString()
  try {
    const diff = execSync(`git log --oneline --since="${briefTime}" 2>/dev/null`, {
      encoding: 'utf-8',
      cwd: path.dirname(briefPath),
    }).trim()

    // No commits since brief was generated — still fresh
    if (!diff) return true

    // There are commits, but if brief is still within STALE_HOURS, it's okay
    if (ageHours < STALE_HOURS) return true

    // Stale: old + git changes exist
    return false
  } catch {
    // git not available or not a repo — use age only
    return ageHours < STALE_HOURS
  }
}

/**
 * Generate the brief content from project memories.
 *
 * Structure (priority order):
 *  1. STOP: Gotchas — imperative rules from anti_pattern + lesson
 *  2. Integration Recipes — step-by-step wiring from pattern + execution
 *  3. Conventions — terse rules with auto-highlighted code
 *  4. Architecture — system overview
 *  5. Decisions — rationale
 *  6. Remaining types
 */
async function generateBrief(
  config: ReturnType<typeof loadProjectConfig> & {},
  task?: string,
  budget: number = DEFAULT_BUDGET,
): Promise<string> {
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: memories } = await supabase
    .from('memories')
    .select('key, value, type, file_paths, confidence')
    .eq('project_id', config.projectId)
    .order('confidence', { ascending: false })

  if (!memories || memories.length === 0) {
    return '# Project Brief\n\nNo memories stored yet.\n'
  }

  // Group by type
  const grouped: Record<string, typeof memories> = {}
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }

  const sections: string[] = []
  let estimatedTokens = 0

  const header = `# Project Brief: ${config.slug}\n_Tages context — ${memories.length} memories. Follow these rules._\n`
  sections.push(header)
  estimatedTokens += estimateTokens(header)

  // 1. GOTCHAS — anti_pattern + lesson as imperative rules
  const gotchaItems = [...(grouped.anti_pattern || []), ...(grouped.lesson || [])]
  if (gotchaItems.length > 0) {
    const section = formatImperative('STOP — Read Before Coding', gotchaItems)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // 2. INTEGRATION RECIPES — execution + pattern as step-by-step
  const recipeItems = [...(grouped.execution || []), ...(grouped.pattern || [])]
  if (recipeItems.length > 0) {
    const section = formatRecipes('Integration Recipes', recipeItems)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // 3. CONVENTIONS — terse rules with code highlighting
  if (grouped.convention) {
    const section = formatConventions('Conventions', grouped.convention)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // 4. ARCHITECTURE
  if (grouped.architecture) {
    const section = formatDefault('Architecture', grouped.architecture)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // 5. DECISIONS
  if (grouped.decision) {
    const section = formatDefault('Decisions', grouped.decision)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // 6. Remaining types
  const covered = new Set(['anti_pattern', 'lesson', 'execution', 'pattern', 'convention', 'architecture', 'decision'])
  for (const [type, items] of Object.entries(grouped)) {
    if (covered.has(type)) continue
    const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const section = formatDefault(label, items)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  if (task) {
    const taskSection = `\n## Current Task\n${task}\n`
    estimatedTokens = appendIfBudget(sections, taskSection, estimatedTokens, budget)
  }

  sections.push(`\n---\n_${memories.length} memories | ~${estimatedTokens} tokens | Generated ${new Date().toISOString()}_\n`)

  return sections.join('\n')
}

type MemoryRow = { key: string; value: string; file_paths?: string[] | null }

function formatImperative(title: string, items: MemoryRow[]): string {
  const lines = [`## ${title}\n`]
  for (const item of items) {
    lines.push(`- **${item.key}**: ${item.value}`)
    if (item.file_paths?.length) {
      lines.push(`  → \`${item.file_paths.join('`, `')}\``)
    }
  }
  return lines.join('\n') + '\n'
}

function formatRecipes(title: string, items: MemoryRow[]): string {
  const lines = [`## ${title}\n`]
  for (const item of items) {
    lines.push(`### ${item.key}`)
    const value = item.value
    if (value.includes('→') || value.includes('1.') || value.includes(' then ')) {
      lines.push(value)
    } else {
      lines.push(`- ${value}`)
    }
    if (item.file_paths?.length) {
      lines.push(`_Touch: \`${item.file_paths.join('`, `')}\`_`)
    }
    lines.push('')
  }
  return lines.join('\n') + '\n'
}

function formatConventions(title: string, items: MemoryRow[]): string {
  const lines = [`## ${title}\n`]
  for (const item of items) {
    const value = highlightCodePatterns(item.value)
    lines.push(`- **${item.key}**: ${value}`)
    if (item.file_paths?.length) {
      lines.push(`  → \`${item.file_paths.join('`, `')}\``)
    }
  }
  return lines.join('\n') + '\n'
}

function formatDefault(title: string, items: MemoryRow[]): string {
  const lines = [`## ${title}\n`]
  for (const item of items) {
    lines.push(`- **${item.key}**: ${item.value}`)
    if (item.file_paths?.length) {
      lines.push(`  → \`${item.file_paths.join('`, `')}\``)
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * Detect code-like tokens in text and wrap in backticks.
 * Matches: file paths, function calls, HTML-like tags, env vars.
 */
function highlightCodePatterns(text: string): string {
  return text
    .replace(/(?<![`\w])([a-zA-Z_][a-zA-Z0-9_]*(?:\/[a-zA-Z0-9_.*-]+)+\.[a-zA-Z]+)(?![`\w])/g, '`$1`')
    .replace(/(?<![`\w])([a-zA-Z_][a-zA-Z0-9_.]*\(\))(?![`\w])/g, '`$1`')
    .replace(/(?<!`)(<[a-z_]+>)(?!`)/g, '`$1`')
    .replace(/(?<![`\w])([A-Z][A-Z0-9_]{3,}(?:=[a-z]+)?)(?![`\w])/g, '`$1`')
}

function appendIfBudget(sections: string[], section: string, current: number, budget: number): number {
  const tokens = estimateTokens(section)
  if (current + tokens <= budget) {
    sections.push(section)
    return current + tokens
  }
  return current
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export async function briefCommand(options: BriefOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Brief requires cloud connection.'))
    process.exit(1)
  }

  const projectRoot = findProjectRoot()
  const briefPath = options.output || getBriefPath(projectRoot)
  const budget = options.budget ? parseInt(options.budget, 10) : DEFAULT_BUDGET

  // --check mode: just output the cached file path if fresh, or regenerate
  if (options.check) {
    if (!options.force && isBriefFresh(briefPath)) {
      // Fresh — just print the path for hook consumption
      process.stdout.write(briefPath)
      return
    }
  }

  // Check freshness (skip if --force)
  if (!options.force && isBriefFresh(briefPath)) {
    if (!options.check) {
      console.log(chalk.dim(`Brief is fresh: ${briefPath}`))
      console.log(chalk.dim('Use --force to regenerate.'))
    }
    process.stdout.write(briefPath)
    return
  }

  const spinner = ora('Generating project brief...').start()

  try {
    const content = await generateBrief(config, options.task, budget)

    // Ensure .tages directory exists
    const dir = path.dirname(briefPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(briefPath, content, 'utf-8')
    spinner.succeed(`Brief generated: ${briefPath}`)

    const tokens = estimateTokens(content)
    console.log(chalk.dim(`  ~${tokens} tokens | ${content.split('\n').length} lines`))

    if (options.check) {
      // In check mode, output just the path for pipe consumption
      process.stdout.write(briefPath)
    }
  } catch (err) {
    spinner.fail('Failed to generate brief')
    console.error(chalk.red(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }
}
