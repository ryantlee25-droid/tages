import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
}))

import { linkCommand } from '../commands/link.js'

describe('link command', () => {
  let cleanupConfigDir: () => void
  let console_: ReturnType<typeof captureConsole>
  let workDir: string
  let origCwd: string

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupConfigDir = setup.cleanup
    console_ = captureConsole()
    vi.clearAllMocks()

    origCwd = process.cwd()
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-link-cwd-'))
    process.chdir(workDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    console_.restore()
    cleanupConfigDir()
    fs.rmSync(workDir, { recursive: true, force: true })
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
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
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
        { __fake: 'supabase-client' },
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
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
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
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
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
        { __fake: 'supabase-client' },
      )
    })

    it('respects --supabase-url override', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
      mocks.findMemberProjectById.mockResolvedValue({
        projectId: 'shared-proj-uuid',
        slug: 'team-project',
        plan: 'free',
      })

      await linkCommand(undefined, {
        projectId: 'shared-proj-uuid',
        supabaseUrl: 'https://self-hosted.example.com',
      })

      expect(mocks.createAuthenticatedClient).toHaveBeenCalledWith(
        'https://self-hosted.example.com',
        expect.any(String),
      )

      const config = JSON.parse(
        fs.readFileSync(path.join(tempConfigDir, 'projects', 'team-project.json'), 'utf-8'),
      )
      expect(config.supabaseUrl).toBe('https://self-hosted.example.com')
    })
  })

  // -------------------------------------------------------------------
  // (c) --project-id for a project the user is NOT a member of is rejected
  // -------------------------------------------------------------------
  describe('--project-id rejection paths', () => {
    it('rejects (does not write config) when the user is not a member of the project', async () => {
      writeAuthConfig(tempConfigDir, TEST_AUTH)
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
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
      mocks.createAuthenticatedClient.mockResolvedValue({ __fake: 'supabase-client' })
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
  })
})
