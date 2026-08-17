import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import {
  setupTempConfigDir,
  captureConsole,
  writeProjectConfig,
  writeAuthConfig,
  TEST_AUTH,
} from './helpers.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  runGithubOAuth: vi.fn(),
  createAuthenticatedClient: vi.fn(),
  findMemberProjectById: vi.fn(),
}))

vi.mock('../auth/github-oauth.js', () => ({
  runGithubOAuth: mocks.runGithubOAuth,
}))

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mocks.createAuthenticatedClient,
}))

// This mirrors the exact relative specifier link.ts uses to reach into
// packages/shared/src/project-factory.ts (cross-package import convention,
// see link.ts's own comment) — from this test file (also directly under
// packages/cli/src/) the relative depth is identical.
vi.mock('../../../shared/src/project-factory.js', () => ({
  findMemberProjectById: mocks.findMemberProjectById,
}))

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
  return { default: vi.fn(() => spinner) }
})

let tempConfigDir: string

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
  getClaudeDesktopConfigPath: () => path.join(tempConfigDir, 'claude_desktop_config.json'),
  // Matches the real implementation (paths.ts resolves `.mcp.json` against
  // process.cwd()), so the join path's MCP wiring lands in the test's cwd —
  // the project directory — exactly as it does for a real teammate.
  getClaudeCodeMcpConfigPath: () => path.join(process.cwd(), '.mcp.json'),
}))

import { linkCommand } from '../commands/link.js'

// A fake authenticated Supabase client whose `auth.getUser()` resolves to a
// real user — the shape link.ts now inspects to distinguish an expired
// session from a genuine non-membership. Returns a stable reference so tests
// can assert it was forwarded to findMemberProjectById.
function fakeClient(userId: string = TEST_AUTH.userId) {
  return {
    __fake: 'supabase-client',
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
  }
}

