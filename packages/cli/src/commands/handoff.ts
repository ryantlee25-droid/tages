import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import type { Memory } from '@tages/shared'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { openCliSync } from '../sync/cli-sync.js'

interface HandoffOptions {
  project?: string
  limit?: string
  output?: string
  format?: string
}

interface SupabaseMemoryRow {
  id: string
  key: string
  value: string
  type: Memory['type']
  source: Memory['source']
  status: Memory['status']
  confidence: number
  file_paths: string[] | null
  tags: string[] | null
  created_at: string
  updated_at: string
}

type HandoffFormat = 'chatgpt' | 'markdown'

const DEFAULT_LIMIT = 40

const SECTION_MAP: Array<{ title: string; types: Memory['type'][] }> = [
  { title: 'Canon Facts', types: ['architecture', 'decision', 'entity', 'environment'] },
  { title: 'Hard Constraints', types: ['convention', 'anti_pattern', 'operational'] },
  { title: 'Active Threads', types: ['execution', 'pattern'] },
  { title: 'Preferences and Tone', types: ['preference', 'lesson'] },
]

const TYPE_PRIORITY: Partial<Record<Memory['type'], number>> = {
  anti_pattern: 0,
  convention: 1,
  decision: 2,
  entity: 3,
  execution: 4,
  pattern: 5,
  architecture: 6,
  operational: 7,
  environment: 8,
  preference: 9,
  lesson: 10,
}

function parseFormat(format?: string): HandoffFormat {
  if (format === 'markdown') return 'markdown'
  return 'chatgpt'
}

function truncateValue(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

function memorySort(a: Memory, b: Memory): number {
  const pa = TYPE_PRIORITY[a.type] ?? 999
  const pb = TYPE_PRIORITY[b.type] ?? 999
  if (pa !== pb) return pa - pb
  if (a.confidence !== b.confidence) return b.confidence - a.confidence
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
}

function matchesFocus(memory: Memory, focus?: string): boolean {
  if (!focus) return true
  const needle = focus.toLowerCase()
  const haystacks = [
    memory.key,
    memory.value,
    memory.type,
    ...(memory.tags || []),
  ]
  return haystacks.some((item) => item.toLowerCase().includes(needle))
}

function sectionFor(type: Memory['type']): string {
  for (const section of SECTION_MAP) {
    if (section.types.includes(type)) return section.title
  }
  return 'Other Context'
}

function toBullet(memory: Memory): string {
  const value = truncateValue(memory.value)
  return `- ${memory.key}: ${value}`
}

export function renderHandoff(
  memories: Memory[],
  projectSlug: string,
  format: HandoffFormat,
  focus?: string,
): string {
  if (memories.length === 0) {
    return [
      '# Chat Continuity Handoff',
      '',
      'No memories found yet.',
      '',
      'Store context first, for example:',
      '`tages remember "campaign-arc" "Party owes a debt to the Brass Syndicate." --type decision`',
    ].join('\n')
  }

  const grouped = new Map<string, string[]>()
  for (const memory of memories) {
    const section = sectionFor(memory.type)
    if (!grouped.has(section)) grouped.set(section, [])
    grouped.get(section)!.push(toBullet(memory))
  }

  const sectionOrder = [...SECTION_MAP.map(s => s.title), 'Other Context']
  const sectionBlocks: string[] = []
  for (const section of sectionOrder) {
    const lines = grouped.get(section)
    if (!lines || lines.length === 0) continue
    sectionBlocks.push(`### ${section}\n${lines.join('\n')}`)
  }

  if (format === 'markdown') {
    return [
      '# Chat Continuity Handoff',
      '',
      `Project: ${projectSlug}`,
      focus ? `Focus: ${focus}` : '',
      '',
      ...sectionBlocks,
    ].filter(Boolean).join('\n')
  }

  const promptLines = [
    `You are continuing an ongoing project called "${projectSlug}".`,
    'Preserve continuity across chats.',
    'Do not retcon established facts.',
    'If information is missing or conflicts, ask a clarifying question before inventing details.',
    '',
    'Use this context as canon:',
    '',
    ...sectionBlocks,
    '',
    'Response rules:',
    '- Keep names, timeline events, and constraints consistent.',
    '- Treat "Hard Constraints" as highest priority.',
    '- End your response with "New Canon" bullet points for anything newly established.',
  ]

  return [
    '# Chat Continuity Handoff',
    '',
    'Copy/paste the block below into the first message of a new ChatGPT chat:',
    '',
    '```text',
    ...promptLines,
    '```',
  ].join('\n')
}

async function loadCloudMemories(config: {
  projectId: string
  supabaseUrl?: string
  supabaseAnonKey?: string
}): Promise<Memory[]> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return []

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data, error } = await supabase
    .from('memories')
    .select('id, key, value, type, source, status, confidence, file_paths, tags, created_at, updated_at')
    .eq('project_id', config.projectId)
    .eq('status', 'live')
    .order('updated_at', { ascending: false })
    .limit(500)

  if (error || !data) return []

  return (data as SupabaseMemoryRow[]).map((row) => ({
    id: row.id,
    projectId: config.projectId,
    key: row.key,
    value: row.value,
    type: row.type,
    source: row.source,
    status: row.status,
    confidence: row.confidence ?? 1.0,
    filePaths: row.file_paths || [],
    tags: row.tags || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function handoffCommand(focus: string | undefined, options: HandoffOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const format = parseFormat(options.format)
  const limit = options.limit ? parseInt(options.limit, 10) : DEFAULT_LIMIT
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
    console.error(chalk.red('Limit must be a number between 1 and 200.'))
    process.exit(1)
  }

  const { cache, close } = await openCliSync(config)
  let memories: Memory[] = []
  try {
    memories = cache
      .getAllForProject(config.projectId)
      .filter((m: Memory) => m.status === 'live')
  } finally {
    close()
  }

  if (memories.length === 0) {
    memories = await loadCloudMemories(config)
  }

  const selected = memories
    .filter(m => matchesFocus(m, focus))
    .sort(memorySort)
    .slice(0, limit)

  const handoff = renderHandoff(selected, config.slug || config.projectId, format, focus)

  if (options.output) {
    const outputPath = path.resolve(options.output)
    const outDir = path.dirname(outputPath)
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(outputPath, `${handoff}\n`, 'utf-8')
    console.log(chalk.green(`Handoff written to ${outputPath}`))
    return
  }

  console.log(handoff)
}
