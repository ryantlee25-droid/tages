import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import type { Memory, MemoryType } from '@tages/shared'

interface AuditOptions {
  project?: string
  json?: boolean
}

interface AuditResult {
  typeCounts: Record<MemoryType, number>
  missingTypes: MemoryType[]
  briefCriticalCoverage: number
  imperativeRatio: number
  suggestions: string[]
  score: number
}

const BRIEF_CRITICAL_TYPES: MemoryType[] = [
  'anti_pattern', 'lesson', 'pattern', 'execution', 'convention',
]

const ALL_TYPES: MemoryType[] = [
  'convention', 'decision', 'architecture', 'entity', 'lesson',
  'preference', 'pattern', 'execution', 'operational', 'environment', 'anti_pattern',
]

const ALL_DISPLAY_ORDER: MemoryType[] = [
  'anti_pattern', 'lesson', 'pattern', 'execution', 'convention',
  'decision', 'architecture', 'entity', 'preference', 'operational', 'environment',
]

const IMPERATIVE_WORDS = /\b(ALWAYS|NEVER|MUST|DO NOT|STOP|AVOID|REQUIRE|ENSURE|USE)\b/
const IMPERATIVE_TYPES: MemoryType[] = ['convention', 'anti_pattern', 'lesson']

function auditMemories(memories: Memory[]): AuditResult {
  const typeCounts = {} as Record<MemoryType, number>
  for (const t of ALL_TYPES) typeCounts[t] = 0
  for (const m of memories) if (m.type in typeCounts) typeCounts[m.type as MemoryType]++

  const missingTypes = ALL_TYPES.filter(t => typeCounts[t] === 0)
  const coveredCritical = BRIEF_CRITICAL_TYPES.filter(t => typeCounts[t] > 0)
  const briefCriticalCoverage = coveredCritical.length * 20

  const imperativeCandidates = memories.filter(m => IMPERATIVE_TYPES.includes(m.type))
  const imperativeCount = imperativeCandidates.filter(m => IMPERATIVE_WORDS.test(m.value)).length
  const imperativeRatio = imperativeCandidates.length === 0 ? 0 : imperativeCount / imperativeCandidates.length
  const score = Math.round(briefCriticalCoverage * 0.6 + imperativeRatio * 100 * 0.4)

  const suggestions: string[] = []
  const missingCritical = BRIEF_CRITICAL_TYPES.filter(t => typeCounts[t] === 0)
  if (missingCritical.length > 0)
    suggestions.push(`Add memories of type: ${missingCritical.join(', ')} — these are brief-critical and improve context quality by 20 pts each.`)
  if (imperativeRatio < 0.5 && imperativeCandidates.length > 0) {
    const nonImperative = imperativeCandidates.filter(m => !IMPERATIVE_WORDS.test(m.value)).length
    suggestions.push(`${nonImperative} convention/anti_pattern/lesson memories lack imperative phrasing (ALWAYS/NEVER/MUST). Run \`tages sharpen --all\` to fix.`)
  }
  if (memories.length < 10) suggestions.push(`Only ${memories.length} memories stored. Aim for 10+ for meaningful briefs.`)
  if (typeCounts.anti_pattern === 0) suggestions.push('No anti_pattern memories — add gotchas with `tages remember <key> <value> -t anti_pattern`.')

  return { typeCounts, missingTypes, briefCriticalCoverage, imperativeRatio, suggestions, score }
}

export async function auditCommand(options: AuditOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Audit requires Supabase connection (freshness matters for audit).'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: rows, error } = await Promise.resolve(
    supabase
      .from('memories')
      .select('id, project_id, key, value, type, source, status, confidence, file_paths, tags, created_at, updated_at')
      .eq('project_id', config.projectId)
      .eq('status', 'live')
  )

  if (error) {
    console.error(chalk.red(`Failed to fetch memories: ${error.message}`))
    process.exit(1)
  }

  // Map snake_case DB rows to Memory shape
  const memories: Memory[] = (rows ?? []).map((r: Record<string, unknown>) => ({
    id: r['id'] as string,
    projectId: r['project_id'] as string,
    key: r['key'] as string,
    value: r['value'] as string,
    type: r['type'] as MemoryType,
    source: r['source'] as Memory['source'],
    status: r['status'] as Memory['status'],
    confidence: r['confidence'] as number,
    filePaths: (r['file_paths'] as string[] | null) ?? [],
    tags: (r['tags'] as string[] | null) ?? [],
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  }))

  const result = auditMemories(memories)

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  // Colored summary output
  console.log(chalk.bold('\n  Memory Quality Audit'))
  console.log(chalk.dim(`  Project: ${config.slug || config.projectId} | ${memories.length} memories\n`))

  // Score bar
  const scoreColor = result.score >= 70 ? chalk.green : result.score >= 40 ? chalk.yellow : chalk.red
  console.log(`  Overall Score:  ${scoreColor(result.score.toString() + '/100')}`)
  console.log(`  Brief Coverage: ${result.briefCriticalCoverage}/100  (brief-critical type coverage)`)
  console.log(`  Imperative:     ${(result.imperativeRatio * 100).toFixed(0)}%  (convention/anti_pattern/lesson with imperative phrasing)`)
  console.log()

  // Type coverage table
  console.log(chalk.bold('  Type Coverage'))
  console.log()

  for (const t of ALL_DISPLAY_ORDER) {
    const count = result.typeCounts[t] ?? 0
    const isCritical = BRIEF_CRITICAL_TYPES.includes(t)
    const indicator = count === 0 ? chalk.red('✗') : chalk.green('✓')
    const countStr = count === 0 ? chalk.red('MISSING') : chalk.dim(`${count} stored`)
    const criticalBadge = isCritical ? chalk.yellow(' [brief-critical]') : ''
    console.log(`  ${indicator}  ${t.padEnd(14)} ${countStr}${criticalBadge}`)
  }

  if (result.suggestions.length > 0) {
    console.log()
    console.log(chalk.bold('  Suggestions'))
    for (const s of result.suggestions) {
      console.log(`  ${chalk.cyan('·')} ${s}`)
    }
  }

  console.log()
}
