/**
 * LongMemEval harness runner.
 *
 * Usage:
 *   tsx src/run.ts --n 50 --seed 42 --backend tages-cli --output results/run.json
 *   tsx src/run.ts --dry-run --n 5 --backend in-memory
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { loadOracle, stratifiedSample, computeOracleSha } from './dataset.js'
import { makeStore, type Backend } from './memory.js'
import { generateAnswer, judge, estimateCostUsd, type LlmCost } from './answer.js'
import type { RunResult, QuestionType } from './types.js'

interface Args {
  n: number
  seed: number
  backend: Backend
  topK: number
  output: string
  dryRun: boolean
  help: boolean
}

function parseArgs(raw: string[]): Args {
  const args: Args = {
    n: 50,
    seed: 42,
    backend: 'in-memory',
    // Task 4: bumped from 10 to 30. Turn-level ingestion (memory.ts) multiplies
    // row count per question ~5-20x versus session-level; a topK tuned for
    // session-level retrieval under-retrieves at turn-level.
    topK: 30,
    output: '',
    dryRun: false,
    help: false,
  }
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]
    if (a === '-h' || a === '--help') args.help = true
    else if (a === '--n') args.n = Number(raw[++i])
    else if (a === '--seed') args.seed = Number(raw[++i])
    else if (a === '--backend') args.backend = raw[++i] as Backend
    else if (a === '--top-k') args.topK = Number(raw[++i])
    else if (a === '--output') args.output = raw[++i]!
    else if (a === '--dry-run') args.dryRun = true
    else throw new Error(`Unknown arg: ${a}`)
  }
  return args
}

const USAGE = `
tages-longmemeval — LongMemEval harness for Tages

Usage:
  tsx src/run.ts [options]

Options:
  --n <num>          Number of questions to sample (default 50)
  --seed <num>       PRNG seed for stratified sample (default 42)
  --backend <name>   Memory backend: 'tages-cli' | 'in-memory' (default 'in-memory')
  --top-k <num>      Number of memories to retrieve per question (default 30;
                     bumped from 10 for turn-level ingestion, see memory.ts)
  --output <path>    Where to write results JSON (required unless --dry-run)
  --dry-run          Sample and print first question + memory count, don't call API
  -h, --help         Show this message

Backends:
  in-memory   — Lexical substring match on a local Map. No API key, no Tages.
                Used for pipeline smoke test; sets a floor Tages should beat.
  tages-cli   — Shells out to the tages CLI. Requires TAGES_EVAL_PROJECT env var
                pointing to a sandbox project. Do NOT use your real project.

Required env:
  OPENAI_API_KEY     OpenAI key with GPT-4o access (not required for --dry-run).
  TAGES_EVAL_PROJECT Project slug for the 'tages-cli' backend (ignored otherwise).
`.trim()

/**
 * Task 6: parse the `[session=<id> ...]` tag that memory.ts's sessionToText/
 * turnToText prepend to every stored memory. Returns null if the tag is
 * missing or malformed rather than throwing — this is plain-text regex
 * matching against LLM-adjacent free text, so defensive handling avoids
 * false negatives skewing the recall@k metric.
 */
export function parseSessionId(memoryText: string): string | null {
  const match = /\[session=([^\s\]]+)/.exec(memoryText)
  return match ? match[1]! : null
}

/**
 * Task 6: does at least one recalled memory's tagged session id appear in the
 * gold `answer_session_ids` set? This is the recall@k metric — it measures
 * whether the right evidence was retrieved, independent of whether the
 * synthetic reader phrased an answer correctly.
 */
