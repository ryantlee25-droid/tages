/**
 * Regression tests for `tages templates`.
 *
 * The command shipped broken twice for the same underlying reason: it located
 * `packages/server/dist/templates/builtin-templates.js` at RUNTIME by walking a
 * fixed number of `..` segments up from `import.meta.url`. That path was only
 * ever correct for one build layout and one install shape:
 *
 *   - It never worked from an npm install, where no sibling
 *     `packages/server/dist/` exists at all.
 *   - It stopped working in the monorepo too once tsup collapsed the build to a
 *     single `dist/index.js`, five levels shallower than the `tsc` layout the
 *     `..` count was pinned to. The walk overshot the repo root and every
 *     invocation printed "Failed to load templates" and exited 1.
 *
 * The only e2e coverage that existed ran with `allowFail: true` and asserted
 * non-empty output with no stack trace — which the "Failed to load templates"
 * error satisfies perfectly. That is why both breakages shipped green.
 *
 * These tests call the command functions directly and assert on the DATA they
 * produce, so a load failure fails the suite instead of passing it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  templatesListCommand,
  templatesMatchCommand,
  templatesApplyCommand,
} from '../commands/templates-cmd.js'

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

/** Everything written to stdout/stderr during the call, as one string. */
function output(): string {
  const lines: string[] = []
  for (const call of logSpy.mock.calls) lines.push(call.join(' '))
  for (const call of errorSpy.mock.calls) lines.push(call.join(' '))
  return lines.join('\n')
}

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tages templates', () => {
  describe('templates list', () => {
    it('loads the real template data instead of failing to resolve it', async () => {
      await templatesListCommand({})
      const out = output()

      // The exact failure mode this command shipped with, twice.
      expect(out).not.toContain('Failed to load templates')

      // Real data, not an empty list rendered under a heading.
      expect(out).toContain('api-endpoint')
      expect(out).toContain('react-component')
      expect(out).toContain('database-migration')
      expect(out).toContain('test-suite')
      expect(out).toContain('cli-command')
    })

    it('renders each template with its fields', async () => {
      await templatesListCommand({})
      const out = output()
      expect(out).toContain('API Endpoint')
      // Required fields are starred; a template with no fields would not print this.
      expect(out).toContain('endpoint*')
      expect(out).toContain('* = required field')
    })
  })

  describe('templates match', () => {
    it('matches a route path against the api-endpoint template', async () => {
      await templatesMatchCommand('src/routes/users.ts', {})
      const out = output()
      expect(out).not.toContain('Failed to load templates')
      expect(out).toContain('api-endpoint')
      // Proves the RegExp filePatterns survived the module load as real
      // RegExp objects — a JSON round-trip would have flattened them.
      expect(out).not.toContain('No templates match this file path.')
    })

    it('reports no matches for a path no template covers', async () => {
      await templatesMatchCommand('LICENSE', {})
      expect(output()).toContain('No templates match this file path.')
    })
  })

  describe('templates apply', () => {
    it('prints the required fields of a known template', async () => {
      await templatesApplyCommand('api-endpoint', {})
      const out = output()
      expect(out).not.toContain('Failed to load templates')
      expect(out).toContain('API Endpoint')
      expect(out).toContain('endpoint')
      expect(out).toContain('auth_method')
      expect(out).toContain('templateId=')
    })

    it('lists the available ids when the template is unknown', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit called')
        }) as never)

      await expect(templatesApplyCommand('no-such-template', {})).rejects.toThrow(
        'process.exit called'
      )

      const out = output()
      expect(out).toContain('not found')
      // The suggestion list is only useful if the templates actually loaded.
      expect(out).toContain('api-endpoint')
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })

  describe('module resolution', () => {
    /**
     * The guard that matters most. Both breakages came from counting `..`
     * segments to a build-output location; the fix is a static import that the
     * bundler resolves at build time. If someone reintroduces path arithmetic
     * here, the command will break again the next time the layout moves — and
     * the behavioural tests above would still pass inside the monorepo while
     * npm installs broke silently.
     */
    it('resolves templates without walking a hardcoded directory depth', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '..', 'commands', 'templates-cmd.ts'),
        'utf-8'
      )

      // Strip comments — the block above deliberately describes the old bug.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

      expect(code).not.toMatch(/(['"]\.\.['"]\s*,\s*){2,}/)
      expect(code).not.toContain('import.meta.url')
      expect(code).not.toContain('createRequire')
    })
  })
})
