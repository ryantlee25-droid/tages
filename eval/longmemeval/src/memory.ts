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

class TagesCliStore implements MemoryStore {
  backend: Backend = 'tages-cli'
  private project: string

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
      const key = `longmemeval/${q.question_id}/session-${i}`
      execFileSync('tages', [
        'remember',
        '--project', this.project,
        '--key', key,
        '--value', text,
        '--type', 'fact',
      ], { stdio: 'ignore' })
    }
  }

  async recall(query: string, topK: number): Promise<string[]> {
    const out = execFileSync('tages', [
      'recall',
      '--project', this.project,
      '--query', query,
      '--limit', String(topK),
      '--json',
    ], { encoding: 'utf8' })
    try {
      const parsed = JSON.parse(out)
      if (Array.isArray(parsed)) {
        return parsed.map((r: any) => String(r.value ?? '')).filter(Boolean)
      }
      if (parsed && Array.isArray(parsed.results)) {
        return parsed.results.map((r: any) => String(r.value ?? '')).filter(Boolean)
      }
      return []
    } catch {
      return []
    }
  }

  async clear(): Promise<void> {
    execFileSync('tages', ['forget', '--project', this.project, '--prefix', 'longmemeval/'], {
      stdio: 'ignore',
    })
  }
}
