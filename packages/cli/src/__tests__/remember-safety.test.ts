import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scanForSensitiveData, hasHighSeverity } from '@tages/shared'

/**
 * The CLI's secret gate (added after the end-to-end suite caught `tages
 * remember` persisting an AWS key that the MCP path already blocked).
 *
 * These assert the DECISION the command makes — whether a given input is
 * high-severity and therefore refused — rather than re-testing the CLI's
 * process wiring, which commands-smoke.test.ts already covers.
 */
describe('remember secret gate', () => {
  it('treats a real-shaped AWS key as high severity', () => {
    // AWS's own published example key, not a live credential.
    const w = scanForSensitiveData('deploy-notes Deploy uses AKIAIOSFODNN7EXAMPLE for the bucket')
    expect(hasHighSeverity(w)).toBe(true)
  })

  it('treats a Stripe live key as high severity', () => {
    // Assembled at runtime, not written as a literal. The value is fake, but a
    // literal `sk_live_…` in a committed file trips GitHub's push protection —
    // which is correct behaviour on its part, and blocked this very commit.
    // Concatenation keeps the fixture meaningful to the scanner under test
    // without leaving something key-shaped sitting in the repo.
    const fakeStripe = ['sk', 'live', '0123456789abcdefghijklmn'].join('_')
    expect(hasHighSeverity(scanForSensitiveData(`billing ${fakeStripe}`))).toBe(true)
  })

  it('treats a private key block as high severity', () => {
    const w = scanForSensitiveData('ssh -----BEGIN RSA PRIVATE KEY-----')
    expect(hasHighSeverity(w)).toBe(true)
  })

  it('scans the KEY as well as the value, so a secret in the name is caught too', () => {
    // The command passes `${key} ${value}` for exactly this reason.
    const w = scanForSensitiveData('AKIAIOSFODNN7EXAMPLE some harmless note')
    expect(hasHighSeverity(w)).toBe(true)
  })

  it('does not block an ordinary engineering memory', () => {
    // A gate that fires on normal content would push people to --force by
    // reflex, which is worse than no gate.
    for (const text of [
      'api-conventions All API routes use snake_case',
      'deploy-gate The staging deploy blocks on a stale migration lock',
      'pool-size The reporting database connection pool ceiling is 40',
    ]) {
      expect(hasHighSeverity(scanForSensitiveData(text))).toBe(false)
    }
  })
})
