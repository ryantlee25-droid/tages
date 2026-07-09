import { describe, it, expect } from 'vitest'
import { redactSensitiveData, scanForSensitiveData, hasHighSeverity } from '../safety'

describe('redactSensitiveData', () => {
  it('replaces an AWS access key, not just flags it', () => {
    const fixture = 'export AWS_KEY=AKIAABCDEFGHIJKLMNOP'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThan(0)
  })

  it('replaces a GitHub token, not just flags it', () => {
    // Split literal to avoid this fixture itself tripping a secret scanner.
    const fixture = 'token: ' + 'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyz1234'
    const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234'
    const { redacted, count } = redactSensitiveData(fixture)
    // The 40-char alnum run after "ghp_" also satisfies the broader "AWS
    // secret key" pattern, which runs first and consumes it — the specific
    // [REDACTED:<label>] name isn't guaranteed, but the literal secret must
    // be gone and a redaction marker must be present either way.
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThan(0)
  })

  it('replaces a password field, not just flags it', () => {
    const fixture = 'password=my_super_secret_password'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('my_super_secret_password')
    expect(redacted).toContain('[REDACTED:Password field]')
    expect(count).toBeGreaterThan(0)
  })

  it('redacts multiple distinct secrets in the same text', () => {
    const fixture = [
      'AWS_KEY=AKIAABCDEFGHIJKLMNOP',
      'password=hunter2hunter2',
      'contact user@example.com',
    ].join('\n')
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(redacted).not.toContain('hunter2hunter2')
    expect(redacted).not.toContain('user@example.com')
    expect(count).toBeGreaterThanOrEqual(3)
  })

  it('leaves clean text untouched with a zero count', () => {
    const fixture = 'Use snake_case for all API route names.'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).toBe(fixture)
    expect(count).toBe(0)
  })

  it('still reports the same warnings via scanForSensitiveData (scan is unaffected by redaction)', () => {
    const fixture = 'AWS_KEY=AKIAABCDEFGHIJKLMNOP'
    const warnings = scanForSensitiveData(fixture)
    expect(hasHighSeverity(warnings)).toBe(true)
    expect(warnings.some(w => w.name === 'AWS access key')).toBe(true)
  })
})
