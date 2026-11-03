import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureConsole, TEST_PROJECT_CONFIG } from './helpers.js'

// A fake PostgREST builder that honours `.eq()` filters, so the test fails if
// onboard stops filtering on status (a plain chain mock would not notice).
const rows = [
  { key: 'live-conv', value: 'LIVE_CONV_VALUE', type: 'convention', status: 'live', project_id: 'test-project-id' },
  { key: 'pending-conv', value: 'PENDING_LEAK_VALUE', type: 'convention', status: 'pending', project_id: 'test-project-id' },
  { key: 'archived-dec', value: 'ARCHIVED_LEAK_VALUE', type: 'decision', status: 'archived', project_id: 'test-project-id' },
  { key: 'dont-x', value: 'NEVER_CALL_BILLING_FROM_RENDER', type: 'anti_pattern', status: 'live', project_id: 'test-project-id' },
  { key: 'env-x', value: 'ENV_VALUE_SHOWN', type: 'environment', status: 'live', project_id: 'test-project-id' },
]

function fakeSupabase() {
  return {
    from: vi.fn(() => {
      const filters: Array<[string, unknown]> = []
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return builder },
        order: () => builder,
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({
            data: rows.filter(r => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)),
            error: null,
          }).then(resolve),
      }
      return builder
    }),
  }
}

vi.mock('../auth/session.js', () => ({
  createAuthenticatedClientWithStatus: vi.fn(async () => ({ supabase: fakeSupabase(), status: 'authenticated' })),
  requireLiveSession: vi.fn(),
}))

vi.mock('../config/project.js', () => ({
  loadProjectConfig: () => TEST_PROJECT_CONFIG,
}))

vi.mock('ora', () => {
  const spinner = { start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis() }
  return { default: vi.fn(() => spinner) }
})

import { onboardCommand } from '../commands/onboard.js'

describe('tages onboard: live only', () => {
  let console_: ReturnType<typeof captureConsole>
  beforeEach(() => { console_ = captureConsole() })
  afterEach(() => console_.restore())

  it('omits pending and archived memories', async () => {
    await onboardCommand({})
    const out = console_.logs.join('\n')
    expect(out).toContain('LIVE_CONV_VALUE')
    expect(out).not.toContain('PENDING_LEAK_VALUE')
    expect(out).not.toContain('ARCHIVED_LEAK_VALUE')
    expect(out).toContain('3 memories')
  })

  it('shows anti_pattern memories and any other live type', async () => {
    await onboardCommand({})
    const out = console_.logs.join('\n')
    expect(out).toContain('ANTI-PATTERNS')
    expect(out).toContain('NEVER_CALL_BILLING_FROM_RENDER')
    expect(out).toContain('OTHER')
    expect(out).toContain('ENV_VALUE_SHOWN')
  })
})
