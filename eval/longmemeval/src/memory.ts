/**
 * Memory backend for the harness.
 *
 * v1 strategy: per-question, each haystack session becomes ONE memory with the
 * full session transcript (role-prefixed) as the value. Recall queries Tages
 * with the question text and returns up to top-k matching memory values.
 *
 * Two backends:
 *   - 'tages-cli': shell out to `tages remember` / `tages recall` against a real
 *     project. Requires TAGES_EVAL_PROJECT env var pointing at a sandbox project.
 *   - 'in-memory': no Tages at all — stores session text in a Map and recalls via
 *     lexical substring score. Used for smoke-testing the pipeline without
 *     touching a real Tages instance. Sets a floor on the "memory" effect —
 *     Tages should beat it handily.
 */
import { execFileSync } from 'node:child_process'
import type { LongMemEvalQuestion, Turn } from './types.js'

export type Backend = 'tages-cli' | 'in-memory'

export interface MemoryStore {
  backend: Backend
  ingest(question: LongMemEvalQuestion): Promise<void>
  recall(query: string, topK: number): Promise<string[]>
  clear(): Promise<void>
}

function sessionToText(sessionId: string, date: string, turns: Turn[]): string {
  const body = turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join('\n\n')
  return `[session=${sessionId} date=${date}]\n${body}`
}

export function makeStore(backend: Backend): MemoryStore {
  if (backend === 'in-memory') return new InMemoryStore()
  if (backend === 'tages-cli') return new TagesCliStore()
  throw new Error(`Unknown backend: ${backend}`)
}

class InMemoryStore implements MemoryStore {
  backend: Backend = 'in-memory'
  private memories: string[] = []

  async ingest(q: LongMemEvalQuestion): Promise<void> {
    this.memories = q.haystack_sessions.map((turns, i) =>
      sessionToText(q.haystack_session_ids[i] ?? `s${i}`, q.haystack_dates[i] ?? '', turns),
    )
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const qTokens = new Set(query.toLowerCase().match(/\w{3,}/g) ?? [])
    const scored = this.memories.map((m) => {
      const mTokens = m.toLowerCase().match(/\w{3,}/g) ?? []
      let hits = 0
      for (const t of mTokens) if (qTokens.has(t)) hits++
      return { m, score: hits }
    })
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.m)
  }

  async clear(): Promise<void> {
    this.memories = []
  }
}

/**
 * Tages CLI integration uses positional `<key> <value>` for remember and
 * positional `<key>` for forget (no --prefix). Recall does NOT yet support
 * --json, so we parse the human-readable output heuristically.
 *
 * TODO: add `--json` flag to `tages recall` in packages/cli (out of scope for
 * Sprint B scaffold). Parsing here is fragile but sufficient for calibration.
 * Tracked keys across a run so clear() can forget them one by one.
 */
class TagesCliStore implements MemoryStore {
  backend: Backend = 'tages-cli'
  private project: string
  private liveKeys = new Set<string>()

  constructor() {
    const p = process.env.TAGES_EVAL_PROJECT
    if (!p) {
      throw new Error(
        'TAGES_EVAL_PROJECT env var is required for the tages-cli backend. Set it to a sandbox project slug.',
      )
    }
    this.project = p
  }

  async ingest(q: LongMemEvalQuestion): Promise<void> {
    await this.clear()
    for (let i = 0; i < q.haystack_sessions.length; i++) {
      const text = sessionToText(
        q.haystack_session_ids[i] ?? `s${i}`,
        q.haystack_dates[i] ?? '',
        q.haystack_sessions[i]!,
      )
      const key = `longmemeval-${q.question_id}-s${i}`
      execFileSync(
        'tages',
        ['remember', key, text, '--project', this.project, '--type', 'fact'],
        { stdio: 'ignore' },
      )
      this.liveKeys.add(key)
    }
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const out = execFileSync(
      'tages',
      ['recall', query, '--project', this.project, '--limit', String(topK)],
      { encoding: 'utf8' },
    )
    return parseRecallOutput(out)
  }

  async clear(): Promise<void> {
    for (const key of this.liveKeys) {
      try {
        execFileSync('tages', ['forget', key, '--project', this.project], { stdio: 'ignore' })
      } catch {
        // Already gone; ignore.
      }
    }
    this.liveKeys.clear()
  }
}

/**
 * Parse `tages recall` human output.
 *
 * Format (as of packages/cli@0.2.1):
 *   Found N memories (<algorithm>):
 *
 *     <type>     <key>
 *                <value line 1>
 *                <value line 2>
 *                similarity: 0.45 [trigram]
 *
 * We group lines by detecting the blank-line separator and the 15-space indent
 * on value lines. The "similarity:" line ends each block. Returns value strings.
 */
function parseRecallOutput(text: string): string[] {
  const lines = text.split('\n')
  const values: string[] = []
  let currentValue: string[] = []
  let inBlock = false

  for (const line of lines) {
    if (line.startsWith('Found ')) continue
    if (/^\s*similarity:/.test(line)) {
      if (currentValue.length > 0) values.push(currentValue.join(' ').trim())
      currentValue = []
      inBlock = false
      continue
    }
    // Header line: two-space-indent type + key. Starts a block.
    if (/^  \S+\s+\S+/.test(line) && !line.startsWith('               ')) {
      if (currentValue.length > 0) values.push(currentValue.join(' ').trim())
      currentValue = []
      inBlock = true
      continue
    }
    // Value continuation: 15-space indent.
    if (inBlock && line.startsWith('               ')) {
      currentValue.push(line.trim())
    }
  }
  if (currentValue.length > 0) values.push(currentValue.join(' ').trim())
  return values.filter(Boolean)
}
