import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { LongMemEvalQuestion, QuestionType } from './types.js'

const DATA_PATH = resolve(
  import.meta.dirname ?? '.',
  '..',
  'data',
  'longmemeval_oracle.json',
)

export function loadOracle(): LongMemEvalQuestion[] {
  const raw = readFileSync(DATA_PATH, 'utf8')
  return JSON.parse(raw) as LongMemEvalQuestion[]
}

export function computeOracleSha(): string {
  const raw = readFileSync(DATA_PATH)
  return createHash('sha1').update(raw).digest('hex')
}

/**
 * Stratified sample by question_type with a deterministic seed.
 * Allocates proportional counts per type; rounds to hit `n` exactly
 * by using a Largest Remainder method.
 */
export function stratifiedSample(
  all: LongMemEvalQuestion[],
  n: number,
  seed: number,
): LongMemEvalQuestion[] {
  const rng = mulberry32(seed)
  const byType = new Map<QuestionType, LongMemEvalQuestion[]>()
  for (const q of all) {
    const list = byType.get(q.question_type) ?? []
    list.push(q)
    byType.set(q.question_type, list)
  }

  const types = [...byType.keys()]
  const total = all.length
  const rawAllocations = types.map((t) => ({
    type: t,
    exact: (byType.get(t)!.length / total) * n,
  }))
  const alloc = new Map<QuestionType, number>()
  let assigned = 0
  for (const { type, exact } of rawAllocations) {
    const floor = Math.floor(exact)
    alloc.set(type, floor)
    assigned += floor
  }
  const remainders = [...rawAllocations]
    .map((a) => ({ ...a, rem: a.exact - Math.floor(a.exact) }))
    .sort((a, b) => b.rem - a.rem)
  let i = 0
  while (assigned < n && i < remainders.length) {
    alloc.set(remainders[i]!.type, alloc.get(remainders[i]!.type)! + 1)
    assigned++
    i++
  }

  const out: LongMemEvalQuestion[] = []
  for (const t of types) {
    const pool = shuffled(byType.get(t)!, rng)
    const take = alloc.get(t) ?? 0
    out.push(...pool.slice(0, take))
  }
  return shuffled(out, rng)
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

// Mulberry32 PRNG — small, fast, deterministic.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
