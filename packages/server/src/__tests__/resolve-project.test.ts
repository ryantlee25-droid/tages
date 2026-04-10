import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fsModule from 'fs'
import * as childProcess from 'child_process'

vi.mock('fs')
vi.mock('child_process')

const mockCreateCloudProject = vi.fn()
const mockCreateLocalProject = vi.fn()
const mockCreateSupabaseClient = vi.fn()

vi.mock('@tages/shared', () => ({
  createCloudProject: (...args: unknown[]) => mockCreateCloudProject(...args),
  createLocalProject: (...args: unknown[]) => mockCreateLocalProject(...args),
  createSupabaseClient: (...args: unknown[]) => mockCreateSupabaseClient(...args),
}))

import { resolveProject } from '../config.js'
import type { ProjectConfig } from '@tages/shared'

// Test fixtures
const TAGES_PROJECT: ProjectConfig = {
  projectId: 'uuid-tages',
  slug: 'tages',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-key',
  plan: 'pro',
}

const REMNANT_PROJECT: ProjectConfig = {
  projectId: 'uuid-remnant',
  slug: 'the-remnant',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-key',
  plan: 'free',
}

const REGISTERED_PROJECTS = [TAGES_PROJECT, REMNANT_PROJECT]

function setupFs(opts: {
  markerExists?: boolean
  markerContent?: string
  registeredProjects?: ProjectConfig[]
  authExists?: boolean
  authContent?: string
  projectConfigExists?: boolean
}) {
  const projects = opts.registeredProjects ?? REGISTERED_PROJECTS

  vi.mocked(fsModule.existsSync).mockImplementation((p: fsModule.PathLike) => {
    const s = String(p)
    if (s.endsWith('/.tages/config.json')) return opts.markerExists ?? false
    if (s.endsWith('/auth.json')) return opts.authExists ?? false
    if (s.includes('/projects') && s.endsWith('.json')) {
      // Check if this specific project config exists
      const slug = s.split('/').pop()?.replace('.json', '')
      return projects.some(p => p.slug === slug)
    }
    if (s.includes('/projects')) return projects.length > 0
    if (s.includes('/cache')) return true
    return opts.projectConfigExists ?? false
  })

  vi.mocked(fsModule.readFileSync).mockImplementation((p: fsModule.PathLike | number) => {
    const s = String(p)
    if (s.endsWith('/.tages/config.json')) return (opts.markerContent ?? '{}') as unknown as Buffer
    if (s.endsWith('/auth.json')) {
      return (opts.authContent ?? JSON.stringify({
        accessToken: 'tok', refreshToken: 'ref', userId: 'uid'
      })) as unknown as Buffer
    }
    // Return matching project config
    for (const proj of projects) {
      if (s.endsWith(`/${proj.slug}.json`)) {
        return JSON.stringify(proj) as unknown as Buffer
      }
    }
    return '{}' as unknown as Buffer
  })

  vi.mocked(fsModule.readdirSync).mockImplementation(() =>
    projects.map(p => `${p.slug}.json`) as unknown as fsModule.Dirent[]
  )

  vi.mocked(fsModule.mkdirSync).mockReturnValue(undefined)
  vi.mocked(fsModule.writeFileSync).mockReturnValue(undefined)
}

