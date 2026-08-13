import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import {
  setupTempConfigDir,
  writeAuthConfig,
  captureConsole,
  TEST_PROJECT_CONFIG,
} from './helpers.js'

// vi.mock factories are hoisted — use vi.hoisted() to share mocks.
const { mockLoadProjectConfig, mockCreateAuthenticatedClient, mockInviteTeamMembers } =
  vi.hoisted(() => {
    const mockLoadProjectConfig = vi.fn()
    const mockCreateAuthenticatedClient = vi.fn()
    const mockInviteTeamMembers = vi.fn()
    return { mockLoadProjectConfig, mockCreateAuthenticatedClient, mockInviteTeamMembers }
  })

vi.mock('../config/project.js', () => ({
  loadProjectConfig: mockLoadProjectConfig,
}))

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: mockCreateAuthenticatedClient,
}))

vi.mock('../auth/invite.js', () => ({
  inviteTeamMembers: mockInviteTeamMembers,
}))

let tempConfigDir: string

vi.mock('../config/paths.js', () => ({
  getConfigDir: () => tempConfigDir,
  getProjectsDir: () => path.join(tempConfigDir, 'projects'),
  getAuthPath: () => path.join(tempConfigDir, 'auth.json'),
  getCachePath: (slug: string) => path.join(tempConfigDir, 'cache', `${slug}.db`),
  getCacheDir: () => path.join(tempConfigDir, 'cache'),
}))

import { teamInviteCommand } from '../commands/team.js'

describe('teamInviteCommand — invitable roles', () => {
  let console_: ReturnType<typeof captureConsole>
  let cleanupFn: () => void

  beforeEach(() => {
    const setup = setupTempConfigDir()
    tempConfigDir = setup.configDir
    cleanupFn = setup.cleanup
    writeAuthConfig(tempConfigDir)
    console_ = captureConsole()
    vi.clearAllMocks()

    mockLoadProjectConfig.mockReturnValue(TEST_PROJECT_CONFIG)
    mockCreateAuthenticatedClient.mockResolvedValue({ from: vi.fn() })
    mockInviteTeamMembers.mockResolvedValue({ invited: ['a@example.com'], failed: [] })
  })

  afterEach(() => {
    console_.restore()
    cleanupFn()
  })

  // -------------------------------------------------------------------------
  // The defect: 'owner' was accepted, letting any active admin mint an owner.
  // -------------------------------------------------------------------------

  it("rejects --role owner and never reaches the invite call", async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      teamInviteCommand('mallory@example.com', { role: 'owner' }),
    ).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(mockInviteTeamMembers).not.toHaveBeenCalled()
    // Rejected before any credential read or network client construction.
    expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('error message for owner states what is allowed and why owner is not', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      teamInviteCommand('mallory@example.com', { role: 'owner' }),
    ).rejects.toThrow('process.exit called')

    const errors = console_.errors.join('\n')
    expect(errors).toContain("Invalid role 'owner'")
    expect(errors).toContain('member')
    expect(errors).toContain('admin')
    expect(errors).toContain('Ownership cannot be granted through an invite')
    exitSpy.mockRestore()
  })

  it('rejects owner case-insensitively (OWNER is normalised before the check)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      teamInviteCommand('mallory@example.com', { role: 'OWNER' }),
    ).rejects.toThrow('process.exit called')

    expect(mockInviteTeamMembers).not.toHaveBeenCalled()
    expect(console_.errors.join('\n')).toContain('Ownership cannot be granted')
    exitSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Legitimate roles must keep working.
  // -------------------------------------------------------------------------

  it('accepts --role admin and forwards it to inviteTeamMembers', async () => {
    await teamInviteCommand('alice@example.com', { role: 'admin' })

    expect(mockInviteTeamMembers).toHaveBeenCalledTimes(1)
    expect(mockInviteTeamMembers).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_CONFIG.projectId,
      ['alice@example.com'],
      'test-user-id',
      'admin',
    )
    expect(console_.logs.join('\n')).toContain('Invited alice@example.com as admin')
  })

  it('accepts --role member and forwards it to inviteTeamMembers', async () => {
    await teamInviteCommand('bob@example.com', { role: 'member' })

    expect(mockInviteTeamMembers).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_CONFIG.projectId,
      ['bob@example.com'],
      'test-user-id',
      'member',
    )
  })

  it('defaults to member when no role is supplied', async () => {
    await teamInviteCommand('carol@example.com', {})

    expect(mockInviteTeamMembers).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_CONFIG.projectId,
      ['carol@example.com'],
      'test-user-id',
      'member',
    )
  })

  it('normalises mixed-case ADMIN to admin', async () => {
    await teamInviteCommand('dave@example.com', { role: 'ADMIN' })

    expect(mockInviteTeamMembers).toHaveBeenCalledWith(
      expect.anything(),
      TEST_PROJECT_CONFIG.projectId,
      ['dave@example.com'],
      'test-user-id',
      'admin',
    )
  })

  // -------------------------------------------------------------------------
  // Unrelated invalid roles keep the plain message (no ownership hint).
  // -------------------------------------------------------------------------

  it('rejects an unknown role without the ownership hint', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(
      teamInviteCommand('eve@example.com', { role: 'superuser' }),
    ).rejects.toThrow('process.exit called')

    const errors = console_.errors.join('\n')
    expect(errors).toContain("Invalid role 'superuser'")
    expect(errors).toContain('Must be one of: member, admin')
    expect(errors).not.toContain('Ownership cannot be granted')
    expect(mockInviteTeamMembers).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('surfaces invite failures returned by inviteTeamMembers', async () => {
    mockInviteTeamMembers.mockResolvedValue({
      invited: [],
      failed: [
        {
          email: 'frank@example.com',
          error: 'Only project owners can grant the admin role',
        },
      ],
    })

    await teamInviteCommand('frank@example.com', { role: 'admin' })

    // The database trigger from 0067 is what produces this message; the CLI
    // must relay it rather than swallow it.
    expect(console_.errors.join('\n')).toContain(
      'Only project owners can grant the admin role',
    )
  })
})
