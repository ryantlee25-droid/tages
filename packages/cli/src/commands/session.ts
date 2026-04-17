import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import chalk from 'chalk'
import type { Memory } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { openCliSync } from '../sync/cli-sync.js'

export interface SessionHandoffMemory {
  current_objective: string
  active_constraints: string[]
  recent_decisions: string[]
  open_questions: string[]
  known_issues: string[]
  working_summary: string
  project_label?: string
  optional_tags?: string[]
}

// Backward-compatible alias used by existing imports/tests.
export type SessionContextMemory = SessionHandoffMemory

interface SessionSaveOptions {
  project?: string
  key?: string
  objective?: string
  goal?: string
  constraints?: string[]
  decisions?: string[]
  questions?: string[]
  issues?: string[]
  label?: string
  summary?: string
  workingSummary?: string
  tags?: string[]
  inputFile?: string
}

interface SessionLoadOptions {
  project?: string
  key?: string
  format?: string
  output?: string
}

interface ParsedTaggedInput {
  objective?: string
  constraints: string[]
  decisions: string[]
  questions: string[]
  issues: string[]
  summaryHint?: string
  label?: string
  tags: string[]
  remainder: string
}

const DEFAULT_HANDOFF_KEY = 'session-handoff-active'
const LEGACY_SESSION_KEY = 'session-context-active'

function splitItems(values?: string[]): string[] {
  if (!values || values.length === 0) return []
  const items: string[] = []
  for (const value of values) {
    const chunks = value
      .split(/\n|;/)
      .map(s => s.trim())
      .filter(Boolean)
    items.push(...chunks)
  }
  return items
}

function uniqueList(values: string[], max = 8): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized)
    if (output.length >= max) break
  }
  return output
}

function splitSentences(input: string): string[] {
  return input
    .split(/\n+|(?<=[.!?])\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function compressHighSignal(text: string, maxChars = 640): string {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return ''

  const keyword = /\b(next|todo|blocked|risk|must|cannot|because|pending|current|need|issue|fix|question|decision)\b/i
  const scored = sentences.map((sentence, index) => {
    let score = 0
    if (keyword.test(sentence)) score += 3
    if (sentence.includes('?')) score += 2
    if (sentence.length >= 30 && sentence.length <= 180) score += 1
    if (/^(we|i|current|next)/i.test(sentence)) score += 1
    return { sentence, score, index }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.index - b.index
  })

  const selected: string[] = []
  let length = 0
  for (const item of scored) {
    const sentence = item.sentence
    if (selected.includes(sentence)) continue
    if (length + sentence.length + 1 > maxChars) continue
    selected.push(sentence)
    length += sentence.length + 1
    if (selected.length >= 5) break
  }

  if (selected.length === 0) return sentences[0].slice(0, maxChars)
  return selected.join(' ')
}

function parseTaggedInput(input: string): ParsedTaggedInput {
  const constraints: string[] = []
  const decisions: string[] = []
  const questions: string[] = []
  const issues: string[] = []
  const tags: string[] = []
  const remainder: string[] = []
  let objective: string | undefined
  let summaryHint: string | undefined
  let label: string | undefined

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const objectiveMatch = line.match(/^(objective|goal)\s*:\s*(.+)$/i)
    if (objectiveMatch) {
      objective = objectiveMatch[2].trim()
      continue
    }

    const constraintMatch = line.match(/^(constraint|constraints)\s*:\s*(.+)$/i)
    if (constraintMatch) {
      constraints.push(constraintMatch[2].trim())
      continue
    }

    const decisionMatch = line.match(/^(decision|decisions)\s*:\s*(.+)$/i)
    if (decisionMatch) {
      decisions.push(decisionMatch[2].trim())
      continue
    }

    const questionMatch = line.match(/^(question|questions|open questions?)\s*:\s*(.+)$/i)
    if (questionMatch) {
      questions.push(questionMatch[2].trim())
      continue
    }

    const issueMatch = line.match(/^(issue|issues|known issue)\s*:\s*(.+)$/i)
    if (issueMatch) {
      issues.push(issueMatch[2].trim())
      continue
    }

    const summaryMatch = line.match(/^(summary|working summary|state)\s*:\s*(.+)$/i)
    if (summaryMatch) {
      summaryHint = summaryMatch[2].trim()
      continue
    }

    const labelMatch = line.match(/^(label|topic|project label|topic label)\s*:\s*(.+)$/i)
    if (labelMatch) {
      label = labelMatch[2].trim()
      continue
    }

    const tagMatch = line.match(/^tag(s)?\s*:\s*(.+)$/i)
    if (tagMatch) {
      tags.push(...tagMatch[2].split(',').map(t => t.trim()).filter(Boolean))
      continue
    }

    remainder.push(line)
  }

  return {
    objective,
    constraints,
    decisions,
    questions,
    issues,
    summaryHint,
    label,
    tags,
    remainder: remainder.join('\n'),
  }
}

function inferListFromSentences(sentences: string[], pattern: RegExp, max = 4): string[] {
  const hits: string[] = []
  for (const sentence of sentences) {
    if (!pattern.test(sentence)) continue
    hits.push(sentence)
    if (hits.length >= max) break
  }
  return hits
}

function inferOpenQuestions(sentences: string[], max = 4): string[] {
  const hits: string[] = []
  for (const sentence of sentences) {
    const lowered = sentence.toLowerCase()
    const startsWithQuestionWord = /^(who|what|when|where|why|how|which)\b/.test(lowered)
    if (!sentence.includes('?') && !startsWithQuestionWord) continue
    hits.push(sentence.endsWith('?') ? sentence : `${sentence}?`)
    if (hits.length >= max) break
  }
  return hits
}

function toArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter(v => typeof v === 'string') as string[] : []
}