export function computeRecallGoldHit(memories: string[], goldSessionIds: string[]): boolean {
  const goldSet = new Set(goldSessionIds)
  for (const m of memories) {
    const sid = parseSessionId(m)
    if (sid && goldSet.has(sid)) return true
  }
  return false
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(USAGE)
    return
  }
  if (!args.output && !args.dryRun) {
    throw new Error('--output is required (or use --dry-run)')
  }
  if (!args.dryRun && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required (or use --dry-run)')
  }

  const all = loadOracle()
  const sample = stratifiedSample(all, args.n, args.seed)
  console.log(`Sampled ${sample.length} of ${all.length} questions (seed=${args.seed}).`)
  for (const t of countByType(sample)) {
    console.log(`  ${t.type.padEnd(30)} ${t.count}`)
  }

  if (args.dryRun) {
    const first = sample[0]!
    console.log('\nFirst question:')
    console.log(`  id: ${first.question_id}`)
    console.log(`  type: ${first.question_type}`)
    console.log(`  q: ${first.question}`)
    console.log(`  truth: ${first.answer}`)
    console.log(`  sessions: ${first.haystack_sessions.length}`)
    return
  }

  const store = makeStore(args.backend)
  const start = Date.now()
  const totals: LlmCost = { prompt_tokens: 0, completion_tokens: 0 }
  const details: NonNullable<RunResult['details']> = []
  const failures: RunResult['failures'] = []

  for (let i = 0; i < sample.length; i++) {
    const q = sample[i]!
    const prefix = `[${i + 1}/${sample.length}] ${q.question_id} (${q.question_type})`
    try {
      await store.clear()
      await store.ingest(q)
      const memories = await store.recall(q.question, args.topK)
      const isAbstention = q.question_id.endsWith('_abs')
      const { answer, cost: genCost } = await generateAnswer(
        q.question,
        memories,
        q.question_type,
        q.question_date,
      )
      const { correct, cost: judgeCost } = await judge(
        q.question,
        q.answer,
        answer,
        q.question_type,
        isAbstention,
      )
      totals.prompt_tokens += genCost.prompt_tokens + judgeCost.prompt_tokens
      totals.completion_tokens += genCost.completion_tokens + judgeCost.completion_tokens
      const recalledGoldHit = computeRecallGoldHit(memories, q.answer_session_ids)
      details.push({
        question_id: q.question_id,
        question_type: q.question_type,
        correct,
        model_answer: answer,
        ground_truth: q.answer,
        recalled_memory_count: memories.length,
        recalled_memories: memories,
        gold_session_ids: q.answer_session_ids,
        recalled_gold_hit: recalledGoldHit,
      })
      console.log(
        `${prefix} ${correct ? 'correct' : 'incorrect'} (${memories.length} memories, recall@k ${recalledGoldHit ? 'hit' : 'miss'})`,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      failures.push({ question_id: q.question_id, reason })
      console.error(`${prefix} FAILED: ${reason}`)
    }
  }

  const duration = Math.round((Date.now() - start) / 1000)
  const result = buildResult(args, sample, details, failures, totals, duration)
  const abs = resolve(args.output)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`\nOverall accuracy (synthetic reader): ${(result.overall_accuracy * 100).toFixed(1)}% (${details.filter((d) => d.correct).length}/${details.length})`)
  for (const [type, acc] of Object.entries(result.accuracy_by_type)) {
    console.log(`  ${type.padEnd(30)} ${((acc as number) * 100).toFixed(1)}%`)
  }
  console.log(`Recall@k (retrieval quality): ${(result.recall_at_k * 100).toFixed(1)}%`)
  for (const [type, r] of Object.entries(result.recall_at_k_by_type)) {
    console.log(`  ${type.padEnd(30)} ${((r as number) * 100).toFixed(1)}%`)
  }
  console.log(`Duration: ${duration}s  Est. cost: $${result.cost_usd_estimate.toFixed(2)}`)
  console.log(`Results: ${abs}`)

  if (result.overall_accuracy < 0.7 && sample.length <= 100) {
    console.warn('\nFLIP SIGNAL: overall accuracy < 70% on calibration. Stop before full run; debug retrieval.')
    process.exitCode = 2
  }
}

function countByType(sample: Array<{ question_type: QuestionType }>) {
  const m = new Map<QuestionType, number>()
  for (const q of sample) m.set(q.question_type, (m.get(q.question_type) ?? 0) + 1)
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
}

export function buildResult(
  args: Args,
  sample: Array<{ question_type: QuestionType }>,
  details: NonNullable<RunResult['details']>,
  failures: RunResult['failures'],
  totals: LlmCost,
  duration: number,
): RunResult {
  const correctCount = details.filter((d) => d.correct).length
  const overall = details.length === 0 ? 0 : correctCount / details.length

  const byType = new Map<QuestionType, { correct: number; total: number; recallHits: number }>()
  for (const d of details) {
    const prev = byType.get(d.question_type) ?? { correct: 0, total: 0, recallHits: 0 }
    prev.total++
    if (d.correct) prev.correct++
    if (d.recalled_gold_hit) prev.recallHits++
    byType.set(d.question_type, prev)
  }
  const accuracy_by_type: Partial<Record<QuestionType, number>> = {}
  const recall_at_k_by_type: Partial<Record<QuestionType, number>> = {}
  for (const [t, c] of byType) {
    accuracy_by_type[t] = c.correct / c.total
    recall_at_k_by_type[t] = c.recallHits / c.total
  }

  const recallHitCount = details.filter((d) => d.recalled_gold_hit).length
  const recall_at_k = details.length === 0 ? 0 : recallHitCount / details.length

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return {
    run_id: `tages-${args.backend}-n${args.n}-seed${args.seed}-${ts}`,
    dataset_sha: computeOracleSha(),
    model_answer: 'gpt-4o-2024-08-06',
    model_judge: 'gpt-4o-2024-08-06',
    tages_version: 'dev',
    n: sample.length,
    overall_accuracy: overall,
    accuracy_by_type,
    recall_at_k,
    recall_at_k_by_type,
    duration_seconds: duration,
    cost_usd_estimate: estimateCostUsd(totals),
    failures,
    details,
  }
}

// Only run the CLI entrypoint when this file is executed directly (not when
// imported by tests) — guards against `main()` firing (and potentially
// calling `process.exit`) as a side effect of importing helpers for unit tests.
const isMainModule = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === `file://${resolve(entry)}`
})()

if (isMainModule) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
