import { describe, it, expect } from 'vitest'
import { judgeRelevance, RELEVANCE_MIN_CANDIDATES } from '../relevance.js'

/**
 * These use the ACTUAL measured distributions from the calibration run (12
 * memories, hosted embedding model), not invented numbers — so if the rule is
 * ever retuned, these fail against reality rather than against a fixture
 * somebody made up to match the implementation.
 */

// Full 12-way score sets, top-first, straight from the calibration output.
const ANSWERABLE = {
  'deploy lock': [0.883, 0.811, 0.799, 0.795, 0.79, 0.788, 0.786, 0.784, 0.781, 0.779, 0.776, 0.733],
  'pod port': [0.908, 0.771, 0.762, 0.755, 0.749, 0.744, 0.741, 0.738, 0.735, 0.732, 0.729, 0.708],
  'api casing': [0.836, 0.807, 0.795, 0.788, 0.783, 0.779, 0.776, 0.773, 0.77, 0.767, 0.764, 0.742],
  'samesite': [0.95, 0.771, 0.778, 0.772, 0.769, 0.766, 0.763, 0.76, 0.757, 0.754, 0.751, 0.729],
}
const UNANSWERABLE = {
  nonsense: [0.775, 0.773, 0.766, 0.762, 0.758, 0.754, 0.75, 0.746, 0.742, 0.738, 0.734, 0.702],
  sourdough: [0.725, 0.725, 0.718, 0.714, 0.71, 0.706, 0.702, 0.698, 0.694, 0.69, 0.686, 0.717],
  worldcup: [0.731, 0.729, 0.722, 0.718, 0.714, 0.71, 0.706, 0.702, 0.698, 0.694, 0.69, 0.671],
  gibberish: [0.776, 0.772, 0.769, 0.767, 0.765, 0.763, 0.761, 0.759, 0.757, 0.755, 0.753, 0.751],
}

describe('judgeRelevance', () => {
  it('keeps every measured answerable query', () => {
    for (const [name, scores] of Object.entries(ANSWERABLE)) {
      expect(judgeRelevance(scores), name).toMatchObject({ relevant: true })
    }
  })

  it('rejects every measured unanswerable query', () => {
    for (const [name, scores] of Object.entries(UNANSWERABLE)) {
      expect(judgeRelevance(scores), name).toMatchObject({ relevant: false, reason: 'flat-and-low' })
    }
  })

  it('still applies the absolute floor to a SMALL candidate set', () => {
    // A brand-new project has two or three memories. An earlier version skipped
    // every check below RELEVANCE_MIN_CANDIDATES, so a new project had no floor
    // at all and nonsense returned everything — caught by the e2e suite, not by
    // this file, which is why the case is pinned here now.
    const v = judgeRelevance([0.775, 0.767])
    expect(v.relevant).toBe(false)
    expect(v.reason).toBe('too-few-candidates')
  })

  it('keeps a small candidate set when the top score is genuinely strong', () => {
    const v = judgeRelevance([0.91, 0.72])
    expect(v.relevant).toBe(true)
    expect(v.reason).toBe('strong-top-score')
  })

  it('keeps a flat but HIGH-scoring set, so a focused corpus is not suppressed', () => {
    // Every memory genuinely about the query's subject: no standout, but the
    // absolute scores say they are all relevant. The AND rule protects this.
    const v = judgeRelevance([0.88, 0.879, 0.878, 0.877, 0.876, 0.875])
    expect(v.relevant).toBe(true)
    expect(v.reason).toBe('strong-top-score')
  })

  it('keeps a low-scoring set where one result clearly stands out', () => {
    // z = 2.216, clearing RELEVANCE_MIN_Z despite every score being under the
    // absolute floor.
    const v = judgeRelevance([0.79, 0.62, 0.61, 0.6, 0.6, 0.59])
    expect(v.relevant).toBe(true)
    expect(v.reason).toBe('stands-out')
  })

  it('treats identical scores as having no standout rather than infinite z', () => {
    const v = judgeRelevance([0.7, 0.7, 0.7, 0.7, 0.7, 0.7])
    expect(v.z).toBe(0)
    expect(v.relevant).toBe(false)
  })

  it('returns not-relevant for an empty set instead of throwing', () => {
    expect(judgeRelevance([])).toMatchObject({ relevant: false, top: 0 })
  })

  it('ignores non-finite scores rather than poisoning the mean', () => {
    const withJunk = judgeRelevance([0.9, NaN, 0.6, Infinity, 0.6, 0.6, 0.6, 0.6])
    const clean = judgeRelevance([0.9, 0.6, 0.6, 0.6, 0.6, 0.6])
    expect(withJunk.top).toBe(clean.top)
    expect(withJunk.relevant).toBe(clean.relevant)
  })

  it('needs at least RELEVANCE_MIN_CANDIDATES rows before the z-score rescue applies', () => {
    // One clear standout among low scores: rescued only once there are enough
    // candidates for the spread to mean anything.
    // z values here are computed, not guessed: 4 rows -> 1.725, 6 rows -> 2.216.
    // Only the second clears RELEVANCE_MIN_Z, so the pair isolates the count
    // gate rather than accidentally testing the threshold.
    const four = [0.79, 0.62, 0.61, 0.6]
    const six = [0.79, 0.62, 0.61, 0.6, 0.6, 0.59]
    expect(judgeRelevance(four).relevant).toBe(false)
    expect(judgeRelevance(four).reason).toBe('too-few-candidates')
    expect(judgeRelevance(six).relevant).toBe(true)
    expect(judgeRelevance(six).reason).toBe('stands-out')
  })
})