export function capture_session_handoff(args: {
  input?: string
  current_objective?: string
  current_goal?: string
  active_constraints?: string[]
  recent_decisions?: string[]
  open_questions?: string[]
  known_issues?: string[]
  working_summary?: string
  working_state_summary?: string
  project_label?: string
  optional_tags?: string[]
}): SessionHandoffMemory {
  const input = args.input?.trim() || ''
  const tagged = parseTaggedInput(input)
  const remainingInput = tagged.remainder
  const sentencePool = splitSentences(remainingInput)

  const current_objective =
    args.current_objective?.trim() ||
    args.current_goal?.trim() ||
    tagged.objective ||
    sentencePool[0] ||
    'Continue from current state without losing context.'

  const active_constraints = uniqueList([
    ...splitItems(args.active_constraints),
    ...tagged.constraints,
    ...inferListFromSentences(sentencePool, /\b(must|cannot|can\'t|never|do not|limit|constraint)\b/i, 5),
  ])

  const recent_decisions = uniqueList([
    ...splitItems(args.recent_decisions),
    ...tagged.decisions,
    ...inferListFromSentences(sentencePool, /\b(decided|chose|selected|opted|approved)\b/i),
  ])

  const open_questions = uniqueList([
    ...splitItems(args.open_questions),
    ...tagged.questions,
    ...inferOpenQuestions(sentencePool, 5),
  ])

  const known_issues = uniqueList([
    ...splitItems(args.known_issues),
    ...tagged.issues,
    ...inferListFromSentences(sentencePool, /\b(issue|bug|blocked|failing|risk|unclear|todo)\b/i, 5),
  ])

  const summarySource =
    args.working_summary?.trim() ||
    args.working_state_summary?.trim() ||
    tagged.summaryHint ||
    remainingInput ||
    [
      recent_decisions[0],
      known_issues[0],
      open_questions[0],
      active_constraints[0],
    ].filter(Boolean).join(' ')

  const working_summary = compressHighSignal(summarySource)

  const project_label =
    args.project_label?.trim() ||
    tagged.label ||
    undefined

  const optional_tags = uniqueList([
    ...splitItems(args.optional_tags),
    ...tagged.tags,
  ], 12)

  return {
    current_objective: current_objective.slice(0, 240),
    active_constraints,
    recent_decisions,
    open_questions,
    known_issues,
    working_summary,
    project_label,
    optional_tags: optional_tags.length > 0 ? optional_tags : undefined,
  }
}

export function rehydrate_session_handoff(
  handoff: SessionHandoffMemory,
  format: 'prompt' | 'json' = 'prompt',
): string {
  if (format === 'json') {
    return JSON.stringify(handoff, null, 2)
  }

  const lines: string[] = []
  lines.push('SESSION HANDOFF (SHORT-LIVED)')
  lines.push(`Current objective: ${handoff.current_objective}`)

  if (handoff.project_label) {
    lines.push(`Project/topic: ${handoff.project_label}`)
  }

  if (handoff.active_constraints.length > 0) {
    lines.push('Active constraints:')
    for (const constraint of handoff.active_constraints) {
      lines.push(`- ${constraint}`)
    }
  }

  if (handoff.recent_decisions.length > 0) {
    lines.push('Recent decisions:')
    for (const decision of handoff.recent_decisions) {
      lines.push(`- ${decision}`)
    }
  }

  if (handoff.open_questions.length > 0) {
    lines.push('Open questions:')
    for (const question of handoff.open_questions) {
      lines.push(`- ${question}`)
    }
  }

  if (handoff.known_issues.length > 0) {
    lines.push('Known issues:')
    for (const issue of handoff.known_issues) {
      lines.push(`- ${issue}`)
    }
  }

  lines.push(`Working summary: ${handoff.working_summary}`)

  if (handoff.optional_tags && handoff.optional_tags.length > 0) {
    lines.push(`Tags: ${handoff.optional_tags.join(', ')}`)
  }

  lines.push('Instruction: Continue from this handoff. Preserve continuity and ask before making assumptions.')

  return lines.join('\n')
}

// Backward-compatible wrappers retained for existing call sites/tests.
export function capture_session_context(args: {
  input?: string
  current_goal?: string
  active_constraints?: string[]
  recent_decisions?: string[]
  known_issues?: string[]
  working_state_summary?: string
  optional_tags?: string[]
}): SessionContextMemory {
  return capture_session_handoff({
    input: args.input,
    current_goal: args.current_goal,
    active_constraints: args.active_constraints,
    recent_decisions: args.recent_decisions,
    known_issues: args.known_issues,
    working_state_summary: args.working_state_summary,
    optional_tags: args.optional_tags,
  })
}

export function rehydrate_session_context(
  context: SessionContextMemory,
  format: 'prompt' | 'json' = 'prompt',
): string {
  return rehydrate_session_handoff(context, format)
}

function parseSessionContextValue(value: string): SessionHandoffMemory {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return {
      current_objective: (parsed.current_objective as string) || (parsed.current_goal as string) || 'Continue from current state without losing context.',
      active_constraints: uniqueList(toArray(parsed.active_constraints)),
      recent_decisions: uniqueList(toArray(parsed.recent_decisions)),
      open_questions: uniqueList(toArray(parsed.open_questions)),
      known_issues: uniqueList(toArray(parsed.known_issues)),
      working_summary: (parsed.working_summary as string) || (parsed.working_state_summary as string) || '',
      project_label: typeof parsed.project_label === 'string' ? parsed.project_label : undefined,
      optional_tags: uniqueList(toArray(parsed.optional_tags)),
    }
  } catch {
    return {
      current_objective: 'Continue from current state without losing context.',
      active_constraints: [],
      recent_decisions: [],
      open_questions: [],
      known_issues: [],
      working_summary: compressHighSignal(value),
      project_label: undefined,
      optional_tags: [],
    }
  }
}

export async function sessionSaveCommand(input: string | undefined, options: SessionSaveOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  let fileInput = ''
  if (options.inputFile) {
    const absolute = path.resolve(options.inputFile)
    if (!fs.existsSync(absolute)) {
      console.error(chalk.red(`Input file not found: ${absolute}`))
      process.exit(1)
    }
    fileInput = fs.readFileSync(absolute, 'utf-8')
  }

  const mergedInput = [input, fileInput].filter(Boolean).join('\n').trim()
  const hasExplicitSignal = Boolean(
    mergedInput ||
    options.objective ||
    options.goal ||
    options.summary ||
    options.workingSummary ||
    (options.constraints && options.constraints.length > 0) ||
    (options.decisions && options.decisions.length > 0) ||
    (options.questions && options.questions.length > 0) ||
    (options.issues && options.issues.length > 0),
  )

  if (!hasExplicitSignal) {
    console.error(chalk.red('No handoff content to save. Provide notes text or --objective/--summary fields.'))
    process.exit(1)
  }

  const sessionHandoff = capture_session_handoff({
    input: mergedInput,
    current_objective: options.objective,
    current_goal: options.goal,
    active_constraints: options.constraints,
    recent_decisions: options.decisions,
    open_questions: options.questions,
    known_issues: options.issues,
    working_summary: options.workingSummary || options.summary,
    project_label: options.label,
    optional_tags: options.tags,
  })

  const key = options.key || DEFAULT_HANDOFF_KEY
  const now = new Date().toISOString()
  const value = JSON.stringify(sessionHandoff)

  const { cache, flush, close } = await openCliSync(config)
  try {
    const existing = cache.getByKey(config.projectId, key) as Memory | null
    const memory: Memory = {
      id: existing?.id || randomUUID(),
      projectId: config.projectId,
      key,
      value,
      type: 'session_context',
      source: 'manual',
      status: 'live',
      confidence: 1.0,
      tags: uniqueList(['session_handoff', 'session_context', ...(sessionHandoff.optional_tags || [])], 16),
      filePaths: [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    cache.upsertMemory(memory, true)
    await flush()
  } finally {
    close()
  }

  console.log(chalk.green('Session handoff saved:'), key)
  console.log(chalk.dim(`  Objective: ${sessionHandoff.current_objective}`))
  console.log(chalk.dim(`  Summary: ${sessionHandoff.working_summary}`))
}

export async function sessionLoadCommand(options: SessionLoadOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const format = options.format === 'json' ? 'json' : 'prompt'
  const { cache, close } = await openCliSync(config)
  let memory: Memory | null = null
  try {
    if (options.key) {
      memory = cache.getByKey(config.projectId, options.key) as Memory | null
    } else {
      const preferred = cache.getByKey(config.projectId, DEFAULT_HANDOFF_KEY) as Memory | null
      if (preferred?.type === 'session_context') {
        memory = preferred
      }

      if (!memory) {
        const legacy = cache.getByKey(config.projectId, LEGACY_SESSION_KEY) as Memory | null
        if (legacy?.type === 'session_context') {
          memory = legacy
        }
      }

      if (!memory) {
        const all = cache.getByType(config.projectId, 'session_context') as Memory[]
        if (all.length > 0) {
          all.sort((a, b) => {
            const updatedDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
            if (updatedDelta !== 0) return updatedDelta
            const createdDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt)
            if (createdDelta !== 0) return createdDelta
            return b.key.localeCompare(a.key)
          })
          memory = all[0]
        }
      }
    }
  } finally {
    close()
  }

  if (!memory) {
    console.error(chalk.yellow('No session handoff found. Run `tages session save` first.'))
    process.exit(1)
  }

  const parsed = parseSessionContextValue(memory.value)
  const rendered = rehydrate_session_handoff(parsed, format)

  if (options.output) {
    const outputPath = path.resolve(options.output)
    const outDir = path.dirname(outputPath)
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(outputPath, `${rendered}\n`, 'utf-8')
    console.log(chalk.green(`Session handoff written to ${outputPath}`))
    return
  }

  console.log(rendered)
  console.log(chalk.dim('\nPromotion hint: move stable insights into long-term memory with `tages remember` (decision/convention/pattern).'))
}
