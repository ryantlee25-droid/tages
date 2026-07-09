import { describe, it, expect } from 'vitest'
import {
  redactSensitiveData,
  scanForSensitiveData,
  hasHighSeverity,
  formatSafetyWarnings,
} from '../safety'

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

// F2 — the AWS-secret-key heuristic used to redact ANY 40+ char alnum run,
// swallowing git SHAs, base64 blobs, and deep file paths. It must still catch
// a real keyed AWS secret while leaving those ordinary strings intact.
describe('redactSensitiveData — AWS secret key precision (F2)', () => {
  it('still redacts a real keyed aws_secret_access_key value (true positive)', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    const fixture = `aws_secret_access_key=${secret}`
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThan(0)
  })

  it('does NOT redact a deep file path (false positive guard)', () => {
    const path = '/home/user/projects/myapp/src/components/widgets/very/long/path'
    const { redacted, count } = redactSensitiveData(path)
    expect(redacted).toBe(path)
    expect(count).toBe(0)
  })

  it('does NOT redact a 40-hex git SHA (false positive guard)', () => {
    const sha = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const { redacted, count } = redactSensitiveData(`fix: land ${sha}`)
    expect(redacted).toContain(sha)
    expect(count).toBe(0)
  })

  it('does NOT redact a base64 blob (false positive guard)', () => {
    const blob = 'TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb24='
    const { redacted, count } = redactSensitiveData(blob)
    expect(redacted).toBe(blob)
    expect(count).toBe(0)
  })
})

// B1 — the F2 marker gate only fired on an `=`/`:` separator, re-opening a raw
// leak for AWS secrets set the DOCUMENTED way (space- or flag-separated). These
// six cases lock BOTH directions: the three real space/flag/env secret forms
// must redact, and the three ordinary 40-char strings must still survive.
describe('redactSensitiveData — AWS secret space/flag separator (B1)', () => {
  // 40-char AWS example secret (contains `/`, as real ones do).
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

  it('redacts a space-separated `aws configure set aws_secret_access_key <40char>` (true positive)', () => {
    const fixture = `aws configure set aws_secret_access_key ${secret}`
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('redacts a `--secret-access-key <40char>` flag form (true positive)', () => {
    const fixture = `--secret-access-key ${secret}`
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('still redacts the `AWS_SECRET_ACCESS_KEY=<40char>` env form (true positive)', () => {
    const fixture = `AWS_SECRET_ACCESS_KEY=${secret}`
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain(secret)
    expect(redacted).toContain('[REDACTED:')
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('does NOT redact a deep file path — no aws/secret marker (false positive guard)', () => {
    const p = '/home/user/projects/myapp/src/components/widgets/very/long/path'
    const { redacted, count } = redactSensitiveData(p)
    expect(redacted).toBe(p)
    expect(count).toBe(0)
  })

  it('does NOT redact a 40-hex git SHA (false positive guard)', () => {
    const sha = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    const { redacted, count } = redactSensitiveData(`fix: land ${sha}`)
    expect(redacted).toContain(sha)
    expect(count).toBe(0)
  })

  it('does NOT redact a bare base64 blob with no aws/secret marker (false positive guard)', () => {
    const blob = 'TWFuIGlzIGRpc3Rpbmd1aXNoZWQsIG5vdCBvbmx5IGJ5IGhpcyByZWFzb24='
    const { redacted, count } = redactSensitiveData(blob)
    expect(redacted).toBe(blob)
    expect(count).toBe(0)
  })
})

// W1 — the Phone pattern ran BEFORE Credit card and consumed the first 10 of a
// 16-digit PAN, leaving the 6-digit tail leaking raw
// (`{ccn:4111111111111111}` -> `[REDACTED:Phone number]111111`). Card/SSN now
// run first so the full run is consumed before Phone can bite a substring.
describe('redactSensitiveData — credit card vs phone ordering (W1)', () => {
  it('redacts the full 16-digit PAN leaving NO PAN digit substring in the output', () => {
    const pan = '4111111111111111'
    const { redacted, count } = redactSensitiveData(`{ccn:${pan}}`)
    expect(redacted).not.toContain(pan)
    // The core of W1: no trailing/leading digit substring of the PAN survives.
    expect(redacted).not.toMatch(/\d/)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('still redacts a genuine phone number as a phone', () => {
    const { redacted, count } = redactSensitiveData('call me at 555-123-4567')
    expect(redacted).not.toContain('555-123-4567')
    expect(redacted).toContain('[REDACTED:Phone number]')
    expect(count).toBeGreaterThanOrEqual(1)
  })
})

// F5 — common token shapes that previously passed through raw.
describe('redactSensitiveData — token shapes (F5)', () => {
  it('redacts a bare JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const { redacted, count } = redactSensitiveData(`session=${jwt}`)
    expect(redacted).not.toContain(jwt)
    expect(count).toBeGreaterThan(0)
  })

  it('redacts a token= assignment', () => {
    const fixture = 'token=abcdef1234567890XYZ'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('abcdef1234567890XYZ')
    expect(count).toBeGreaterThan(0)
  })

  it('redacts an x-api-token header', () => {
    const fixture = 'x-api-token: 7f3a9b2c1d8e4f5a6b7c8d9e'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('7f3a9b2c1d8e4f5a6b7c8d9e')
    expect(count).toBeGreaterThan(0)
  })

  it('redacts an Authorization: Token header', () => {
    const fixture = 'Authorization: Token ghs_abcdefghijklmnop'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).not.toContain('ghs_abcdefghijklmnop')
    expect(count).toBeGreaterThan(0)
  })

  it('leaves the phrase "JWT tokens" (no assignment) untouched — no over-redaction', () => {
    const fixture = 'The auth middleware checks JWT tokens from httpOnly cookies.'
    const { redacted, count } = redactSensitiveData(fixture)
    expect(redacted).toBe(fixture)
    expect(count).toBe(0)
  })
})

// F5 — close the branch-coverage gap flagged at safety.ts lines 75-86
// (formatSafetyWarnings: empty, high-severity, and medium-only branches).
describe('formatSafetyWarnings (branch coverage)', () => {
  it('returns an empty string when there are no warnings', () => {
    expect(formatSafetyWarnings([])).toBe('')
  })

  it('renders the blocked/high-severity branch when a secret is present', () => {
    const warnings = scanForSensitiveData('AWS_KEY=AKIAABCDEFGHIJKLMNOP')
    const out = formatSafetyWarnings(warnings)
    expect(out).toContain('Blocked')
    expect(out).toContain('secrets detected')
  })

  it('renders the medium-only branch when only PII is present', () => {
    const warnings = scanForSensitiveData('contact user@example.com')
    expect(hasHighSeverity(warnings)).toBe(false)
    const out = formatSafetyWarnings(warnings)
    expect(out).toContain('Safety warnings')
    expect(out).not.toContain('Blocked')
  })
})
