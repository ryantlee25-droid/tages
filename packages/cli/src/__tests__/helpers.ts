import { vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Standard project config for tests. Matches what `tages init --local` writes.
 */
export const TEST_PROJECT_CONFIG = {
  projectId: 'test-project-id',
  slug: 'test-project',
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
}

export const TEST_LOCAL_CONFIG = {
  projectId: 'local-test-project',
  slug: 'test-project',
  supabaseUrl: '',
  supabaseAnonKey: '',
}

export const TEST_AUTH = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  userId: 'test-user-id',
}

/**
 * Creates a temporary directory with a project config file so that
 * `loadProjectConfig` finds it. Returns the temp dir path and a cleanup fn.
 */
export function setupTempConfigDir(): { configDir: string; cleanup: () => void } {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-cli-test-'))
  const projectsDir = path.join(configDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  return {
    configDir,
    cleanup: () => {
      fs.rmSync(configDir, { recursive: true, force: true })
    },
  }
}

/**
 * Writes a project config JSON file into the temp config dir.
 */
export function writeProjectConfig(
  configDir: string,
  config: Record<string, unknown> = TEST_PROJECT_CONFIG,
) {
  const projectsDir = path.join(configDir, 'projects')
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true })
  }
  const slug = (config.slug as string) || 'test-project'
  fs.writeFileSync(
    path.join(projectsDir, `${slug}.json`),
    JSON.stringify(config, null, 2),
  )
}

/**
 * Writes an auth.json file into the temp config dir.
 */
export function writeAuthConfig(
  configDir: string,
  auth: Record<string, unknown> = TEST_AUTH,
) {
  fs.writeFileSync(
    path.join(configDir, 'auth.json'),
    JSON.stringify(auth, null, 2),
  )
}

/**
 * Creates a mock Supabase client that can be configured per-test.
 * Each chain method returns `this` to allow `.from().select().eq()...` chaining.
 */
export function createMockSupabaseClient(overrides?: {
  selectData?: unknown[] | null
  selectError?: { message: string } | null
  upsertError?: { message: string } | null
  deleteError?: { message: string } | null
  insertError?: { message: string } | null
  updateError?: { message: string } | null
  rpcData?: unknown[] | null
  rpcError?: { message: string } | null
  singleData?: unknown | null
  singleError?: { message: string } | null
}): { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> } {
  const selectData = overrides?.selectData ?? []
  const selectError = overrides?.selectError ?? null
  const upsertError = overrides?.upsertError ?? null
  const deleteError = overrides?.deleteError ?? null
  const insertError = overrides?.insertError ?? null
  const updateError = overrides?.updateError ?? null
  const rpcData = overrides?.rpcData ?? []
  const rpcError = overrides?.rpcError ?? null
  const singleData = overrides?.singleData ?? null
  const singleError = overrides?.singleError ?? null

  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: singleData, error: singleError }),
    then: undefined as unknown,
  }

  // Make the chainable resolve as a PromiseLike with data/error
  // This handles `const { data, error } = await supabase.from(...).select(...).eq(...)`
  const makeThenable = (obj: typeof chainable) => {
    obj.then = (resolve: (val: unknown) => void) => {
      return Promise.resolve({ data: selectData, error: selectError }).then(resolve)
    }
    return obj
  }

  const upsertResult = { data: null, error: upsertError }
  const deleteResult = { data: null, error: deleteError }
  const insertResult = { data: null, error: insertError }
  const updateChainable = {
    eq: vi.fn().mockResolvedValue({ data: null, error: updateError }),
  }

  const fromMock = vi.fn().mockReturnValue({
    ...makeThenable({ ...chainable }),
    upsert: vi.fn().mockResolvedValue(upsertResult),
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(deleteResult),
      }),
    }),
    insert: vi.fn().mockResolvedValue(insertResult),
    update: vi.fn().mockReturnValue(updateChainable),
  })

  const rpcMock = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError })

  return {
    from: fromMock,
    rpc: rpcMock,
  }
}

/**
 * Captures console.log and console.error output during a test.
 */
export function captureConsole() {
  const logs: string[] = []
  const errors: string[] = []

  const origLog = console.log
  const origError = console.error

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  }

  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog
      console.error = origError
    },
  }
}
