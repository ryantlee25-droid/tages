import { randomUUID } from 'crypto'
import type { Memory, MemorySource } from '@tages/shared'

// MemoryType is extended locally to include anti_pattern (shared types may lag)
type MemoryType = 'convention' | 'decision' | 'architecture' | 'entity' | 'lesson' | 'preference' | 'pattern' | 'execution' | 'operational' | 'environment' | 'anti_pattern'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

type ImportStrategy = 'skip' | 'overwrite'

interface ParsedMemory {
  key: string
  value: string
  type: MemoryType
}

/**
 * Classify a heading text to a MemoryType.
 */
function classifyHeading(heading: string): MemoryType {
  const h = heading.toLowerCase().trim()

  // Anti-pattern variants
  if (
    h.includes('anti-pattern') ||
    h.includes('anti_pattern') ||
    h.includes("don't") ||
    h.includes('dont') ||
    h.includes('avoid') ||
    h.includes('never')
  ) {
    return 'anti_pattern'
  }

  // Convention variants
  if (h.includes('convention') || h.includes('rules') || h.includes('rule')) {
    return 'convention'
  }

  // Architecture variants
  if (h.includes('architecture') || h.includes('design') || h.includes('structure')) {
    return 'architecture'
  }

  // Decision variants
  if (h.includes('decision')) {
    return 'decision'
  }

  return 'preference'
}

/**
 * Slugify a string for use as a key: lowercase, non-alphanumeric → hyphens,
 * collapse consecutive hyphens, trim leading/trailing hyphens.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Generate a memory key from content text.
 * Takes first ~60 chars of text, slugified, prefixed with "claude-md-".
 */
function generateKey(text: string): string {
  const short = text.trim().slice(0, 60)
  const slug = slugify(short)
  return `claude-md-${slug}`
}

/**
 * Strip code blocks from section content.
 * Returns the text with all ``` ... ``` blocks removed.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '')
}

/**
 * Extract individual memory items from a section body.
 * Bullet points (- or *) → each line is a memory.
 * Paragraphs → each non-empty paragraph is a memory.
 */
function extractItems(body: string, type: MemoryType): ParsedMemory[] {
  const cleaned = stripCodeBlocks(body)
  const items: ParsedMemory[] = []

  // Split into lines for bullet detection
  const lines = cleaned.split('\n')
  let inBulletMode = false

  // Check if this section is primarily bullet-list based
  const bulletLines = lines.filter(l => /^\s*[-*]\s+/.test(l))
  inBulletMode = bulletLines.length > 0

  if (inBulletMode) {
    for (const line of lines) {
      const match = line.match(/^\s*[-*]\s+(.+)/)
      if (match) {
        const value = match[1].trim()
        if (value) {
          items.push({ key: generateKey(value), value, type })
        }
      }
    }
  } else {
    // Paragraph mode: split on blank lines
    const paragraphs = cleaned.split(/\n\s*\n/)
    for (const para of paragraphs) {
      const value = para.trim()
      if (value && value.length > 0) {
        items.push({ key: generateKey(value), value, type })
      }
    }
  }

  return items
}

/**
 * Parse CLAUDE.md content into structured memory items.
 */
export function parseClaudeMd(content: string): ParsedMemory[] {
  const memories: ParsedMemory[] = []

  // Split on ## or ### headings
  // Keep heading text with each section
  const headingRegex = /^#{2,3}\s+(.+)$/m
  const parts = content.split(/^(?=#{2,3}\s)/m)

  for (const part of parts) {
    const headingMatch = part.match(/^#{2,3}\s+(.+)/)
    if (!headingMatch) {
      // Preamble before any heading — skip
      continue
    }

    const heading = headingMatch[1].trim()
    const type = classifyHeading(heading)

    // Body is everything after the heading line
    const bodyStart = part.indexOf('\n')
    if (bodyStart === -1) continue
    const body = part.slice(bodyStart + 1)

    const items = extractItems(body, type)
    memories.push(...items)
  }

  return memories
}

/**
 * Handle import_claude_md tool call.
 */
export async function handleImportClaudeMd(
  args: {
    content: string
    strategy?: ImportStrategy
    projectId: string
  },
  cache: SqliteCache,
  _sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const strategy = args.strategy ?? 'skip'

  if (!args.content || args.content.trim().length === 0) {
    return {
      content: [{ type: 'text', text: 'Imported 0 memories (0 skipped)' }],
    }
  }

  let parsed: ParsedMemory[]
  try {
    parsed = parseClaudeMd(args.content)
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Parse failed: ${(err as Error).message}` }],
    }
  }

  if (parsed.length === 0) {
    return {
      content: [{ type: 'text', text: 'Imported 0 memories (0 skipped)' }],
    }
  }

  const now = new Date().toISOString()
  let imported = 0
  let skipped = 0

  // Deduplicate keys within the parsed set (keep first occurrence)
  const seenKeys = new Set<string>()
  const deduped: ParsedMemory[] = []
  for (const item of parsed) {
    if (!seenKeys.has(item.key)) {
      seenKeys.add(item.key)
      deduped.push(item)
    }
  }

  for (const item of deduped) {
    const existing = cache.getByKey(args.projectId, item.key)

    if (existing) {
      if (strategy === 'skip') {
        skipped++
        continue
      } else {
        // overwrite
        cache.upsertMemory({
          ...existing,
          value: item.value,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: item.type as any,
          updatedAt: now,
          source: 'import' as MemorySource,
        })
        imported++
      }
    } else {
      const memory: Memory = {
        id: randomUUID(),
        projectId: args.projectId,
        key: item.key,
        value: item.value,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: item.type as any,
        source: 'import' as MemorySource,
        status: 'live',
        tags: [],
        filePaths: [],
        confidence: 1.0,
        createdAt: now,
        updatedAt: now,
      }
      cache.upsertMemory(memory)
      imported++
    }
  }

  return {
    content: [{ type: 'text', text: `Imported ${imported} memories (${skipped} skipped)` }],
  }
}
