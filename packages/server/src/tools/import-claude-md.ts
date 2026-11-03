import { randomUUID } from 'crypto'
import type { Memory, MemorySource } from '@tages/shared'

// MemoryType is extended locally to include anti_pattern (shared types may lag)
type MemoryType = 'convention' | 'decision' | 'architecture' | 'entity' | 'lesson' | 'preference' | 'pattern' | 'execution' | 'operational' | 'environment' | 'anti_pattern'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import type { SupabaseClient } from '@supabase/supabase-js'
import { embedOnWrite } from './embed-on-write'
import { scanForSensitiveData, hasHighSeverity, formatSafetyWarnings, type SafetyWarning } from './safety'

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
 * Strip fenced code blocks (``` and ~~~) from markdown, line by line.
 *
 * Runs on the WHOLE document BEFORE splitting on headings, so a heading-looking
 * line inside a fence (`## Example output`) can neither start a new section nor
 * leak code into a memory. CommonMark rules: an opener is up to 3 spaces of
 * indent then 3+ backticks or tildes; the closer uses the same character, at
 * least as many of them, and nothing else on the line. An unclosed fence
 * strips to the end of the document.
 */
export function stripFencedCode(text: string): string {
  const out: string[] = []
  let fence: { char: string; len: number } | null = null
  for (const line of text.split('\n')) {
    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null
      continue
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (open) {
      fence = { char: open[1][0], len: open[1].length }
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Extract individual memory items from a section body.
 * Bullet points (- or *) → each line is a memory.
 * Paragraphs → each non-empty paragraph is a memory.
 * The body is already fence-free (parseClaudeMd strips first).
 */
function extractItems(body: string, type: MemoryType): ParsedMemory[] {
  const items: ParsedMemory[] = []
  const lines = body.split('\n')

  // Check if this section is primarily bullet-list based
  const inBulletMode = lines.some(l => /^\s*[-*]\s+/.test(l))

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
    for (const para of body.split(/\n\s*\n/)) {
      const value = para.trim()
      if (value) {
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

  // Fences first: a `## ...` line inside a code block is not a heading.
  const parts = stripFencedCode(content).split(/^(?=#{2,3}\s)/m)

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

    memories.push(...extractItems(body, type))
  }

  return memories
}

/** Capped await for embeddings: phase tests spawn a short-lived server per call. */
const EMBED_TIMEOUT_MS = 10_000

/**
 * Handle import_claude_md tool call.
 *
 * `skip` and `overwrite` are judged against the SHARED store
 * (sync.remoteGetByKeys), not only this machine's cache: a teammate importing
 * the same committed CLAUDE.md on a machine that has not hydrated must skip,
 * not re-write rows another person owns. Rows that exist remotely but not
 * locally are seeded into the cache as-is (remote id and created_by kept).
 * `overwrite` starts from the remote row, so its id and created_by survive.
 * Every written row is pushed immediately, so "imported" means "shared".
 */
export async function handleImportClaudeMd(
  args: {
    content: string
    strategy?: ImportStrategy
    projectId: string
  },
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
  supabaseClient?: SupabaseClient,
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
  // Same secret gate as `remember` (no --force here): a rule with a
  // high-severity secret is skipped and reported, never stored, synced or
  // sent to the embedding provider; the rest of the import proceeds. Medium
  // (PII) warnings are stored and surfaced. Blocked rules are reported by
  // detector name only: the key is a slug of the value and could carry part
  // of the secret.
  let blocked = 0
  const blockedNames = new Set<string>()
  const piiWarnings: SafetyWarning[] = []
  for (const item of parsed) {
    if (seenKeys.has(item.key)) continue
    seenKeys.add(item.key)
    const warnings = scanForSensitiveData(`${item.key} ${item.value}`)
    if (hasHighSeverity(warnings)) {
      blocked++
      for (const w of warnings) if (w.severity === 'high') blockedNames.add(w.name)
      continue
    }
    for (const w of warnings) {
      if (!piiWarnings.some(p => p.name === w.name)) piiWarnings.push(w)
    }
    deduped.push(item)
  }

  // null = lookup failed: fall back to the local cache only, and say so.
  const remote = sync && deduped.length > 0
    ? await sync.remoteGetByKeys(args.projectId, deduped.map(d => d.key))
    : null
  const remoteUnavailable = sync !== null && deduped.length > 0 && remote === null

  const written: Memory[] = []
  // Plaintext per key, for the embedder.
  const plaintextByKey = new Map<string, string>()
  // Stored readable on purpose (as before 0.5.7): no read path for these rows
  // decrypts (conventions, project_brief, resources, the review queue, the
  // dashboard), so ciphertext here would make imported rules and pending
  // memories unreadable to agents and reviewers. Known gap; see CHANGELOG.
  const atRest = (plaintext: string): { value: string; encrypted: boolean } => ({ value: plaintext, encrypted: false })

  for (const item of deduped) {
    const local = cache.getByKey(args.projectId, item.key)
    const remoteRow = remote?.get(item.key) ?? null
    const existing = remoteRow ?? local

    if (existing) {
      if (strategy === 'skip') {
        // Seed the cache from the shared row so this machine stops treating
        // it as absent. Inserted as-is: remote id and created_by preserved.
        if (remoteRow && !local) cache.upsertMemory({ ...remoteRow, embedding: undefined }, false)
        skipped++
        continue
      }
      // overwrite: start from the remote row (if any) so id and created_by
      // stay the original author's. `encrypted` follows the NEW value (set by
      // atRest), not the old row; drop the stale embedding so the remote
      // vector is replaced by embedOnWrite rather than re-sent.
      const memory: Memory = {
        ...existing,
        ...atRest(item.value),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: item.type as any,
        updatedAt: now,
        source: 'import' as MemorySource,
        embedding: undefined,
        ...(callerUserId ? { updatedBy: callerUserId } : {}),
      }
      cache.upsertMemory(memory)
      written.push(memory)
      plaintextByKey.set(memory.key, item.value)
      imported++
    } else {
      const memory: Memory = {
        id: randomUUID(),
        projectId: args.projectId,
        key: item.key,
        ...atRest(item.value),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: item.type as any,
        source: 'import' as MemorySource,
        status: 'live',
        tags: [],
        filePaths: [],
        confidence: 1.0,
        createdAt: now,
        updatedAt: now,
        ...(callerUserId ? { createdBy: callerUserId, updatedBy: callerUserId } : {}),
      }
      cache.upsertMemory(memory)
      written.push(memory)
      plaintextByKey.set(memory.key, item.value)
      imported++
    }
  }

  // Push now rather than waiting for the 60s flush or the shutdown drain.
  let pushFailed = 0
  if (sync) {
    for (const memory of written) {
      const ok = await sync.remoteInsert(memory)
      if (ok) {
        const cached = cache.getByKey(args.projectId, memory.key)
        if (cached) cache.markSynced([cached.id])
      } else {
        pushFailed++
      }
    }
  }

  // Embeddings, after the push (remoteUpdateEmbedding needs the remote row).
  // One row at a time under ONE shared deadline: an import can be dozens of
  // rows, and firing them all at once bursts the hosted embed function (546 /
  // 429), whose bounded retry then yields null for most of them. Rows not
  // started by the deadline are NOT fanned out: they keep a null embedding
  // and the boot backfill (runEmbeddingBackfill) picks them up.
  // Chunk rows are keyed by the LOCAL row id, which can differ from the
  // remote id when the cache already held the key.
  const deadline = Date.now() + EMBED_TIMEOUT_MS
  let deferred = 0
  for (const memory of written) {
    const left = deadline - Date.now()
    if (left <= 0) {
      deferred++
      continue
    }
    const localId = cache.getByKey(args.projectId, memory.key)?.id ?? memory.id
    const job = { ...memory, id: localId }
    const plaintext = plaintextByKey.get(memory.key) ?? memory.value
    await embedOnWrite(job, plaintext, cache, sync, supabaseClient, { timeoutMs: left })
  }
  if (deferred > 0) {
    console.error(
      `[tages] import_claude_md: embedding deadline reached; ${deferred} of ${written.length} memories left ` +
        'without an embedding for the boot backfill to pick up',
    )
  }

  const notes: string[] = []
  if (blocked > 0) {
    notes.push(
      `Skipped ${blocked} ${blocked === 1 ? 'rule' : 'rules'} containing detected secrets ` +
        `(${[...blockedNames].join(', ')}); ${blocked === 1 ? 'it was' : 'they were'} not imported. ` +
        'Remove the secret from CLAUDE.md and re-import.',
    )
  }
  if (remoteUnavailable) {
    notes.push('Could not read the shared store, so "skip" was judged against this machine\'s cache only.')
  }
  if (pushFailed > 0) {
    notes.push(
      `${pushFailed} of ${written.length} imported memories did not reach the shared store (permission denied or ` +
        'unreachable); they are saved locally and teammates will not see them until a sync succeeds.',
    )
  }

  return {
    content: [{
      type: 'text',
      text: `Imported ${imported} memories (${skipped} skipped)${notes.length ? `\n\n${notes.join('\n')}` : ''}${formatSafetyWarnings(piiWarnings)}`,
    }],
  }
}
