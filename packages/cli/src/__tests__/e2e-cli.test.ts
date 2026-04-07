import { execSync } from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Use the worktree root so tsx resolves the CLI from the right location
// __dirname = packages/cli/src/__tests__ → go up 4 levels to reach repo root
const PROJECT_ROOT = path.resolve(__dirname, '../../../../')

// Fixture path for import-claude-md test
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures', 'sample-claude-md.md')

describe('E2E: CLI commands', () => {
  let tmpHome: string
  let tmpCachePath: string

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cli-test-'))
    tmpCachePath = path.join(tmpHome, 'tages-test-cache.db')
  })

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function run(args: string, opts: { allowFail?: boolean } = {}): { stdout: string; code: number } {
    try {
      const stdout = execSync(`pnpm exec tsx packages/cli/src/index.ts ${args}`, {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          HOME: tmpHome,
          TAGES_CACHE_PATH: tmpCachePath,
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

  it('tages init creates project config in local mode', () => {
    const { code } = run('init --local --slug tages-e2e-test')
    expect(code).toBe(0)
    const configPath = path.join(tmpHome, '.config', 'tages', 'projects', 'tages-e2e-test.json')
    expect(fs.existsSync(configPath)).toBe(true)
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(config.slug).toBe('tages-e2e-test')
    expect(config.projectId).toBe('local-tages-e2e-test')
  }, 15000)

  it('tages remember stores a value and exits 0', () => {
    const { code } = run('remember test-key "test value" --type convention --project tages-e2e-test')
    expect(code).toBe(0)
  }, 15000)

  it('tages recall outputs the stored key', () => {
    const { stdout, code } = run('recall test --project tages-e2e-test')
    expect(code).toBe(0)
    expect(stdout).toContain('test value')
  }, 15000)

  it('tages status exits 0 and prints memory count', () => {
    const { stdout, code } = run('status --project tages-e2e-test')
    expect(code).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
  }, 15000)

  it('tages doctor exits and prints health check results', () => {
    const { stdout } = run('doctor --project tages-e2e-test', { allowFail: true })
    // doctor may exit non-zero for cloud checks but should still output check results
    expect(stdout.length).toBeGreaterThan(0)
    // At minimum, it should have printed the header or a check result
    const hasOutput = stdout.includes('PASS') || stdout.includes('FAIL') || stdout.includes('Doctor')
    expect(hasOutput).toBe(true)
  }, 15000)

  it('tages import-claude-md reads fixture and outputs result', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true)
    // In local mode, import requires Supabase, so we allow non-zero exit.
    // We still verify the CLI reads the file and emits meaningful output.
    const { stdout, code } = run(`import ${FIXTURE_PATH} --project tages-e2e-test`, { allowFail: true })
    const combined = stdout
    // The CLI should have read the file and printed something meaningful:
    // either an import count, "requires a cloud connection", or a file-not-found error.
    // It must NOT crash silently with empty output.
    expect(combined.length).toBeGreaterThan(0)
    // Should NOT report the file as missing
    expect(combined).not.toContain('File not found')
  }, 15000)
}, 60000)
