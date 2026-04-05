import * as fs from 'fs'
import type { ImportedMemory } from './base-importer.js'

export function parseLessonsMd(filePath: string): ImportedMemory[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const memories: ImportedMemory[] = []
  let currentKey = ''
  let currentLines: string[] = []
  let inFailurePatterns = false

  for (const line of content.split('\n')) {
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      if (currentKey && currentLines.length > 0) {
        memories.push({
          key: `lesson-${slugify(currentKey)}`,
          value: currentLines.join('\n').trim(),
          type: 'lesson',
        })
      }
      currentKey = h2Match[1].trim()
      currentLines = []
      inFailurePatterns = currentKey.toLowerCase().includes('known failure patterns')
      continue
    }

    // In failure patterns section, each `- **pattern**:` is its own memory
    if (inFailurePatterns) {
      const patternMatch = line.match(/^- \*\*(.+?)\*\*:\s*(.+)/)
      if (patternMatch) {
        memories.push({
          key: `failure-${slugify(patternMatch[1])}`,
          value: patternMatch[2].trim(),
          type: 'lesson',
        })
        continue
      }
    }

    if (currentKey) {
      currentLines.push(line)
    }
  }

  if (currentKey && currentLines.length > 0) {
    memories.push({
      key: `lesson-${slugify(currentKey)}`,
      value: currentLines.join('\n').trim(),
      type: 'lesson',
    })
  }

  return memories.filter((m) => m.value.length > 0)
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
