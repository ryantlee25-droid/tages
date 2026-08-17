// Reporting, assertion, and polling primitives for the Tages E2E suite.
//
// Two rules this file exists to enforce:
//
//   1. A check that cannot fail is not a check. `check()` records outcomes into
//      a shared report and the runner exits non-zero on any failure. Phase 99
//      (negative controls) proves at runtime that this machinery actually
//      registers a failure, because a suite whose assertions are all vacuously
//      green is worse than no suite at all.
//
//   2. Never `sleep()` at an eventually-consistent boundary. Tages writes to
//      SQLite first and flushes to Supabase asynchronously, so "the row is in
//      the cloud" is a condition to poll for, not a duration to guess at. Every
//      wait in this suite is expressed as an assertion with a deadline.

import * as fs from 'fs'
import * as path from 'path'

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  green: s => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  red: s => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: s => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  dim: s => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
  bold: s => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
}

export class Report {
  constructor() {
    this.results = []
    this.phase = '(none)'
    this.skipped = []
  }

  startPhase(title) {
    this.phase = title
    console.log(`\n${c.bold(`━━ ${title} `.padEnd(72, '━'))}`)
  }

  /**
   * Record one assertion. `detail` is shown always (not just on failure) so a
   * passing run still carries the evidence for why it passed — a green line
   * with no observed value is indistinguishable from a check that never ran.
   */
  check(name, pass, detail = '') {
    const rec = { phase: this.phase, name, pass: !!pass, detail: String(detail ?? '') }
    this.results.push(rec)
    const tag = pass ? c.green('PASS') : c.red('FAIL')
    console.log(`  ${tag}  ${name}`)
    if (rec.detail) console.log(`        ${c.dim(truncate(rec.detail, 400))}`)
    return !!pass
  }

  /** A condition the suite deliberately does not assert on this run. Never counted as a pass. */
  skip(name, why) {
    this.skipped.push({ phase: this.phase, name, why })
    console.log(`  ${c.yellow('SKIP')}  ${name}`)
    console.log(`        ${c.dim(why)}`)
  }

  get failures() {
    return this.results.filter(r => !r.pass)
  }

  summary() {
    const total = this.results.length
    const failed = this.failures
    const passed = total - failed.length
    console.log(`\n${c.bold('━'.repeat(72))}`)
    const line = `${passed}/${total} checks passed`
    console.log(failed.length ? c.red(c.bold(line)) : c.green(c.bold(line)))
    if (this.skipped.length) console.log(c.yellow(`${this.skipped.length} skipped`))

    if (failed.length) {
      console.log(`\n${c.red(c.bold('FAILURES'))}`)
      let current = null
      for (const f of failed) {
        if (f.phase !== current) {
          current = f.phase
          console.log(`\n  ${c.bold(current)}`)
        }
        console.log(`    ${c.red('x')} ${f.name}`)
        if (f.detail) console.log(`      ${c.dim(truncate(f.detail, 400))}`)
      }
      console.log('')
    }
    return failed.length === 0
  }

  writeJson(file, extra = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const total = this.results.length
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          ...extra,
          total,
          passed: total - this.failures.length,
          failed: this.failures.length,
          skipped: this.skipped.length,
          results: this.results,
          skippedChecks: this.skipped,
        },
        null,
        2,
      ),
    )
    return file
  }
}

/**
 * Poll `fn` until it returns a truthy value or the deadline passes.
 *
 * Returns { ok, value, ms, attempts }. Callers assert on `ok` — the timeout is
 * the failure, never a silent fall-through, which is how a "wait then assume"
 * helper turns an eventual-consistency bug into a green test.
 */
export async function poll(fn, { timeoutMs = 30000, intervalMs = 750, label = 'condition' } = {}) {
  const started = Date.now()
  let attempts = 0
  let lastErr = null
  while (Date.now() - started < timeoutMs) {
    attempts++
    try {
      const value = await fn()
      if (value) return { ok: true, value, ms: Date.now() - started, attempts, label }
    } catch (err) {
      lastErr = err
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return {
    ok: false,
    value: null,
    ms: Date.now() - started,
    attempts,
    label,
    error: lastErr ? String(lastErr.message || lastErr) : null,
  }
}

/** Human-readable outcome of a poll, for a check's detail column. */
export function pollDetail(r) {
  return r.ok
    ? `settled after ${r.ms}ms (${r.attempts} ${r.attempts === 1 ? 'attempt' : 'attempts'})`
    : `TIMED OUT after ${r.ms}ms (${r.attempts} attempts)${r.error ? ` — last error: ${r.error}` : ''}`
}

export function truncate(s, n) {
  const flat = String(s).replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}

/** First `n` lines of a command's combined output, flattened for one-line display. */
export function head(s, n = 3) {
  return String(s)
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, n)
    .join(' | ')
}

export function tail(s, n = 3) {
  return String(s)
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-n)
    .join(' | ')
}

export { c as color }
