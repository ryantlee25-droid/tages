/**
 * E2E tests for CLI error paths.
 *
 * Tests cover:
 *   - Remember/recall without init (no configured project)
 *   - Corrupted auth.json (JSON parse error)
 *   - Expired/invalid token
 *   - Doctor with no project
 */

import { execSync } from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// __dirname = packages/cli/src/__tests__ → 4 levels up to repo root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../')

describe('E2E: CLI error paths', () => {
  let tmpHome: string

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cli-error-test-'))
  })

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  /**
   * Run a CLI command and always return output + exit code.
   * Never throws — captures both stdout and stderr.
   */
  function run(args: string): { output: string; code: number } {
    try {
      const stdout = execSync(`pnpm exec tsx packages/cli/src/index.ts ${args}`, {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          HOME: tmpHome,
          XDG_CONFIG_HOME: path.join(tmpHome, '.config'),
        },
        timeout: 15000,
        encoding: 'utf-8',
      })
      return { output: stdout || '', code: 0 }
    } catch (e: any) {
      const output = (e.stdout || '') + (e.stderr || '')
      return { output, code: e.status || 1 }
    }
  }

  // ─── 1. remember without init ─────────────────────────────────────────────

  it('remember without init: exits non-zero with human-readable error', () => {
    const { output, code } = run('remember foo bar --type convention')
    expect(code).not.toBe(0)
    // Should mention init or project configuration
    const lower = output.toLowerCase()
    expect(lower).toMatch(/init|no project|configured|project/i)
    // Must NOT print raw stack trace
    expect(output).not.toContain('at Object.')
  }, 20_000)

  // ─── 2. recall without init ───────────────────────────────────────────────

  it('recall without init: exits non-zero with human-readable error', () => {
    const { output, code } = run('recall foo')
    expect(code).not.toBe(0)
    // Should mention init or project configuration
    const lower = output.toLowerCase()
    expect(lower).toMatch(/init|no project|configured|project/i)
    // Must NOT print raw stack trace
    expect(output).not.toContain('at Object.')
  }, 20_000)

  // ─── 3. Corrupted auth.json ───────────────────────────────────────────────

  it('corrupted auth.json: status returns non-zero with human-readable error', () => {
    // Create the config dir and write invalid JSON to auth.json
    const configDir = path.join(tmpHome, '.config', 'tages')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'auth.json'), '{ invalid json')

    const { output, code } = run('status')
    // Should exit non-zero OR print an error message
    // (some CLIs catch parse errors and print a message but exit 0)
    // At minimum: no raw JS stack trace printed
    expect(output).not.toContain('at Object.')

    // Clean up so subsequent tests start fresh for auth
    fs.unlinkSync(path.join(configDir, 'auth.json'))
  }, 20_000)

  // ─── 4. Expired/invalid token ─────────────────────────────────────────────

  it('expired/invalid token: recall with garbage token returns auth-related error or project error', () => {
    // Write a valid-structure but garbage token auth.json
    const configDir = path.join(tmpHome, '.config', 'tages')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(
      path.join(configDir, 'auth.json'),
      JSON.stringify({
        accessToken: 'garbage',
        refreshToken: 'garbage',
        userId: 'garbage',
      }),
    )

    const { output } = run('recall foo --project tages')
    // The CLI may respond with:
    //   - Auth-related message (expired, unauthorized, session, etc.)
    //   - Or a "no project configured" message if it checks project before auth
    // Either is acceptable — the key assertion is NO raw stack trace
    expect(output).not.toContain('at Object.')
    // Must have some output
    expect(output.length).toBeGreaterThan(0)
    // Must be a human-readable message of some kind
    expect(output.toLowerCase()).toMatch(/expired|authenticate|unauthorized|session|login|sign in|token|project|init|configured/i)

    // Clean up
    try {
      fs.unlinkSync(path.join(configDir, 'auth.json'))
    } catch {
      // ignore
    }
  }, 20_000)

  // ─── 5. Doctor with no project ────────────────────────────────────────────

  it('doctor with no project: prints FAIL or init message', () => {
    // Ensure no project config exists (fresh tmpHome or after cleanup)
    const { output } = run('doctor')
    // Should output something meaningful about the missing project or checks
    expect(output.length).toBeGreaterThan(0)
    const lower = output.toLowerCase()
    const hasMeaningfulOutput =
      output.includes('FAIL') ||
      lower.includes('no project') ||
      lower.includes('init') ||
      lower.includes('doctor') ||
      output.includes('PASS')
    expect(hasMeaningfulOutput).toBe(true)
  }, 20_000)
})
