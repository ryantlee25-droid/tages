import * as fs from 'fs'
import type { MemoryType } from '@tages/shared'
import type { ImportedMemory } from './base-importer.js'

const SECTION_TYPE_MAP: Record<string, MemoryType> = {
  convention: 'convention',
  conventions: 'convention',
  architecture: 'architecture',
  pattern: 'pattern',
  patterns: 'pattern',
  rule: 'convention',
  rules: 'convention',
  decision: 'decision',
  decisions: 'decision',
  preference: 'preference',
  preferences: 'preference',
  entity: 'entity',
  entities: 'entity',
  lesson: 'lesson',
  lessons: 'lesson',
  // The remaining headings `tages export` writes (OTHER_TYPE_HEADINGS).
  execution: 'execution',
  operational: 'operational',
  environment: 'environment',
}

// Checked before SECTION_TYPE_MAP: "Anti-patterns" contains "pattern", and
// `tages export` writes Don't/Never rules under "## Anti-patterns (Don't / Never)".
const ANTI_PATTERN_HEADER = /anti[-_ ]?pattern|don'?t|\bnever\b|\bavoid\b/

export function parseCLAUDEmd(filePath: string): ImportedMemory[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const memories: ImportedMemory[] = []
  let currentType: MemoryType = 'convention'
  let currentKey = ''
  let currentLines: string[] = []

  // A `##` inside a fenced code block is code, not a section heading. Fences
  // follow CommonMark (same rule as the server's stripFencedCode): a fence
  // closes only on the same character, at least as long, with nothing after.
  let fence: { char: string; len: number } | null = null
  for (const line of content.split('\n')) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null
      if (currentKey) currentLines.push(line)
      continue
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (open) {
      fence = { char: open[1][0], len: open[1].length }
      if (currentKey) currentLines.push(line)
      continue
    }

    // H2 header — detect type from header text
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      // Flush previous section
      if (currentKey && currentLines.length > 0) {
        memories.push({
          key: currentKey,
          value: currentLines.join('\n').trim(),
          type: currentType,
        })
      }

      const header = h2Match[1].trim().toLowerCase()
      // Try to match header to a memory type. Reset first: an unrecognised
      // heading must not inherit the previous section's type (after the
      // Anti-patterns section that turned ordinary facts into prohibitions).
      currentType = 'convention'
      if (ANTI_PATTERN_HEADER.test(header)) {
        currentType = 'anti_pattern'
      } else for (const [keyword, type] of Object.entries(SECTION_TYPE_MAP)) {
        if (header.includes(keyword)) {
          currentType = type
          break
        }
      }

      currentKey = slugify(h2Match[1].trim())
      currentLines = []
      continue
    }

    // H3 header — sub-section becomes its own memory
    const h3Match = line.match(/^### (.+)/)
    if (h3Match) {
      if (currentKey && currentLines.length > 0) {
        memories.push({
          key: currentKey,
          value: currentLines.join('\n').trim(),
          type: currentType,
        })
      }
      currentKey = slugify(h3Match[1].trim())
      currentLines = []
      continue
    }

    // Accumulate content
    if (currentKey) {
      currentLines.push(line)
    }
  }

  // Flush last section
  if (currentKey && currentLines.length > 0) {
    memories.push({
      key: currentKey,
      value: currentLines.join('\n').trim(),
      type: currentType,
    })
  }

  // Filter out empty values
  return memories.filter((m) => m.value.length > 0)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
