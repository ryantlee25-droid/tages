/**
 * agents-md diff
 *
 * Compares an AGENTS.md file (committed to disk) against the live Tages
 * memory state for a project, reporting section-level drift.
 *
 * NOTE on team_id / federation filtering:
 * The MemoryRow type (and the Supabase `memories` table schema as of migration
 * 0053) does NOT carry a `team_id` field. Federation filtering in `write` is
 * therefore stored in `.tages/agents-md-owners.json` as section→team slug
 * mappings, but memory-level team filtering is a no-op until the schema adds a
 * `team_id` column. See the `federate.ts` module for the owner-map helpers.
 */

import { z } from 'zod'

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export const CANONICAL_SECTIONS = [
  'Commands',
  'Testing',
  'Project structure',
  'Code style',
  'Git workflow',
  'Boundaries',
] as const

export type SectionName = (typeof CANONICAL_SECTIONS)[number]

/**
 * MemoryRow — the subset of columns we SELECT from `memories` for diff.
 * Mirrors the type used in cli/src/commands/agents-md.ts.
 *
 * NOTE: `team_id` is absent from this interface because it does not exist in
 * the current DB schema. When the schema adds it, extend this type and update
 * the federate filter in `write`.
 */
export interface MemoryRow {
  key: string
  value: string
  type: string
  file_paths?: string[] | null
  tags?: string[] | null
  confidence?: number | null
}

export type DriftKind =
  | 'stale'        // Memory content appears in AGENTS.md but memory has since changed
  | 'missing'      // Tages has memories for this section but AGENTS.md has no heading
  | 'contradicting' // AGENTS.md asserts something that conflicts with a memory value

export interface DriftItem {
  section: SectionName
  kind: DriftKind
  memoryKey: string
  memoryValue: string
  /** The relevant fragment from AGENTS.md, if applicable. */
  fileFragment?: string
  message: string
}

export interface DiffReport {
  filePath: string
  /** Total number of drift items found. */
  driftCount: number
  /** true when driftCount === 0 */
  clean: boolean
  items: DriftItem[]
}

// ------------------------------------------------------------
// Zod schema for MemoryRow (used internally for validation)
// ------------------------------------------------------------

const MemoryRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  type: z.string(),
  file_paths: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  confidence: z.number().nullish(),
})

// ------------------------------------------------------------
// Section extraction helper (shared logic mirrored from audit)
// ------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract the body of a `## <name>` section.
 * Returns null when the heading is absent.
 */
function extractSection(content: string, name: string): string | null {
  const pattern = new RegExp(
    `(^|\\n)##\\s+${escapeRegex(name)}\\b([\\s\\S]*?)(?=\\n##\\s+|$)`,
    'i',
  )
  const m = content.match(pattern)
  return m ? m[2] : null
}

// ------------------------------------------------------------
// Memory → section routing (mirrors cli agents-md.ts)
// ------------------------------------------------------------

function routeMemoryToSections(m: MemoryRow): SectionName[] {
  const tags = (m.tags ?? []).map((t) => t.toLowerCase())
  const k = m.key.toLowerCase()
  const v = m.value.toLowerCase()

  const tagMatch = CANONICAL_SECTIONS.find((s) => tags.includes(s.toLowerCase()))
  if (tagMatch) return [tagMatch]

  if (m.type === 'anti_pattern' || m.type === 'lesson' || m.type === 'preference') {
    return ['Boundaries']
  }

  const sections: SectionName[] = []

  if (/\b(git|branch|commit|pr|merge|rebase)\b/i.test(k) || tags.includes('git')) {
    sections.push('Git workflow')
  }
  if (/\b(test|spec|ci|coverage|pytest|vitest|jest)\b/i.test(k) || tags.includes('testing')) {
    sections.push('Testing')
  }
  if (m.type === 'architecture') sections.push('Project structure')
  if (m.type === 'convention') sections.push('Code style')
  if (m.type === 'execution' || m.type === 'pattern') {
    if (!sections.includes('Testing') && /\b(test|spec|ci)\b/i.test(v)) sections.push('Testing')
    else if (!sections.includes('Git workflow')) sections.push('Commands')
  }

  if (sections.length === 0) sections.push('Project structure')

  return sections
}

// ------------------------------------------------------------
// Core diff logic
// ------------------------------------------------------------

