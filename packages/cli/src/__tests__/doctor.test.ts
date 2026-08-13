import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { captureConsole } from './helpers.js'

// ---------------------------------------------------------------------------
// Mocks
//
// `doctor` reads real files, so every path it consults is redirected into a
// temp dir. The Claude Desktop probe is redirected too: without that, a real
// ~/Library/.../claude_desktop_config.json on the developer's machine would
// make the "nothing configured" cases pass and hide the regression.
// ---------------------------------------------------------------------------

let tempConfigDir: string
let workDir: string
let desktopConfigPath: string

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getProjectConfigPath: (slug: string) => path.join(tempConfigDir, 'projects', `${slug}.json`),
  getClaudeCodeMcpConfigPath: () => path.join(process.cwd(), '.mcp.json'),
  getClaudeDesktopConfigPath: () => desktopConfigPath,
}))

const mockSupabase = {
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
}

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: vi.fn(async () => mockSupabase),
}))

import { doctorCommand } from '../commands/doctor.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = '11111111-2222-3333-4444-555555555555'

const CLOUD_PROJECT = {
  projectId: PROJECT_ID,
  slug: 'shared-project',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}

/** Exactly what `createLocalProject` writes for `tages init --local`. */
const LOCAL_PROJECT = {
  projectId: 'local-shared-project',
  slug: 'shared-project',
  supabaseUrl: '',
  supabaseAnonKey: '',
}

/**
 * A server-issued uuid with the credentials stripped — a shape no tages
 * version writes, and one that can neither sync nor work offline.
 */
const ORPHANED_CLOUD_PROJECT = {
  projectId: PROJECT_ID,
  slug: 'shared-project',
  supabaseUrl: '',
  supabaseAnonKey: '',
}

const TAGES_MCP_ENTRY = {
  mcpServers: {
    tages: {
      command: 'npx',
      args: ['-y', '@tages/server'],
      env: { TAGES_PROJECT_ID: PROJECT_ID },
    },
  },
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n')
}

function writeProject(config: Record<string, unknown> = CLOUD_PROJECT) {
  writeJson(path.join(tempConfigDir, 'projects', `${config.slug}.json`), config)
}

/** Writes the `.tages/config.json` marker that `tages link` leaves behind. */
function writeLinkMarker(slug: string, dir: string = workDir) {
  writeJson(path.join(dir, '.tages', 'config.json'), { slug })
}

function writeProjectMcpJson(value: unknown = TAGES_MCP_ENTRY, dir: string = workDir) {
  writeJson(path.join(dir, '.mcp.json'), value)
}

function writeDesktopMcpJson(value: unknown = TAGES_MCP_ENTRY) {
  writeJson(desktopConfigPath, value)
}

/** A stored cloud session — only ever written by a cloud `init`/`link`. */
function writeAuth() {
  writeJson(path.join(tempConfigDir, 'auth.json'), { userId: 'u1', accessToken: 't' })
}

function writeCache(slug: string) {
  const cachePath = path.join(tempConfigDir, 'cache', `${slug}.db`)
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, '')
}

// ---------------------------------------------------------------------------

