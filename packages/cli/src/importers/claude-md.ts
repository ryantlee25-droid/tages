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
}

export function parseCLAUDEmd(filePath: string): ImportedMemory[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const memories: ImportedMemory[] = []
  let currentType: MemoryType = 'convention'
  let currentKey = ''
  let currentLines: string[] = []

  for (const line of content.split('\n')) {
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
      // Try to match header to a memory type
      for (const [keyword, type] of Object.entries(SECTION_TYPE_MAP)) {
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