/**
 * Normalise a string for loose comparison:
 * - lower-case
 * - collapse whitespace
 * - strip leading `- `, `* `, `> `, markdown bold markers
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*\*/g, '')        // strip bold
    .replace(/[`*_]/g, '')       // strip inline code / emphasis
    .replace(/^\s*[-*>]\s*/gm, '') // strip list/blockquote markers
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the memory value (or a significant substring) appears in the
 * section body.  Uses a "significant words" overlap approach to tolerate
 * minor rewording.
 */
function memoryAppearsInSection(memoryValue: string, sectionBody: string): boolean {
  const normMemory = normalise(memoryValue)
  const normSection = normalise(sectionBody)

  // Exact substring match (fast path)
  if (normSection.includes(normMemory)) return true

  // Significant-words overlap: at least 70% of content words from the memory
  // appear somewhere in the section body.
  const words = normMemory.split(/\s+/).filter((w) => w.length > 3)
  if (words.length === 0) return false
  const hitCount = words.filter((w) => normSection.includes(w)).length
  return hitCount / words.length >= 0.7
}

/**
 * Detect contradictions: the AGENTS.md section contains a statement that
 * directly contradicts the memory value.
 *
 * Strategy: look for key terms from the memory value appearing in the section
 * alongside known negation words (never, don't, not, avoid, no).  This is a
 * heuristic — it catches clear negations without an LLM.
 */
function detectContradiction(memoryValue: string, sectionBody: string): string | null {
  const normMemory = normalise(memoryValue)
  const normSection = normalise(sectionBody)

  // Extract the most distinctive noun-ish words (>4 chars, not stopwords)
  const stopwords = new Set(['always', 'never', 'should', 'must', 'with', 'that', 'from', 'this', 'have', 'when'])
  const keyWords = normMemory
    .split(/\s+/)
    .filter((w) => w.length > 4 && !stopwords.has(w))
    .slice(0, 4) // top 4 words only

  if (keyWords.length === 0) return null

  const lines = normSection.split(/[.\n]/).filter(Boolean)
  for (const line of lines) {
    const hasKeyWord = keyWords.some((w) => line.includes(w))
    if (!hasKeyWord) continue

    const hasNegation = /\b(never|don't|do not|avoid|not|no|prohibited|forbidden)\b/.test(line)
    const memoryIsPositive = !/\b(never|don't|do not|avoid|not|no)\b/.test(normMemory)

    if (hasNegation && memoryIsPositive) {
      // The file negates something the memory affirms
      const snippet = line.slice(0, 120)
      return snippet
    }
  }
  return null
}

/**
 * Main entry point: compute section-level drift between an AGENTS.md file
 * and a live set of memories.
 *
 * @param filePath  Absolute path (used in report output only).
 * @param fileContent  Raw text of the AGENTS.md file.
 * @param memories  Live memories fetched from Tages (already validated).
 */
export function computeAgentsMdDiff(
  filePath: string,
  fileContent: string,
  memories: MemoryRow[],
): DiffReport {
  // Validate all rows at runtime to surface bad data clearly
  const validMemories = memories
    .map((m) => {
      const result = MemoryRowSchema.safeParse(m)
      return result.success ? result.data : null
    })
    .filter((m): m is MemoryRow => m !== null)

  // Group memories by their routed section(s)
  const bySection: Map<SectionName, MemoryRow[]> = new Map()
  for (const section of CANONICAL_SECTIONS) {
    bySection.set(section, [])
  }
  for (const m of validMemories) {
    for (const section of routeMemoryToSections(m)) {
      bySection.get(section)!.push(m)
    }
  }

  const items: DriftItem[] = []

  for (const section of CANONICAL_SECTIONS) {
    const sectionMemories = bySection.get(section) ?? []
    if (sectionMemories.length === 0) continue

    const sectionBody = extractSection(fileContent, section)

    // MISSING: Tages has memories for this section but AGENTS.md has no heading
    if (sectionBody === null) {
      for (const m of sectionMemories) {
        items.push({
          section,
          kind: 'missing',
          memoryKey: m.key,
          memoryValue: m.value,
          message: `Section "## ${section}" is absent from AGENTS.md but Tages has memory "${m.key}".`,
        })
      }
      continue
    }

    for (const m of sectionMemories) {
      // CONTRADICTING: AGENTS.md negates what memory asserts
      const contradictionSnippet = detectContradiction(m.value, sectionBody)
      if (contradictionSnippet) {
        items.push({
          section,
          kind: 'contradicting',
          memoryKey: m.key,
          memoryValue: m.value,
          fileFragment: contradictionSnippet,
          message: `Memory "${m.key}" is contradicted by AGENTS.md in section "${section}": "${contradictionSnippet}".`,
        })
        continue
      }

      // STALE: memory content not reflected in AGENTS.md at all
      if (!memoryAppearsInSection(m.value, sectionBody)) {
        items.push({
          section,
          kind: 'stale',
          memoryKey: m.key,
          memoryValue: m.value,
          message: `Memory "${m.key}" is not reflected in section "${section}" of AGENTS.md. Run \`tages agents-md write --force\` to regenerate.`,
        })
      }
    }
  }

  return {
    filePath,
    driftCount: items.length,
    clean: items.length === 0,
    items,
  }
}
