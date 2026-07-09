/**
 * Memory backend for the harness.
 *
 * EVAL-ONLY: this file is a harness ingestion/retrieval strategy, not a change
 * to the shipped `remember`/`recall` MCP tools or CLI behavior. It shells out
 * to the same public `tages remember`/`tages recall` CLI a real user would use.
 *
 * v1 strategy (InMemoryStore, and TagesCliStore's original behavior): per
 * question, each haystack session becomes ONE memory with the full session
 * transcript (role-prefixed) as the value.
 *
 * Task 4 (EVAL-ONLY, RQ1 resolved): TagesCliStore now ingests at TURN/ROUND
 * granularity instead of whole-session granularity — one memory per turn,
 * keyed `longmemeval-${question_id}-s${i}-t${j}`. Each per-round memory's text
 * still carries the `[session=<id> date=<date>]` tag so Task 6's recall@k
 * metric can attribute a recalled round back to its gold session id. This is
 * confirmed eval-harness-ingestion-strategy-only — it does not touch the
 * `remember` tool's schema, the `MemoryType` enum, or `remember.ts`'s
 * tier-limit enforcement (those stay exactly as they are for real product
 * users). InMemoryStore is unchanged (still session-level) since it exists
 * only as a no-Tages smoke-test floor.
 *
 * Two backends:
 *   - 'tages-cli': shell out to `tages remember` / `tages recall` against a real
 *     project. Requires TAGES_EVAL_PROJECT env var pointing at a sandbox project.
 *     Run the eval project on an uncapped (Pro-tier or limit-raised) plan —
 *     turn-level ingestion multiplies memory count per question ~5-20x versus
 *     session-level and can hit the free-tier 10k-memory limit.
 *   - 'in-memory': no Tages at all — stores session text in a Map and recalls via
 *     lexical substring score. Used for smoke-testing the pipeline without
 *     touching a real Tages instance. Sets a floor on the "memory" effect —
 *     Tages should beat it handily.
 */
import { execFileSync } from 'node:child_process'
import type { LongMemEvalQuestion, Turn } from './types.js'
import { SemanticDevStore } from './semantic-store.js'
import { OpenAICosineStore } from './openai-store.js'
import { VoyageCosineStore } from './voyage-store.js'

export type Backend = 'tages-cli' | 'in-memory' | 'tages-semantic' | 'openai-cosine' | 'voyage-cosine'

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

/**
 * Task 4: per-turn text, still carrying the `[session=<id> date=<date>]` tag
 * so a recalled round can be attributed back to its gold session id.
 */
export function turnToText(sessionId: string, date: string, turn: Turn): string {
  return `[session=${sessionId} date=${date}]\n${turn.role.toUpperCase()}: ${turn.content}`
}

/** Task 4: does this stderr text look like a free-tier/limit rejection from `tages remember`? */
export function looksLikeTierLimitRejection(stderr: string): boolean {
  return /\blimit\b/i.test(stderr)
}

export function makeStore(backend: Backend): MemoryStore {
  if (backend === 'in-memory') return new InMemoryStore()
  if (backend === 'tages-cli') return new TagesCliStore()
  if (backend === 'tages-semantic') return new SemanticDevStore()
  if (backend === 'openai-cosine') return new OpenAICosineStore()
  if (backend === 'voyage-cosine') return new VoyageCosineStore()
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
      const sessionId = q.haystack_session_ids[i] ?? `s${i}`
      const date = q.haystack_dates[i] ?? ''
      const turns = q.haystack_sessions[i]!
      for (let j = 0; j < turns.length; j++) {
        const text = turnToText(sessionId, date, turns[j]!)
        const key = `longmemeval-${q.question_id}-s${i}-t${j}`
        this.rememberOne(key, text)
        this.liveKeys.add(key)
      }
    }
  }

  /**
   * Task 4: fixes the silent-failure trap where `{ stdio: 'ignore' }` swallowed
   * the free-tier 10k-memory-limit rejection message from `remember` — turns
   * would silently fail to store past the cap with no error surfaced. stdout
   * is still discarded (unused), but stderr is captured so a tier-limit
   * rejection surfaces as a clear thrown error instead of a silent no-op.
   */
  private rememberOne(key: string, text: string): void {
    try {
      execFileSync(
        'tages',
        ['remember', key, text, '--project', this.project, '--type', 'entity'],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
    } catch (err) {
      const stderr = (err as { stderr?: Buffer | string })?.stderr
      const stderrText = stderr ? stderr.toString() : ''
      if (looksLikeTierLimitRejection(stderrText)) {
        throw new Error(
          `tages remember rejected key "${key}" (possible tier/memory-limit rejection): ${stderrText.trim()}. ` +
            'Run the eval project on an uncapped (Pro-tier or limit-raised) plan for turn-level ingestion.',
        )
      }
      throw err
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
