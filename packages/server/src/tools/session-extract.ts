import type { MemoryType } from '@tages/shared'

export interface ExtractedMemory {
  key: string
  value: string
  type: MemoryType
}

/**
 * Extracts codebase memories from a freeform session summary.
 * Splits the summary into sentences/bullet points and maps keywords to memory types.
 */
export function extractMemoriesFromSummary(summary: string): ExtractedMemory[] {
  const extracted: ExtractedMemory[] = []

  const lines = summary
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map(l => l.trim())
    .filter(l => l.length > 10)

  for (const line of lines) {
    const lower = line.toLowerCase()
    let type: MemoryType | null = null
    let key = ''

    if (/\b(decided|chose|went with|picked|selected|opted)\b/.test(lower)) {
      type = 'decision'
      key = `decision-${slugify(line.slice(0, 50))}`
    } else if (/\b(convention|pattern|always|never|must|naming|style)\b/.test(lower)) {
      type = 'convention'
      key = `convention-${slugify(line.slice(0, 50))}`
    } else if (/\b(architecture|module|structure|layer|boundary|directory|layout)\b/.test(lower)) {
      type = 'architecture'
      key = `arch-${slugify(line.slice(0, 50))}`
    } else if (/\b(learned|gotcha|watch out|careful|bug|issue|mistake|avoid)\b/.test(lower)) {
      type = 'lesson'
      key = `lesson-${slugify(line.slice(0, 50))}`
    } else if (/\b(created|added|new|built|implemented|introduced)\b/.test(lower)) {
      type = 'entity'
      key = `entity-${slugify(line.slice(0, 50))}`
    }

    if (type && key) {
      extracted.push({ key, value: line, type })
    }
  }

  return extracted
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