describe('resolveProject()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Suppress console.error from detection logs
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Strategy 1 — .tages/config.json marker', () => {
    it('returns marker match when marker exists and slug matches a registered project', async () => {
      setupFs({
        markerExists: true,
        markerContent: JSON.stringify({ slug: 'tages' }),
      })

      const result = await resolveProject('/home/user/projects/tages')
      expect(result.detectionMethod).toBe('marker')
      expect(result.config.slug).toBe('tages')
      expect(result.config.projectId).toBe('uuid-tages')
    })

    it('falls through when marker file does not exist', async () => {
      setupFs({
        markerExists: false,
      })
      // Will fall through to git (which we mock to fail), then dirname
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('not a repo') })

      const result = await resolveProject('/home/user/projects/tages')
      // Should match via dirname (strategy 3) since /tages matches slug 'tages'
      expect(result.detectionMethod).toBe('dirname')
    })

    it('falls through when marker JSON is corrupt', async () => {
      setupFs({
        markerExists: true,
        markerContent: 'not valid json {{{',
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('not a repo') })

      const result = await resolveProject('/home/user/projects/tages')
      expect(result.detectionMethod).toBe('dirname')
    })

    it('falls through when marker slug does not match any registered project', async () => {
      setupFs({
        markerExists: true,
        markerContent: JSON.stringify({ slug: 'nonexistent' }),
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('not a repo') })

      const result = await resolveProject('/home/user/projects/tages')
      expect(result.detectionMethod).toBe('dirname')
    })

    it('falls through when marker has no slug field', async () => {
      setupFs({
        markerExists: true,
        markerContent: JSON.stringify({ name: 'tages' }), // wrong field
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('not a repo') })

      const result = await resolveProject('/home/user/projects/tages')
      expect(result.detectionMethod).toBe('dirname')
    })
  })

  describe('Strategy 2 — git remote URL match', () => {
    it('returns git-remote match for HTTPS URL', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockReturnValue(
        'https://github.com/owner/tages.git\n' as unknown as Buffer
      )

      const result = await resolveProject('/home/user/somewhere')
      expect(result.detectionMethod).toBe('git-remote')
      expect(result.config.slug).toBe('tages')
    })

    it('returns git-remote match for SSH URL', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockReturnValue(
        'git@github.com:owner/tages.git\n' as unknown as Buffer
      )

      const result = await resolveProject('/home/user/somewhere')
      expect(result.detectionMethod).toBe('git-remote')
      expect(result.config.slug).toBe('tages')
    })

    it('returns git-remote match for HTTPS URL without .git suffix', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockReturnValue(
        'https://github.com/owner/the-remnant\n' as unknown as Buffer
      )

      const result = await resolveProject('/home/user/somewhere')
      expect(result.detectionMethod).toBe('git-remote')
      expect(result.config.slug).toBe('the-remnant')
    })

    it('falls through when execSync throws (not a git repo)', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('fatal: not a git repository')
      })

      const result = await resolveProject('/home/user/projects/tages')
      // Falls through to dirname
      expect(result.detectionMethod).toBe('dirname')
    })

    it('falls through when remote URL yields no registered match', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockReturnValue(
        'https://github.com/owner/unknown-repo.git\n' as unknown as Buffer
      )

      const result = await resolveProject('/home/user/projects/tages')
      // Falls through to dirname
      expect(result.detectionMethod).toBe('dirname')
    })
  })

  describe('Strategy 3 — directory name match', () => {
    it('returns dirname match when basename matches a registered slug', async () => {
      setupFs({ markerExists: false })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })

      const result = await resolveProject('/home/user/projects/tages')
      expect(result.detectionMethod).toBe('dirname')
      expect(result.config.slug).toBe('tages')
      expect(result.config.plan).toBe('pro')
    })

    it('falls through when sanitized dir name has no registered match', async () => {
      setupFs({ markerExists: false, authExists: false })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })
      mockCreateLocalProject.mockReturnValue({
        projectId: 'local-unknown',
        slug: 'unknown',
        supabaseUrl: '',
        supabaseAnonKey: '',
      })

      const result = await resolveProject('/home/user/projects/unknown')
      expect(result.detectionMethod).toBe('auto-create')
    })

    it('sanitizeSlug: spaces become hyphens', async () => {
      setupFs({
        markerExists: false,
        registeredProjects: [{ ...TAGES_PROJECT, slug: 'my-project' }],
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })

      const result = await resolveProject('/home/user/My Project')
      expect(result.detectionMethod).toBe('dirname')
      expect(result.config.slug).toBe('my-project')
    })

    it('sanitizeSlug: special chars become hyphens', async () => {
      setupFs({
        markerExists: false,
        registeredProjects: [{ ...TAGES_PROJECT, slug: 'project-v2-0' }],
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })

      const result = await resolveProject('/home/user/project@v2.0')
      expect(result.detectionMethod).toBe('dirname')
      expect(result.config.slug).toBe('project-v2-0')
    })

    it('sanitizeSlug: all-invalid chars fall back to "unnamed"', async () => {
      setupFs({
        markerExists: false,
        authExists: false,
        registeredProjects: [],
      })
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })
      mockCreateLocalProject.mockReturnValue({
        projectId: 'local-unnamed',
        slug: 'unnamed',
        supabaseUrl: '',
        supabaseAnonKey: '',
      })

      const result = await resolveProject('/home/user/!!!')
      expect(result.config.slug).toBe('unnamed')
    })
  })

  describe('Strategy 4 — auto-create', () => {
    beforeEach(() => {
      // No marker, no git, no dirname match
      vi.mocked(childProcess.execSync).mockImplementation(() => { throw new Error('no git') })
    })

    describe('authenticated path', () => {
      it('calls createCloudProject when auth.json is present', async () => {
        setupFs({
          markerExists: false,
          registeredProjects: [], // no matches
          authExists: true,
        })

        const mockSupabase = {
          auth: { setSession: vi.fn().mockResolvedValue({}) },
        }
        mockCreateSupabaseClient.mockReturnValue(mockSupabase)
        mockCreateCloudProject.mockResolvedValue({
          projectId: 'cloud-new',
          slug: 'new-project',
          supabaseUrl: 'https://test.supabase.co',
          supabaseAnonKey: 'key',
          plan: 'free',
        })

        const result = await resolveProject('/home/user/new-project')
        expect(result.detectionMethod).toBe('auto-create')
        expect(result.config.projectId).toBe('cloud-new')
        expect(mockCreateCloudProject).toHaveBeenCalledOnce()
      })

      it('falls back to local when createCloudProject throws tier limit error', async () => {
        setupFs({
          markerExists: false,
          registeredProjects: [],
          authExists: true,
        })

        const mockSupabase = {
          auth: { setSession: vi.fn().mockResolvedValue({}) },
        }
        mockCreateSupabaseClient.mockReturnValue(mockSupabase)
        mockCreateCloudProject.mockRejectedValue(new Error('Free tier is limited to 2 projects.'))
        mockCreateLocalProject.mockReturnValue({
          projectId: 'local-new-project',
          slug: 'new-project',
          supabaseUrl: '',
          supabaseAnonKey: '',
        })

        const result = await resolveProject('/home/user/new-project')
        expect(result.detectionMethod).toBe('auto-create')
        expect(result.config.projectId).toBe('local-new-project')
      })

      it('falls back to local when auth.json is corrupt', async () => {
        setupFs({
          markerExists: false,
          registeredProjects: [],
          authExists: true,
          authContent: 'not json {{{',
        })
        mockCreateLocalProject.mockReturnValue({
          projectId: 'local-my-project',
          slug: 'my-project',
          supabaseUrl: '',
          supabaseAnonKey: '',
        })

        const result = await resolveProject('/home/user/my-project')
        // Corrupt auth → loadAuth returns null → unauthenticated path
        expect(result.detectionMethod).toBe('auto-create')
        expect(mockCreateCloudProject).not.toHaveBeenCalled()
      })
    })

    describe('unauthenticated path', () => {
      it('calls createLocalProject when auth.json does not exist', async () => {
        setupFs({
          markerExists: false,
          registeredProjects: [],
          authExists: false,
        })
        mockCreateLocalProject.mockReturnValue({
          projectId: 'local-new-project',
          slug: 'new-project',
          supabaseUrl: '',
          supabaseAnonKey: '',
        })

        const result = await resolveProject('/home/user/new-project')
        expect(result.detectionMethod).toBe('auto-create')
        expect(result.config.projectId).toBe('local-new-project')
        expect(mockCreateCloudProject).not.toHaveBeenCalled()
      })

      it('saves config file for new local project', async () => {
        setupFs({
          markerExists: false,
          registeredProjects: [],
          authExists: false,
        })
        mockCreateLocalProject.mockReturnValue({
          projectId: 'local-fresh',
          slug: 'fresh',
          supabaseUrl: '',
          supabaseAnonKey: '',
        })

        await resolveProject('/home/user/fresh')
        expect(vi.mocked(fsModule.writeFileSync)).toHaveBeenCalled()
      })
    })
  })
})
