import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fsModule from 'fs'

vi.mock('fs')

import { loadServerConfig } from '../config.js'

describe('loadServerConfig startup behavior', () => {
  const envKeys = [
    'SUPABASE_URL',
    'TAGES_SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'TAGES_SUPABASE_ANON_KEY',
    'TAGES_PROJECT_ID',
    'TAGES_PROJECT_SLUG',
  ]

  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    vi.mocked(fsModule.existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    vi.restoreAllMocks()
  })

  it('returns null when called with undefined and no env vars set', () => {
    const result = loadServerConfig(undefined)
    expect(result).toBeNull()
  })

  it('does not throw when called with undefined and no config present', () => {
    expect(() => loadServerConfig(undefined)).not.toThrow()
  })
})
