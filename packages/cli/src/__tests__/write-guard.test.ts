import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureConsole } from './helpers.js'
import { assertRowsAffected } from '../lib/write-guard.js'

describe('assertRowsAffected', () => {
  let console_: ReturnType<typeof captureConsole>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    console_ = captureConsole()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    exitSpy.mockRestore()
    console_.restore()
  })

  it('returns quietly when at least one row changed (default expected = 1)', () => {
    assertRowsAffected({ data: [{ id: 'a' }], error: null }, { action: 'verify memories' })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('returns quietly when every expected row changed', () => {
    assertRowsAffected({ data: [{ id: 'a' }, { id: 'b' }], error: null }, { action: 'approve memories', expected: 2 })
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('zero rows (RLS-filtered) -> permission denied, exit 1', () => {
    expect(() => assertRowsAffected({ data: [], error: null }, { action: 'verify memories' })).toThrow(
      'process.exit called',
    )
    expect(exitSpy).toHaveBeenCalledWith(1)
    const err = console_.errors.join('\n')
    expect(err).toContain('Permission denied: your role cannot verify memories on this project')
    expect(err).toContain('Nothing was changed.')
  })

  it('null data is treated as zero rows', () => {
    expect(() => assertRowsAffected({ data: null, error: null }, { action: 'x' })).toThrow('process.exit called')
    expect(console_.errors.join('\n')).toContain('Permission denied')
  })

  it('partial bulk result -> "Only N of M", exit 1', () => {
    expect(() =>
      assertRowsAffected({ data: [{ id: 'a' }], error: null }, { action: 'approve memories', expected: 3 }),
    ).toThrow('process.exit called')
    expect(console_.errors.join('\n')).toContain('Only 1 of 3 changed')
  })

  it('error -> "Failed to <action>", exit 1', () => {
    expect(() =>
      assertRowsAffected({ data: null, error: { message: 'boom' } }, { action: 'approve memories' }),
    ).toThrow('process.exit called')
    expect(console_.errors.join('\n')).toContain('Failed to approve memories: boom')
  })

  it('runs beforeExit before printing', () => {
    const beforeExit = vi.fn()
    expect(() => assertRowsAffected({ data: [], error: null }, { action: 'x', beforeExit })).toThrow()
    expect(beforeExit).toHaveBeenCalledTimes(1)
  })
})
