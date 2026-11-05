// Small helpers shared by phases 12-16: the same question asked through every
// surface a teammate or an agent can use, with the cache evidence attached.
//
// Why this exists: "does recall return X" is not one question in Tages. The CLI
// asks Supabase directly. The MCP server answers from its local SQLite cache
// first and only falls back to the cloud when the cache has no hit. A
// memory can therefore be correct in the cloud and wrong in an agent's context,
// and the only way to know is to ask each surface separately.

import { cli, mcpOne } from './cli.mjs'
import { head } from './harness.mjs'

/** The unique stamp of this run, without the `tages-e2e-` prefix. */
export function stampOf(ctx) {
  return ctx.fixturePrefix.replace(/^tages-e2e-/, '')
}

/** True when `text` contains any of the (truthy) needles. */
export function has(text, ...needles) {
  return needles.filter(Boolean).some(n => text.includes(n))
}

/** The server's own cache log lines (stderr), which say whether hydration ran or was skipped. */
export function cacheNote(stderr) {
  const lines = String(stderr)
    .split('\n')
    .filter(l => /Cache fresh|Cache is current|Delta sync|Hydrated|Hydration|Held sync/i.test(l))
    .map(l => l.replace(/^\[tages\]\s*/, '').trim())
  return lines.length ? lines.join(' / ') : 'no hydration line'
}

/** `tages recall <query>` as `who`. Reads Supabase directly. */
export function cliRecall(bins, who, query, extraArgs = []) {
  return cli(bins.cliBin, who, ['recall', query, ...extraArgs])
}

/** MCP `recall` in a fresh server process, i.e. "restart your agent, then ask". */
export function mcpRecall(bins, who, query, limit = 5, opts = {}) {
  return mcpOne(bins.serverBin, who, 'recall', { query, limit }, opts)
}

/**
 * Run `attempt()` repeatedly until `accept(result)` is true or the deadline
 * passes. Unlike harness.poll this returns the LAST result either way, so a
 * caller can both assert on convergence and print what the surface said.
 */
export async function converge(attempt, accept, { timeoutMs = 100000, intervalMs = 6000 } = {}) {
  const started = Date.now()
  let last = null
  let attempts = 0
  const trail = []
  while (Date.now() - started < timeoutMs) {
    attempts++
    last = await attempt()
    trail.push(cacheNote(last?.stderr ?? ''))
    if (accept(last)) return { ok: true, last, attempts, ms: Date.now() - started, trail }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return { ok: false, last, attempts, ms: Date.now() - started, trail }
}

export function out(r) {
  return r?.out ?? r?.text ?? ''
}

export { head }
