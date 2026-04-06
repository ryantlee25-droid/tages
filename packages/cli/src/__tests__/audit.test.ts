import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setupTempConfigDir,
  writeProjectConfig,
  writeAuthConfig,
  createMockSupabaseClient,
  captureConsole,
} from './helpers.js'

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClient: vi.fn(),
}))

vi.mock('../config/project.js', () => ({
  loadProjectConfig: vi.fn(),
}))

describe('auditCommand', () => {
  let configDir: string
  let cleanup: () => void

  beforeEach(() => {
    const setup = setupTempConfigDir()
    configDir = setup.configDir
    cleanup = setup.cleanup
    writeProjectConfig(configDir)
    writeAuthConfig(configDir)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls auditMemories and renders a non-empty table for a project with memories', async () => {
    const { loadProjectConfig } = await import('../config/project.js')
    const { createAuthenticatedClient } = await import('../auth/session.js')

    vi.mocked(loadProjectConfig).mockReturnValue({
      projectId: 'test-project-id',
      slug: 'test-project',
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    } as ReturnType<typeof loadProjectConfig>)

    const mockMemoryRows = [
      {
        id: 'id-1', project_id: 'test-project-id',
        key: 'supabase-wrap', value: 'ALWAYS wrap Supabase calls with Promise.resolve()',
        type: 'lesson', source: 'manual', status: 'live', confidence: 1.0,
        file_paths: [], tags: [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      {
        id: 'id-2', project_id: 'test-project-id',
        key: 'no-default-export', value: 'NEVER use default exports',
        type: 'convention', source: 'manual', status: 'live', confidence: 1.0,
        file_paths: [], tags: [],
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]

    vi.mocked(createAuthenticatedClient).mockResolvedValue(
      createMockSupabaseClient({ selectData: mockMemoryRows }) as unknown as Awaited<ReturnType<typeof createAuthenticatedClient>>
    )

    const consoleCap = captureConsole()

    const { auditCommand } = await import('../commands/audit.js')
    await auditCommand({ json: false })

    consoleCap.restore()

    const output = consoleCap.logs.join('\n')
    expect(output).toContain('Memory Quality Audit')
    expect(output.length).toBeGreaterThan(0)
  })

  it('outputs raw JSON with --json flag', async () => {
    const { loadProjectConfig } = await import('../config/project.js')
    const { createAuthenticatedClient } = await import('../auth/session.js')

    vi.mocked(loadProjectConfig).mockReturnValue({
      projectId: 'test-project-id',
      slug: 'test-project',
      supabaseUrl: 'https://test.supabase.co',
      supabaseAnonKey: 'test-anon-key',
    } as ReturnType<typeof loadProjectConfig>)

    vi.mocked(createAuthenticatedClient).mockResolvedValue(
      createMockSupabaseClient({ selectData: [] }) as unknown as Awaited<ReturnType<typeof createAuthenticatedClient>>
    )

    const written: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => {
      written.push(String(chunk))
      return true
    }

    const { auditCommand } = await import('../commands/audit.js')
    await auditCommand({ json: true })

    process.stdout.write = origWrite

    const output = written.join('')
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('score')
    expect(parsed).toHaveProperty('typeCounts')
    expect(parsed).toHaveProperty('suggestions')
  })
})
