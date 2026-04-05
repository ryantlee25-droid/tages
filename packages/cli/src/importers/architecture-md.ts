import * as fs from 'fs'
import type { ImportedMemory } from './base-importer.js'

export function parseArchitectureMd(filePath: string): ImportedMemory[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const memories: ImportedMemory[] = []
  let currentKey = ''
  let currentLines: string[] = []

  for (const line of content.split('\n')) {
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      if (currentKey && currentLines.length > 0) {
        memories.push({
          key: `arch-${slugify(currentKey)}`,
          value: currentLines.join('\n').trim(),
          type: 'architecture',
        })
      }
      currentKey = h2Match[1].trim()
      currentLines = []
      continue
    }

    const h3Match = line.match(/^### (.+)/)
    if (h3Match) {
      if (currentKey && currentLines.length > 0) {
        memories.push({
          key: `arch-${slugify(currentKey)}`,
          value: currentLines.join('\n').trim(),
          type: 'architecture',
        })
      }
      currentKey = h3Match[1].trim()
      currentLines = []
      continue
    }

    if (currentKey) {
      currentLines.push(line)
    }
  }

  if (currentKey && currentLines.length > 0) {
    memories.push({
      key: `arch-${slugify(currentKey)}`,
      value: currentLines.join('\n').trim(),
      type: 'architecture',
    })
  }

  return memories.filter((m) => m.value.length > 0)
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