describe('doctor command', () => {
  let console_: ReturnType<typeof captureConsole>
  let originalCwd: string
  let originalHome: string | undefined
  let originalUserProfile: string | undefined
  let originalExitCode: typeof process.exitCode
  let sandbox: string

  beforeEach(() => {
    originalCwd = process.cwd()
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    // doctor signals failures via `process.exitCode`. Left set, it would make
    // the whole vitest run exit non-zero even with every test green.
    originalExitCode = process.exitCode
    process.exitCode = undefined

    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-doctor-'))
    // realpathSync: macOS puts tmpdir under /var -> /private/var, and doctor
    // compares/prints resolved paths.
    sandbox = fs.realpathSync(sandbox)

    tempConfigDir = path.join(sandbox, 'config')
    fs.mkdirSync(path.join(tempConfigDir, 'projects'), { recursive: true })

    workDir = path.join(sandbox, 'work', 'shared-project')
    fs.mkdirSync(workDir, { recursive: true })

    // Point HOME at the sandbox so the hardcoded per-platform Desktop probes
    // cannot reach the developer's real Claude Desktop config.
    const fakeHome = path.join(sandbox, 'home')
    fs.mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = fakeHome
    process.env.USERPROFILE = fakeHome

    desktopConfigPath = path.join(fakeHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')

    process.chdir(workDir)
    console_ = captureConsole()
    vi.clearAllMocks()
  })

  afterEach(() => {
    console_.restore()
    process.chdir(originalCwd)
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = originalUserProfile
    process.exitCode = originalExitCode
    fs.rmSync(sandbox, { recursive: true, force: true })
  })

  const output = () => console_.logs.join('\n')

  /** The MCP check line, with its PASS/FAIL marker. */
  const mcpLine = () => console_.logs.find(l => l.includes('MCP server config')) || ''

  // ─── MCP location probing ────────────────────────────────────────────────

  describe('MCP server config check', () => {
    beforeEach(() => {
      writeProject()
      writeLinkMarker('shared-project')
    })

    it('passes and names the project scope when .mcp.json is in the cwd', async () => {
      writeProjectMcpJson()

      await doctorCommand({})

      expect(mcpLine()).toContain('PASS')
      expect(mcpLine()).toContain('Claude Code project scope')
      expect(mcpLine()).toContain(path.join(workDir, '.mcp.json'))
    })

    it('passes and names Claude Desktop when only a Desktop config exists', async () => {
      writeDesktopMcpJson()

      await doctorCommand({})

      expect(mcpLine()).toContain('PASS')
      expect(mcpLine()).toContain('Claude Desktop')
      expect(mcpLine()).not.toContain('Claude Code project scope')
    })

    it('prefers the project scope over Claude Desktop when both exist', async () => {
      writeProjectMcpJson()
      writeDesktopMcpJson()

      await doctorCommand({})

      expect(mcpLine()).toContain('Claude Code project scope')
    })

    it('accepts the legacy `tages-server` entry name', async () => {
      writeProjectMcpJson({ mcpServers: { 'tages-server': { command: 'npx' } } })

      await doctorCommand({})

      expect(mcpLine()).toContain('PASS')
    })

    it('fails when .mcp.json exists but carries no tages entry', async () => {
      writeProjectMcpJson({ mcpServers: { somethingElse: { command: 'npx' } } })

      await doctorCommand({})

      expect(mcpLine()).toContain('FAIL')
    })

    it('does not crash on an unparseable .mcp.json, and still finds the Desktop config', async () => {
      fs.writeFileSync(path.join(workDir, '.mcp.json'), '{ not json')
      writeDesktopMcpJson()

      await doctorCommand({})

      expect(mcpLine()).toContain('PASS')
      expect(mcpLine()).toContain('Claude Desktop')
    })

    it('fails when neither a project nor a Desktop config is configured', async () => {
      await doctorCommand({})

      expect(mcpLine()).toContain('FAIL')
      expect(mcpLine()).toContain('not found')
    })
  })

  // ─── Remediation advice: the dangerous part ──────────────────────────────

  describe('remediation advice when the MCP check fails', () => {
    it('does NOT tell an already-linked user to run `tages init`', async () => {
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      expect(mcpLine()).toContain('FAIL')
      expect(output()).toContain('already linked to project \'shared-project\'')
      expect(output()).toContain('do NOT run `tages init`')
      expect(output()).toContain(`tages link --project-id ${PROJECT_ID}`)
    })

    it('never emits a bare "run `tages init`" instruction for a linked directory', async () => {
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      // The only mention of init is inside the explicit "do NOT" warning.
      const initMentions = output()
        .split('\n')
        .filter(l => l.includes('tages init'))
      expect(initMentions.length).toBeGreaterThan(0)
      for (const line of initMentions) {
        expect(line).toContain('do NOT run')
      }
    })

    it('offers BOTH join and init, with a discriminator, when the directory is not linked', async () => {
      // A project config exists (so doctor gets past check 2) but this
      // directory is bound to none of them — the teammate-who-just-cloned case.
      writeProject({ ...CLOUD_PROJECT, slug: 'someone-elses-project' })

      await doctorCommand({})

      expect(mcpLine()).toContain('FAIL')
      expect(output()).toContain('tages link --project-id <project-id>')
      expect(output()).toContain('tages init')
      expect(output()).toContain('Slugs are globally unique')
      expect(output()).toContain('If in doubt, use `tages link`')
    })

    it('points at the manual .mcp.json snippet as an escape hatch', async () => {
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      expect(output()).toContain(path.join(workDir, '.mcp.json'))
      expect(output()).toContain('"mcpServers"')
    })

    it('asks for the project id when the directory is linked but the id is unknown', async () => {
      // Marker present, but the local project config was never written
      // (or lost) — so there is no id to interpolate.
      writeProject({ ...CLOUD_PROJECT, slug: 'other' })
      writeLinkMarker('ghost-project')

      await doctorCommand({})

      expect(output()).toContain('already linked to project \'ghost-project\'')
      expect(output()).toContain('tages link --project-id <project-id>')
    })

    it('does not default to `tages init` when no project is configured at all', async () => {
      await doctorCommand({})

      expect(output()).toContain('tages link --project-id <project-id>')
      expect(output()).toContain('Slugs are globally unique')
      expect(output()).toContain('no project')
    })
  })

  // ─── Project selection ───────────────────────────────────────────────────

  describe('project selection', () => {
    it('reports on the linked project, not the alphabetically first config', async () => {
      writeProject({ ...CLOUD_PROJECT, slug: 'aaa-other-project' })
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      const projectLine = console_.logs.find(l => l.includes('Project config')) || ''
      expect(projectLine).toContain('shared-project')
      expect(projectLine).toContain('via .tages/config.json')
      expect(projectLine).not.toContain('aaa-other-project')
    })

    it('honors --project over the directory link', async () => {
      writeProject({ ...CLOUD_PROJECT, slug: 'explicit-project' })
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({ project: 'explicit-project' })

      const projectLine = console_.logs.find(l => l.includes('Project config')) || ''
      expect(projectLine).toContain('explicit-project')
      expect(projectLine).toContain('via --project')
    })

    it('fails cleanly, without throwing, when --project names an unknown slug', async () => {
      writeProject()

      await expect(doctorCommand({ project: 'no-such-project' })).resolves.toBeUndefined()

      const projectLine = console_.logs.find(l => l.includes('Project config')) || ''
      expect(projectLine).toContain('FAIL')
    })

    it('resolves by directory name when no marker exists', async () => {
      // workDir basename is `shared-project`, matching the config slug.
      writeProject()

      await doctorCommand({})

      const projectLine = console_.logs.find(l => l.includes('Project config')) || ''
      expect(projectLine).toContain('via directory name')
    })

    it('labels the legacy first-file fallback as unlinked', async () => {
      writeProject({ ...CLOUD_PROJECT, slug: 'unrelated-project' })

      await doctorCommand({})

      const projectLine = console_.logs.find(l => l.includes('Project config')) || ''
      expect(projectLine).toContain('this directory is not linked')
    })

    it('does not throw on a corrupt project config', async () => {
      writeProject()
      writeLinkMarker('shared-project')
      fs.writeFileSync(path.join(tempConfigDir, 'projects', 'shared-project.json'), '{ broken')

      await expect(doctorCommand({})).resolves.toBeUndefined()
      expect(output()).toContain('not valid JSON')
    })
  })

  // ─── Git hook resolution ─────────────────────────────────────────────────

  describe('git hook check', () => {
    function initRepo(dir: string) {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
    }

    beforeEach(() => {
      writeProject()
      writeLinkMarker('shared-project')
    })

    const hookLine = () => console_.logs.find(l => l.includes('Git hook')) || ''

    it('finds a hook installed at the repo root when doctor runs in a subdirectory', async () => {
      initRepo(workDir)
      fs.writeFileSync(
        path.join(workDir, '.git', 'hooks', 'post-commit'),
        '#!/bin/sh\nnpx tages index --last-commit &\n',
      )

      const sub = path.join(workDir, 'packages', 'deep')
      fs.mkdirSync(sub, { recursive: true })
      writeLinkMarker('shared-project', sub)
      process.chdir(sub)

      await doctorCommand({})

      expect(hookLine()).toContain('PASS')
    })

    // Both no-hook branches WARN rather than FAIL: auto-indexing is optional,
    // and running doctor outside a repo is not a defect at all. Neither should
    // colour the exit code.
    it('reports "not a git repository" rather than "not installed" outside a repo', async () => {
      await doctorCommand({})

      expect(hookLine()).toContain('WARN')
      expect(hookLine()).toContain('not a git repository')
      expect(output()).not.toContain('tages index --install')
    })

    it('advises `tages index --install` inside a repo with no hook', async () => {
      initRepo(workDir)

      await doctorCommand({})

      expect(hookLine()).toContain('WARN')
      expect(hookLine()).toContain('not installed')
      expect(output()).toContain('tages index --install')
    })

    it('does not fail the command for a missing hook', async () => {
      initRepo(workDir)
      writeAuth()
      writeProjectMcpJson()
      writeCache('shared-project')

      await doctorCommand({})

      expect(hookLine()).toContain('WARN')
      expect(process.exitCode).not.toBe(1)
    })

    it('does not advise re-running `tages init` for a missing hook', async () => {
      initRepo(workDir)

      await doctorCommand({})

      const hookAdvice = output()
        .split('\n')
        .filter(l => l.includes('index --install'))
      expect(hookAdvice.length).toBeGreaterThan(0)
      for (const line of hookAdvice) {
        expect(line).not.toContain('tages init')
      }
    })
  })

  // ─── Cloud connection: the local-only false-green ────────────────────────

  describe('cloud connection check', () => {
    const cloudLine = () => console_.logs.find(l => l.includes('Supabase connection')) || ''

    it('passes and names the url for a reachable cloud project', async () => {
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      expect(cloudLine()).toContain('PASS')
      expect(cloudLine()).toContain('https://test.supabase.co')
    })

    it('fails when a cloud project is configured but unreachable', async () => {
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'network unreachable' } }),
        }),
      })

      await doctorCommand({})

      expect(cloudLine()).toContain('FAIL')
      expect(cloudLine()).toContain('network unreachable')
    })

    // The discriminator: no cloud session anywhere means local-only was chosen,
    // not fallen into.
    it('passes local-only when there is no cloud session on the machine', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')

      await doctorCommand({})

      expect(cloudLine()).toContain('PASS')
      expect(cloudLine()).toContain('local-only mode')
      expect(output()).toContain('deliberate local-only setup')
    })

    // The regression this task exists for.
    it('WARNs, not PASSes, when a local-only project coexists with a cloud session', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      expect(cloudLine()).toContain('WARN')
      expect(cloudLine()).not.toContain('PASS')
      expect(cloudLine()).toContain('local-only mode')
    })

    it('names both readings and how to tell them apart', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      const out = output()
      // Reading 1: deliberate.
      expect(out).toContain('tages init --local')
      // Reading 2: the failed join.
      expect(out).toContain('slugs are globally unique')
      expect(out).toContain('shadows the real project')
      // The discriminator, and the fix.
      expect(out).toContain('Tell them apart')
      expect(out).toContain('tages link --project-id')
      expect(out).toContain('NOT synced')
    })

    it('never suggests linking with the synthetic `local-` project id', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      // `tages link --project-id local-shared-project` is guaranteed to fail —
      // it is not a server-issued id.
      expect(output()).not.toContain('--project-id local-')
      expect(output()).toContain('--project-id <project-id>')
    })

    it('does not fail the command for a local-only warning', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')
      writeAuth()
      writeProjectMcpJson()
      writeCache('shared-project')

      await doctorCommand({})

      expect(cloudLine()).toContain('WARN')
      expect(process.exitCode).not.toBe(1)
    })

    it('fails a server-issued project id that carries no credentials', async () => {
      writeProject(ORPHANED_CLOUD_PROJECT)
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      expect(cloudLine()).toContain('FAIL')
      expect(output()).toContain('no Supabase url or key')
      // The uuid IS server-issued, so offering it to `link` is correct here.
      expect(output()).toContain(`tages link --project-id ${PROJECT_ID}`)
      expect(process.exitCode).toBe(1)
    })

    it('warns rather than guesses when the project id fits no known shape', async () => {
      writeProject({ ...LOCAL_PROJECT, projectId: 'legacy-handwritten-id' })
      writeLinkMarker('shared-project')

      await doctorCommand({})

      expect(cloudLine()).toContain('WARN')
      expect(output()).toContain('cannot tell whether local-only was intended')
    })
  })

  // ─── SQLite cache ────────────────────────────────────────────────────────

  describe('SQLite cache check', () => {
    const cacheLine = () => console_.logs.find(l => l.includes('SQLite cache')) || ''

    beforeEach(() => {
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()
    })

    it('passes when the cache file exists', async () => {
      writeCache('shared-project')

      await doctorCommand({})

      expect(cacheLine()).toContain('PASS')
    })

    // A check whose own advice is "this happens by itself" is not a failure.
    it('warns, not fails, when the cache has not been created yet', async () => {
      await doctorCommand({})

      expect(cacheLine()).toContain('WARN')
      expect(cacheLine()).toContain('not created yet')
      expect(output()).toContain('created on demand')
    })
  })

  // ─── Summary line and exit code ──────────────────────────────────────────

  describe('summary and exit code', () => {
    const summaryLine = () => console_.logs.find(l => l.includes('passed,')) || ''

    it('counts warnings alongside passes and failures', async () => {
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      expect(summaryLine()).toMatch(/\d+ passed, \d+ warnings?, \d+ failed/)
    })

    it('exits 0 and says so when there are warnings but no failures', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')
      writeProjectMcpJson()

      await doctorCommand({})

      expect(summaryLine()).toContain('0 failed')
      expect(output()).toContain('No failures')
      expect(process.exitCode).not.toBe(1)
    })

    it('exits 1 when any check fails', async () => {
      // No MCP entry anywhere -> the MCP check fails.
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()

      await doctorCommand({})

      expect(summaryLine()).not.toContain('0 failed')
      expect(process.exitCode).toBe(1)
      expect(output()).toContain('must be fixed')
    })

    it('exits 1 and still tallies when no project is configured', async () => {
      await doctorCommand({})

      expect(summaryLine()).toContain('warning')
      expect(output()).toContain('no project')
      expect(process.exitCode).toBe(1)
    })

    it('uses the singular "warning" for exactly one', async () => {
      // Cloud project, auth, MCP and hook absent... pick a case with 1 warn:
      // cache missing is the only warning when everything else is present.
      writeProject()
      writeLinkMarker('shared-project')
      writeAuth()
      writeProjectMcpJson()
      execFileSync('git', ['init', '-q'], { cwd: workDir, stdio: 'ignore' })
      fs.writeFileSync(path.join(workDir, '.git', 'hooks', 'post-commit'), '#!/bin/sh\nnpx tages index\n')

      await doctorCommand({})

      expect(summaryLine()).toContain('1 warning,')
      expect(summaryLine()).not.toContain('1 warnings')
    })
  })

  // ─── Auth check ──────────────────────────────────────────────────────────

  describe('auth check', () => {
    it('routes to the setup command for this directory when no session is stored', async () => {
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      const authLine = console_.logs.find(l => l.includes('Auth config')) || ''
      expect(authLine).toContain('FAIL')
      expect(output()).toContain('The setup command for this directory also signs you in')
      expect(output()).toContain(`tages link --project-id ${PROJECT_ID}`)
    })

    it('offers both setup paths when no session is stored and the directory is unlinked', async () => {
      writeProject({ ...CLOUD_PROJECT, slug: 'someone-elses-project' })

      await doctorCommand({})

      expect(output()).toContain('tages link --project-id <project-id>')
      expect(output()).toContain('tages init')
    })

    it('passes when auth.json exists', async () => {
      fs.writeFileSync(path.join(tempConfigDir, 'auth.json'), JSON.stringify({ userId: 'u1' }))
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      const authLine = console_.logs.find(l => l.includes('Auth config')) || ''
      expect(authLine).toContain('PASS')
    })

    // A local-only project never signs anyone in, so a missing session is the
    // expected state — not a broken one.
    it('warns rather than fails when the project is local-only', async () => {
      writeProject(LOCAL_PROJECT)
      writeLinkMarker('shared-project')

      await doctorCommand({})

      const authLine = console_.logs.find(l => l.includes('Auth config')) || ''
      expect(authLine).toContain('WARN')
      expect(authLine).toContain('not required for a local-only project')
      expect(output()).toContain('Local-only projects need no sign-in')
    })

    it('still fails a missing session for a cloud project', async () => {
      writeProject()
      writeLinkMarker('shared-project')

      await doctorCommand({})

      const authLine = console_.logs.find(l => l.includes('Auth config')) || ''
      expect(authLine).toContain('FAIL')
    })
  })
})
