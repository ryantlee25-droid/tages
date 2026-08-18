import { describe, it, expect } from 'vitest'
import {
  isEvidenceLevel,
  evidenceWeight,
  EVIDENCE_LEVELS,
  EVIDENCE_WEIGHT,
  type EvidenceLevel,
} from '../types.js'

/**
 * Evidence levels (migration 0070) answer "how well established is this claim",
 * which `type`, `source`, and a `confidence` float all fail to express. The
 * tests here pin the two properties that make the field worth having: it cannot
 * absorb arbitrary strings, and it actually changes retrieval order.
 */

describe('isEvidenceLevel', () => {
  it('accepts every declared level', () => {
    for (const level of EVIDENCE_LEVELS) expect(isEvidenceLevel(level)).toBe(true)
  })

  it('rejects plausible-looking near-misses', () => {
    // These are exactly what a human or a model would type from memory. A free
    // text field would swallow them and the column stops being interpretable.
    for (const bad of ['Verified', 'VERIFIED', 'confirmed', 'probably-true', 'true', 'high', 'certain']) {
      expect(isEvidenceLevel(bad)).toBe(false)
    }
  })

  it('rejects non-strings and empty input', () => {
    for (const bad of [undefined, null, '', 0, 1, true, {}, ['verified']]) {
      expect(isEvidenceLevel(bad)).toBe(false)
    }
  })
})

describe('evidenceWeight', () => {
  it('treats an unknown level neutrally rather than punishing it', () => {
    // Every row written before 0070 has no level. Demoting them would bury an
    // entire existing corpus the moment this shipped.
    expect(evidenceWeight(undefined)).toBe(1.0)
    expect(evidenceWeight(null)).toBe(1.0)
  })

  it('ranks verified at full weight', () => {
    expect(evidenceWeight('verified')).toBe(1.0)
  })

  it('orders the levels by how well established they are', () => {
    const order: EvidenceLevel[] = ['verified', 'declared', 'observed', 'inferred', 'disputed']
    const weights = order.map(evidenceWeight)
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThan(weights[i - 1])
    }
  })

  it('demotes an inferred guess below a verified fact by a margin that can flip a ranking', () => {
    // The whole point. If the gap were negligible the field would be
    // decorative: a slightly better text match on a guess would still win.
    expect(evidenceWeight('verified') - evidenceWeight('inferred')).toBeGreaterThanOrEqual(0.2)
  })

  it('demotes disputed hardest but never to zero, so it stays findable', () => {
    // A contradicted claim is exactly what someone re-litigating a decision
    // needs to find. Suppressing it entirely would hide the disagreement.
    expect(evidenceWeight('disputed')).toBeLessThan(evidenceWeight('inferred'))
    expect(evidenceWeight('disputed')).toBeGreaterThan(0)
  })

  it('assigns a weight to every declared level, so none can silently score zero', () => {
    for (const level of EVIDENCE_LEVELS) {
      expect(EVIDENCE_WEIGHT[level]).toBeGreaterThan(0)
      expect(EVIDENCE_WEIGHT[level]).toBeLessThanOrEqual(1)
    }
    expect(Object.keys(EVIDENCE_WEIGHT).sort()).toEqual([...EVIDENCE_LEVELS].sort())
  })
})
