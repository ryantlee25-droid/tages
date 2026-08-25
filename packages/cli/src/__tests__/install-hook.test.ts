import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { installPostCommitHook } from '../indexer/install-hook.js'

/**
 * The installed hook used to run `npx tages index --last-commit`. There is no
 * `tages` package on npm — the binary ships inside `@tages/cli` — so on any
 * machine without a global CLI install the hook resolved nothing and failed
 * silently, because it runs backgrounded with its output discarded.
 */
describe('post-commit hook script', () => {
  let repo: string

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-hook-test-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  /**
   * The hook's executable lines only. The script's own comments name
   * `npx tages` while explaining why it must not be used, so asserting over
   * the raw file would match the very thing being warned about.
   */
  function install(): string {
    const { installed, path: hookPath } = installPostCommitHook(repo)
    expect(installed).toBe(true)
    return fs
      .readFileSync(hookPath, 'utf-8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
  }

  it('never invokes the non-existent `tages` npm package', () => {
    expect(install()).not.toMatch(/npx\s+tages\b/)
  })

  it('falls back to the package that actually publishes the binary', () => {
    expect(install()).toContain('npx -y @tages/cli index --last-commit')
  })

  it('prefers a `tages` already on PATH over a registry fetch', () => {
    const script = install()
    expect(script).toContain('command -v tages')
    expect(script.indexOf('command -v tages')).toBeLessThan(script.indexOf('npx -y @tages/cli'))
  })

  it('is executable and backgrounds its work so commits are never blocked', () => {
    const { path: hookPath } = installPostCommitHook(repo)
    expect(fs.statSync(hookPath).mode & 0o111).toBeTruthy()
    expect(fs.readFileSync(hookPath, 'utf-8')).toMatch(/index --last-commit &/)
  })

  it('is idempotent — re-installing does not append a second copy', () => {
    installPostCommitHook(repo)
    const first = install()
    const occurrences = first.split('index --last-commit').length - 1
    expect(occurrences).toBe(2) // one PATH branch, one npx branch — not four
  })
})
