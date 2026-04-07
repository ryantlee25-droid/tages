import { execSync } from 'child_process'
import { describe, it, expect } from 'vitest'

describe('Dashboard typecheck', () => {
  it('passes tsc --noEmit with 0 errors', () => {
    const result = execSync('pnpm --filter dashboard typecheck', {
      cwd: '/Users/ryan/projects/tages-worktrees/e2e-t7-typecheck',
      encoding: 'utf-8',
      timeout: 60000,
    })
    // If execSync throws, tsc exited non-zero
    expect(result).toBeDefined()  // success path
  }, 60000)
})
