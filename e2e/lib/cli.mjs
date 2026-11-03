// Drive the real CLI binary and the real MCP server as a given identity.
//
// Nothing here imports Tages source. The suite runs the same artifact an
// engineer runs — either the published npm tarball or a local `pnpm -r build`
// output — because the defect that killed the previous release candidate
// (`ReferenceError: exports is not defined in ES module scope`) was invisible
// to every in-process test and only appeared when a built entrypoint was
// executed by node.

import { spawnSync, spawn } from 'child_process'
import { redact } from './api.mjs'

/**
 * Run the CLI as `identity`. Never throws — a non-zero exit is data, since
 * several phases assert that a command *must* fail.
 *
 * spawnSync rather than execFileSync: execFileSync returns ONLY stdout on a
 * zero exit and surfaces stderr just in the thrown error, so every warning
 * printed by a *successful* command was being silently discarded. Tages prints
 * its cloud-sync failures to stderr while still exiting 0 — precisely the
 * signal these phases exist to catch.
 *
 * @returns {{code, out, stdout, stderr, timedOut, ms}} `out` is both streams,
 *          combined and redacted; `stdout`/`stderr` are kept separate for
 *          assertions that care which channel a message came from.
 */
export function cli(bin, identity, args, { cwd, timeoutMs = 120000, env = {} } = {}) {
  const started = Date.now()
  const r = spawnSync('node', [bin, ...args], {
    cwd: cwd || identity.work,
    env: identity.env(env),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  })
  const stdout = redact(r.stdout || '')
  const stderr = redact(r.stderr || '')
  return {
    code: r.status ?? -1,
    out: stdout + stderr,
    stdout,
    stderr,
    timedOut: r.signal === 'SIGTERM' || (r.error && r.error.code === 'ETIMEDOUT'),
    ms: Date.now() - started,
  }
}

/**
 * Boot the MCP server over stdio as `identity` and issue a sequence of
 * JSON-RPC calls, the same way Claude Code does.
 *
 * A fresh process per call is deliberate: server-side hydration runs once at
 * startup and sync is push-only, so "restart your agent" is the only way a
 * teammate sees new data. Reusing a long-lived process here would hide that.
 *
 * @param {Array<{method:string, params:object}>} calls issued in order after initialize
 * @param {object} opts
 * @param {boolean} opts.graceful  end the session the way a real MCP client does:
 *        SIGTERM, then wait for the server to drain. The default is SIGKILL, which
 *        is right for read-only probes but WRONG for anything that writes through
 *        the background sync queue (import_claude_md, archive_memory, verify_memory):
 *        those mark rows dirty and rely on the 60s flush or the shutdown drain, and
 *        SIGKILL skips both. Claude Code and Claude Desktop send SIGTERM.
 * @param {string} opts.command / opts.args / opts.env  launch something other than
 *        `node <serverBin>` (e.g. the exact command a teammate's .mcp.json holds).
 * @returns {Promise<{ok:boolean, why?:string, bootMs:number, responses:object[], stderr:string}>}
 */
export function mcp(serverBin, identity, calls, { timeoutMs = 60000, cwd, graceful = false, command, args, env } = {}) {
  return new Promise(resolve => {
    const started = Date.now()
    const proc = command
      ? spawn(command, args ?? [], { cwd: cwd || identity.work, env: identity.env(env ?? {}) })
      : spawn('node', [serverBin], { cwd: cwd || identity.work, env: identity.env(env ?? {}) })

    let stdout = ''
    let stderr = ''
    let bootMs = null
    const responses = []
    let nextCall = 0
    let settled = false

    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const done = () => resolve({ bootMs: bootMs ?? Date.now() - started, responses, stderr: redact(stderr), ...result })
      if (graceful && result.ok) {
        const hardKill = setTimeout(() => proc.kill('SIGKILL'), 15000)
        proc.once('exit', () => {
          clearTimeout(hardKill)
          done()
        })
        proc.kill('SIGTERM')
      } else {
        proc.kill('SIGKILL')
        done()
      }
    }

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          why: `timed out after ${timeoutMs}ms with ${responses.length}/${calls.length + 1} responses`,
        }),
      timeoutMs,
    )

    const send = msg => proc.stdin.write(`${JSON.stringify(msg)}\n`)

    // The MCP framing here is newline-delimited JSON, matching the stdio
    // transport. Parse line by line rather than regex-scanning the buffer, so a
    // response whose *content* contains the word "result" cannot be miscounted
    // as an extra reply — the previous ad-hoc harness counted `"result"`
    // occurrences and would have done exactly that.
    proc.stdout.on('data', chunk => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) continue
        let msg
        try {
          msg = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (msg.id === undefined) continue // notification, not a reply
        if (bootMs === null) bootMs = Date.now() - started
        responses.push(msg)
        if (nextCall < calls.length) {
          const call = calls[nextCall++]
          send({ jsonrpc: '2.0', id: nextCall + 1, method: call.method, params: call.params })
        } else {
          finish({ ok: true })
        }
      }
    })

    proc.stderr.on('data', d => {
      stderr += d
    })
    proc.on('error', err => finish({ ok: false, why: `spawn failed: ${err.message}` }))
    proc.on('exit', code => {
      if (!settled) finish({ ok: false, why: `server exited early with code ${code}` })
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tages-e2e', version: '1.0.0' },
      },
    })
  })
}

/** Flatten every text block an MCP tool response returned, for substring assertions. */
export function mcpText(response) {
  const blocks = response?.result?.content
  if (!Array.isArray(blocks)) return redact(JSON.stringify(response?.result ?? response ?? ''))
  return redact(blocks.map(b => b?.text ?? '').join('\n'))
}

/** Shorthand for a `tools/call` entry in an mcp() sequence. */
export function toolCall(name, args = {}) {
  return { method: 'tools/call', params: { name, arguments: args } }
}

/**
 * One MCP tool call in a fresh server process, returning the flattened text.
 * `ok:false` carries the reason so callers can put it in a check's detail.
 */
export async function mcpOne(serverBin, identity, name, args = {}, opts = {}) {
  const r = await mcp(serverBin, identity, [toolCall(name, args)], opts)
  const last = r.responses.at(-1)
  return {
    ok: r.ok && !last?.error && !last?.result?.isError,
    text: r.ok ? mcpText(last) : '',
    why: r.ok ? (last?.error ? JSON.stringify(last.error).slice(0, 200) : '') : `${r.why} :: ${r.stderr.slice(0, 200)}`,
    stderr: r.stderr,
    raw: r,
  }
}