describe('link command', () => {
  let cleanupConfigDir: () => void
  let console_: ReturnType<typeof captureConsole>
  let workDir: string
  let origCwd: string
  let origServiceKey: string | undefined

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupConfigDir = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    // link.ts branches on TAGES_SERVICE_KEY (the CI/headless service-role
    // escape hatch skips the interactive getUser session check). Clear it so
    // these tests exercise the normal authenticated path deterministically,
    // regardless of whatever is set in the runner's shell.
    origServiceKey = process.env.TAGES_SERVICE_KEY
    delete process.env.TAGES_SERVICE_KEY

    origCwd = process.cwd()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-link-cwd-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    console_.restore()
    cleanupConfigDir()
    fs.rmSync(workDir, { recursive: true, force: true })
    if (origServiceKey === undefined) delete process.env.TAGES_SERVICE_KEY
    else process.env.TAGES_SERVICE_KEY = origServiceKey
  })

  // -------------------------------------------------------------------
  // (a) Existing local-slug path — regression, must be unchanged.
  // -------------------------------------------------------------------
  describe('legacy local-slug path (regression)', () => {
    it('links the current directory to an already-registered project by slug', async () => {
      writeProjectConfig(tempConfigDir, { slug: 'my-project', projectId: 'proj-123' })

      await linkCommand('my-project')

      const markerPath = path.join(workDir, '.tages', 'config.json')
      expect(fs.existsSync(markerPath)).toBe(true)
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      expect(marker.slug).toBe('my-project')

      expect(console_.logs.join('\n')).toContain("Linked this directory to project 'my-project'")

      // Must not touch auth/network paths at all
      expect(mocks.runGithubOAuth).not.toHaveBeenCalled()
      expect(mocks.createAuthenticatedClient).not.toHaveBeenCalled()
      expect(mocks.findMemberProjectById).not.toHaveBeenCalled()
    })

    it('falls back to the cwd basename when no slug argument is given', async () => {
      const dirName = path.basename(workDir)
      writeProjectConfig(tempConfigDir, { slug: dirName, projectId: 'proj-456' })

      await linkCommand(undefined)

      const marker = JSON.parse(
        fs.readFileSync(path.join(workDir, '.tages', 'config.json'), 'utf-8'),
      )
      expect(marker.slug).toBe(dirName)
    })

    it('exits with an error and lists available projects when the slug is not registered', async () => {
      writeProjectConfig(tempConfigDir, { slug: 'other-project', projectId: 'proj-999' })

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(linkCommand('missing-slug')).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console_.errors.join('\n')).toContain("No registered project found for slug 'missing-slug'")
      expect(console_.errors.join('\n')).toContain('other-project')

      // No marker should have been written
      expect(fs.existsSync(path.join(workDir, '.tages', 'config.json'))).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // (b) --project-id with valid membership writes the config
  // -------------------------------------------------------------------
  describe('--project-id join path', () => {
    it('writes local project config + marker when the user is a verified member', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      const client = fakeClient()
      mocks.createAuthenticatedClient.mockResolvedValue(client)
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'team',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      // Membership check delegated to the shared helper with the right args
      expect(mocks.findMemberProjectById).toHaveBeenCalledWith(
        'shared-proj-uuid',
        TEST_AUTH.userId,
        client,
      )

      const projectConfigPath = path.join(tempConfigDir, 'projects', 'team-project.json')
      expect(fs.existsSync(projectConfigPath)).toBe(true)
      const config = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'))
      expect(config.projectId).toBe('shared-proj-uuid')
      expect(config.slug).toBe('team-project')
      expect(config.supabaseUrl).toContain('supabase.co')
      expect(typeof config.supabaseAnonKey).toBe('string')
      expect(config.supabaseAnonKey.length).toBeGreaterThan(0)

      const markerPath = path.join(workDir, '.tages', 'config.json')
      expect(fs.existsSync(markerPath)).toBe(true)
      expect(JSON.parse(fs.readFileSync(markerPath, 'utf-8')).slug).toBe('team-project')

      expect(console_.logs.join('\n')).toContain("Joined project 'team-project'")

      // No fresh OAuth flow needed — auth.json already existed
      expect(mocks.runGithubOAuth).not.toHaveBeenCalled()
    })

    it('registers the joined project under --slug when provided, overriding the project\'s own slug', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'free',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid', slug: 'my-local-alias' })

      const projectConfigPath = path.join(tempConfigDir, 'projects', 'my-local-alias.json')
      expect(fs.existsSync(projectConfigPath)).toBe(true)
      const config = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'))
      expect(config.slug).toBe('my-local-alias')
      expect(config.projectId).toBe('shared-proj-uuid')

      const marker = JSON.parse(
        fs.readFileSync(path.join(workDir, '.tages', 'config.json'), 'utf-8'),
      )
      expect(marker.slug).toBe('my-local-alias')
    })

    it('runs the GitHub OAuth flow first when no local session exists yet', async () => {
      // No auth.json written — simulates a machine that has never run `tages init`.
      mocks.runGithubOAuth.mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        userId: 'new-user-id',
      })
      const client = fakeClient('new-user-id')
      mocks.createAuthenticatedClient.mockResolvedValue(client)
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'free',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      expect(mocks.runGithubOAuth).toHaveBeenCalled()
      // Session should be persisted for future commands
      const authPath = path.join(tempConfigDir, 'auth.json')
      expect(fs.existsSync(authPath)).toBe(true)
      expect(JSON.parse(fs.readFileSync(authPath, 'utf-8')).userId).toBe('new-user-id')

      // Membership check must use the newly authenticated userId
      expect(mocks.findMemberProjectById).toHaveBeenCalledWith(
        'shared-proj-uuid',
        'new-user-id',
        client,
      )
    })

    it('always uses the default cloud Supabase URL (no --supabase-url override to mismatch the anon key)', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'free',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      // URL + anon key are always the matched default cloud pair.
      const [urlArg, keyArg] = mocks.createAuthenticatedClient.mock.calls[0]
      expect(urlArg).toContain('supabase.co')
      expect(typeof keyArg).toBe('string')

      const config = JSON.parse(
        fs.readFileSync(path.join(tempConfigDir, 'projects', 'team-project.json'), 'utf-8'),
      )
      expect(config.supabaseUrl).toBe(urlArg)
    })
  })

  // -------------------------------------------------------------------
  // (b2) A successful join must WIRE the agent, not just record the project.
  //
  // The join path used to stop after writing the project JSON + dir marker,
  // so a teammate "joined" and their agent was still connected to nothing.
  // These assert the two steps `tages init` also performs.
  // -------------------------------------------------------------------
  describe('--project-id agent wiring', () => {
    function joinedProject() {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'team',
      })
    }

    it('writes .mcp.json in the project directory carrying the joined projectId + slug', async () => {
      joinedProject()

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      const mcpPath = path.join(workDir, '.mcp.json')
      expect(fs.existsSync(mcpPath)).toBe(true)

      const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'))
      expect(mcp.mcpServers.tages).toBeDefined()
      expect(mcp.mcpServers.tages.env.TAGES_PROJECT_ID).toBe('shared-proj-uuid')
      expect(mcp.mcpServers.tages.env.TAGES_PROJECT_SLUG).toBe('team-project')
      // Supabase creds must ride along, or the server has a project id it
      // cannot reach.
      expect(mcp.mcpServers.tages.env.TAGES_SUPABASE_URL).toContain('supabase.co')
      expect(mcp.mcpServers.tages.env.TAGES_SUPABASE_ANON_KEY.length).toBeGreaterThan(0)

      expect(console_.logs.join('\n')).toContain('MCP config:')
    })

    it('writes .mcp.json under the --slug alias when one is given', async () => {
      joinedProject()

      await linkCommand(undefined, { projectId: 'shared-proj-uuid', slug: 'my-local-alias' })

      const mcp = JSON.parse(fs.readFileSync(path.join(workDir, '.mcp.json'), 'utf-8'))
      expect(mcp.mcpServers.tages.env.TAGES_PROJECT_SLUG).toBe('my-local-alias')
      expect(mcp.mcpServers.tages.env.TAGES_PROJECT_ID).toBe('shared-proj-uuid')
    })

    it('points the MCP server at a command that exists — local node build, else the npx fallback', async () => {
      joinedProject()

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      const mcp = JSON.parse(fs.readFileSync(path.join(workDir, '.mcp.json'), 'utf-8'))
      const { command, args } = mcp.mcpServers.tages

      if (command === 'node') {
        // Local monorepo build: the arg must be an absolute path that is
        // really on disk. Writing a path that doesn't exist is the failure
        // mode this guards — Claude Code would fail to start the server.
        expect(args).toHaveLength(1)
        expect(path.isAbsolute(args[0])).toBe(true)
        expect(args[0].endsWith(path.join('packages', 'server', 'dist', 'index.js'))).toBe(true)
        expect(fs.existsSync(args[0])).toBe(true)
      } else {
        // Fallback only — never a half-built custom command.
        expect(command).toBe('npx')
        expect(args).toEqual(['-y', '@tages/server'])
      }
    })

    it('preserves a teammate\'s existing .mcp.json entries instead of clobbering them', async () => {
      joinedProject()
      fs.writeFileSync(
        path.join(workDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['playwright-mcp'] } } }),
      )

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      const mcp = JSON.parse(fs.readFileSync(path.join(workDir, '.mcp.json'), 'utf-8'))
      expect(mcp.mcpServers.playwright).toEqual({ command: 'npx', args: ['playwright-mcp'] })
      expect(mcp.mcpServers.tages).toBeDefined()
      expect(console_.logs.join('\n')).toContain('(updated)')
    })

    it('installs the post-commit hook in the joined repo', async () => {
      // installPostCommitHook resolves the repo from cwd, so the join has to
      // happen inside a real git repo for the hook to have a home.
      execFileSync('git', ['init', '-q'], { cwd: workDir })
      joinedProject()

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      const hookPath = path.join(workDir, '.git', 'hooks', 'post-commit')
      expect(fs.existsSync(hookPath)).toBe(true)
      expect(fs.readFileSync(hookPath, 'utf-8')).toContain('tages index --last-commit')
      expect(console_.logs.join('\n')).toContain('Git hook:')

      // The written .mcp.json holds the project id + anon key, so it must be
      // kept out of git via the repo-local excludes (never a shared
      // .gitignore).
      const excludePath = path.join(workDir, '.git', 'info', 'exclude')
      expect(fs.readFileSync(excludePath, 'utf-8')).toContain('.mcp.json')
    })
  })

  // -------------------------------------------------------------------
  // (c) --project-id for a project the user is NOT a member of is rejected
  // -------------------------------------------------------------------
  describe('--project-id rejection paths', () => {
    it('rejects (does not write config) when the user is not a member of the project', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      // Membership check fails — RLS returned no row (not owner/member)
      mocks.findMemberProjectById.mockResolvedValue(null)

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'someone-elses-project-uuid' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console_.errors.join('\n')).toContain('Could not find project')

      // Nothing should have been written to disk
      const projectsDir = path.join(tempConfigDir, 'projects')
      const written = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []
      expect(written).toEqual([])
      expect(fs.existsSync(path.join(workDir, '.tages', 'config.json'))).toBe(false)
    })

    // -----------------------------------------------------------------
    // (d) --project-id for a nonexistent project fails cleanly
    // -----------------------------------------------------------------
    it('fails cleanly (same rejection path) when the project id does not exist at all', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      // A nonexistent project ID is indistinguishable from "not a member" under
      // RLS — both come back as null. This is intentional (see project-factory's
      // findMemberProjectById doc comment): it never discloses whether a UUID
      // belongs to someone else's project.
      mocks.findMemberProjectById.mockResolvedValue(null)

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'totally-made-up-uuid' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)

      const projectsDir = path.join(tempConfigDir, 'projects')
      const written = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []
      expect(written).toEqual([])
      expect(fs.existsSync(path.join(workDir, '.tages', 'config.json'))).toBe(false)
    })

    it('exits cleanly when stored auth is corrupt', async () => {
      fs.writeFileSync(path.join(tempConfigDir, 'auth.json'), 'not valid json{{{')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'shared-proj-uuid' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(mocks.findMemberProjectById).not.toHaveBeenCalled()
    })

    it('sends the user to re-auth (not "not a member") when the session is expired', async () => {
      // auth.json exists (so we have a stored userId) but the client is
      // effectively unauthenticated — createAuthenticatedClient returned an
      // anon client because the refresh token expired. getUser() → no user.
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue({
        __fake: 'anon-client',
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      })

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'shared-proj-uuid' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console_.errors.join('\n')).toContain('session has expired')
      // We must NOT proceed to the membership lookup with a dead session.
      expect(mocks.findMemberProjectById).not.toHaveBeenCalled()
      expect(fs.existsSync(path.join(workDir, '.tages', 'config.json'))).toBe(false)
    })
  })

  // -------------------------------------------------------------------
  // (e) --project-id must not silently clobber an existing local link
  // -------------------------------------------------------------------
  describe('--project-id clobber protection', () => {
    it('refuses to overwrite an existing local config for the same slug pointing at a DIFFERENT project', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      // Pre-existing local link: slug 'team-project' → project OLD.
      writeProjectConfig(tempConfigDir, { slug: 'team-project', projectId: 'OLD-project-id' })
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'NEW-project-id',
        slug: 'team-project',
        plan: 'team',
      })

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'NEW-project-id' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console_.errors.join('\n')).toContain('already linked')
      // The original binding must be untouched.
      const config = JSON.parse(
        fs.readFileSync(path.join(tempConfigDir, 'projects', 'team-project.json'), 'utf-8'),
      )
      expect(config.projectId).toBe('OLD-project-id')
    })

    it('allows an idempotent re-join of the SAME project (same slug, same id)', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      writeProjectConfig(tempConfigDir, { slug: 'team-project', projectId: 'shared-proj-uuid' })
      mocks.createAuthenticatedClient.mockResolvedValue(fakeClient())
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'team',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      const config = JSON.parse(
        fs.readFileSync(path.join(tempConfigDir, 'projects', 'team-project.json'), 'utf-8'),
      )
      expect(config.projectId).toBe('shared-proj-uuid')
      expect(console_.logs.join('\n')).toContain("Joined project 'team-project'")
    })
  })

  // -------------------------------------------------------------------
  // (f) Session / headless edge cases
  // -------------------------------------------------------------------
  describe('session + headless handling', () => {
    it('proceeds (does not falsely expire) when getUser() has a transient error but the session is fine', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      // getUser() errors transiently; createAuthenticatedClient already
      // validated the session, so link must NOT bail out to re-auth.
      mocks.createAuthenticatedClient.mockResolvedValue({
        __fake: 'client',
        auth: {
          getUser: vi
            .fn()
            .mockResolvedValue({ data: { user: null }, error: { message: 'network blip' } }),
        },
      })
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'team',
      })

      await linkCommand(undefined, { projectId: 'shared-proj-uuid' })

      // It reached the membership check and joined despite the getUser error.
      expect(mocks.findMemberProjectById).toHaveBeenCalled()
      expect(console_.logs.join('\n')).toContain("Joined project 'team-project'")
    })

    it('errors clearly (no browser) when TAGES_SERVICE_KEY is set but no local session exists', async () => {
      process.env.TAGES_SERVICE_KEY = 'svc-role-key'
      // No auth.json written — headless machine with only the service key.

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(
        linkCommand(undefined, { projectId: 'shared-proj-uuid' }),
      ).rejects.toThrow('process.exit called')

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(console_.errors.join('\n')).toContain('needs an authenticated user session')
      // Must not open an interactive browser flow in headless.
      expect(mocks.runGithubOAuth).not.toHaveBeenCalled()
      expect(mocks.findMemberProjectById).not.toHaveBeenCalled()
    })
  })
})
