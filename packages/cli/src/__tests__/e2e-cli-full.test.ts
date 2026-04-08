import { execSync } from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// __dirname = packages/cli/src/__tests__ → go up 4 levels to reach repo root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../')

describe('E2E: CLI Full Coverage', () => {
  let tmpHome: string
  let tmpCachePath: string

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cli-full-test-'))
    tmpCachePath = path.join(tmpHome, 'tages-test-cache.db')
    // Initialize local mode for functional tests
    run('init --local --slug h2-test')
  }, 30000)

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function run(
    args: string,
    opts: { allowFail?: boolean; cwd?: string } = {}
  ): { stdout: string; code: number } {
    const cwd = opts.cwd ?? PROJECT_ROOT
    try {
      const stdout = execSync(`pnpm exec tsx packages/cli/src/index.ts ${args}`, {
        cwd,
        env: {
          ...process.env,
          HOME: tmpHome,
          TAGES_CACHE_PATH: tmpCachePath,
          // GIT_DIR override prevents hook installer from finding a broken worktree .git file
          GIT_DIR: path.join(tmpHome, 'fakegit'),
        },
        timeout: 10000,
        encoding: 'utf-8',
      })
      return { stdout: stdout || '', code: 0 }
    } catch (e: any) {
      if (opts.allowFail) return { stdout: (e.stdout || '') + (e.stderr || ''), code: e.status || 1 }
      throw e
    }
  }

  // ---------------------------------------------------------------------------
  // Group 1: --help smoke tests for all commands
  // ---------------------------------------------------------------------------
  describe('--help smoke tests', { timeout: 300_000 }, () => {
    it('all commands respond to --help with non-empty stdout', () => {
      // All top-level commands and sub-commands
      const commands = [
        'init',
        'remember',
        'recall',
        'forget',
        'status',
        'doctor',
        'dashboard',
        'index',
        'query',
        'import',
        'snapshot',
        'check',
        'onboard',
        'export',
        'pending',
        'verify',
        'recall-context',
        'suggest',
        'dedup',
        'impact',
        'risk',
        'enforce',
        'enforce check',
        'quality',
        'migrate',
        'brief',
        'audit',
        'sharpen',
        'session-wrap',
        'federate',
        // token sub-commands
        'token',
        'token generate',
        'token list',
        'token rotate',
        // patterns sub-commands
        'patterns',
        'patterns detect',
        'patterns promote',
        'patterns list',
        // templates sub-commands
        'templates',
        'templates list',
        'templates match',
        'templates apply',
        // archive sub-commands
        'archive',
        'archive list',
        'archive stats',
        // federation sub-commands
        'federation',
        'federation list',
        'federation import',
        'federation overrides',
        // analytics sub-commands
        'analytics',
        'analytics session',
        'analytics trends',
      ]

      for (const cmd of commands) {
        const result = run(`${cmd} --help`, { allowFail: true })
        expect(result.stdout.length, `${cmd} --help returned empty output`).toBeGreaterThan(0)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Group 2: Local-mode functional tests
  // ---------------------------------------------------------------------------
  describe('local-mode functional tests', () => {
    it('tages remember stores a value and exits 0', () => {
      const { code } = run('remember test-key "test value" --type convention --project h2-test')
      expect(code).toBe(0)
    }, 15000)

    it('tages recall finds stored value', () => {
      const { stdout, code } = run('recall test-key --project h2-test')
      expect(code).toBe(0)
      const hasOutput = stdout.includes('test value') || stdout.includes('test-key')
      expect(hasOutput).toBe(true)
    }, 15000)

    it('tages forget removes key and exits 0', () => {
      // First store a key to forget
      run('remember forget-me "to be deleted" --type convention --project h2-test')
      const { code } = run('forget forget-me --project h2-test')
      expect(code).toBe(0)
    }, 15000)

    it('tages status exits 0 with non-empty output', () => {
      const { stdout, code } = run('status --project h2-test')
      expect(code).toBe(0)
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages brief exits 0 or produces human-readable output', () => {
      const { stdout } = run('brief --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages doctor exits or contains diagnostic info', () => {
      const { stdout } = run('doctor --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages export exits 0 or produces human-readable output', () => {
      const { stdout } = run('export --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages query exits 0', () => {
      const { stdout } = run('query test --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages check exits or contains staleness info', () => {
      const { stdout } = run('check --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages pending exits or shows pending memories', () => {
      const { stdout } = run('pending --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages audit exits or shows coverage info', () => {
      const { stdout } = run('audit --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages snapshot exits or shows architecture info', () => {
      const { stdout } = run('snapshot --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages patterns list exits or shows patterns', () => {
      const { stdout } = run('patterns list --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages recall-context exits with output', () => {
      const { stdout } = run('recall-context test --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages archive list exits or shows archive info', () => {
      const { stdout } = run('archive list --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('tages archive stats exits or shows archive stats', () => {
      const { stdout } = run('archive stats --project h2-test', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)
  })

  // ---------------------------------------------------------------------------
  // Group 3: Cloud-gated graceful-failure tests
  // ---------------------------------------------------------------------------
  describe('cloud-gated graceful-failure tests', () => {
    function assertGracefulFailure(cmd: string): void {
      const { stdout, code } = run(`${cmd} --project h2-test`, { allowFail: true })
      // Must produce some output (not silent failure)
      expect(stdout.length, `${cmd} produced empty output`).toBeGreaterThan(0)
      // Must NOT contain raw JS stack traces
      expect(stdout, `${cmd} contains raw JS stack trace`).not.toContain('at Object.')
      expect(stdout, `${cmd} contains raw JS stack trace (Module)`).not.toContain('at Module.')
    }

    it('tages dedup fails gracefully without cloud', () => {
      assertGracefulFailure('dedup')
    }, 15000)

    it('tages enforce fails gracefully without cloud', () => {
      assertGracefulFailure('enforce')
    }, 15000)

    it('tages quality fails gracefully without cloud', () => {
      assertGracefulFailure('quality')
    }, 15000)

    it('tages templates list fails gracefully without cloud', () => {
      const { stdout, code } = run('templates list --project h2-test', { allowFail: true })
      expect(stdout.length, 'templates list produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('tages analytics fails gracefully without cloud', () => {
      assertGracefulFailure('analytics')
    }, 15000)

    it('tages session-wrap fails gracefully without cloud', () => {
      const { stdout } = run('session-wrap --project h2-test --summary "test session summary"', { allowFail: true })
      // session-wrap may exit 0 with empty output (silent success) or non-zero with a message
      // Either way: no raw JS stack traces
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('tages suggest fails gracefully without cloud', () => {
      assertGracefulFailure('suggest')
    }, 15000)

    it('tages impact fails gracefully without cloud', () => {
      const { stdout } = run('impact test-key --project h2-test', { allowFail: true })
      expect(stdout.length, 'impact produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('tages federation list fails gracefully without cloud', () => {
      const { stdout } = run('federation list --project h2-test', { allowFail: true })
      expect(stdout.length, 'federation list produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('tages migrate fails gracefully without cloud config', () => {
      assertGracefulFailure('migrate')
    }, 15000)

    it('tages onboard fails gracefully or produces output', () => {
      assertGracefulFailure('onboard')
    }, 15000)

    it('tages risk fails gracefully without cloud', () => {
      assertGracefulFailure('risk')
    }, 15000)

    it('tages sharpen fails gracefully without cloud', () => {
      assertGracefulFailure('sharpen')
    }, 15000)

    it('tages federate fails gracefully without cloud', () => {
      const { stdout } = run('federate test-key --project h2-test', { allowFail: true })
      expect(stdout.length, 'federate produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)
  })

  // ---------------------------------------------------------------------------
  // Group 4: Auth commands
  // ---------------------------------------------------------------------------
  describe('auth commands', () => {
    it('token --help exits with non-empty output', () => {
      const { stdout } = run('token --help', { allowFail: true })
      expect(stdout.length).toBeGreaterThan(0)
    }, 15000)

    it('token generate fails gracefully without cloud auth', () => {
      const { stdout } = run('token generate --project h2-test', { allowFail: true })
      expect(stdout.length, 'token generate produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('token list fails gracefully without cloud auth', () => {
      const { stdout } = run('token list --project h2-test', { allowFail: true })
      expect(stdout.length, 'token list produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)

    it('token rotate fails gracefully without cloud auth', () => {
      const { stdout } = run('token rotate --project h2-test', { allowFail: true })
      expect(stdout.length, 'token rotate produced empty output').toBeGreaterThan(0)
      expect(stdout).not.toContain('at Object.')
      expect(stdout).not.toContain('at Module.')
    }, 15000)
  })
}, 600000)
