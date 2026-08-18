/**
 * Relevance floor — deciding when the honest answer is "nothing".
 *
 * THE PROBLEM, measured rather than assumed. The recall RPCs filter on an
 * absolute cosine threshold (`p_threshold`, defaulting to 0.7 or 0.3). Against
 * the hosted embedding model that is not a filter at all: a query of pure
 * nonsense ("wibbleflux ganthorpe zzzqx") scores 0.775 against unrelated
 * memories, and "what is the best recipe for sourdough bread" scores 0.725.
 * Both clear 0.7. So `tages recall <anything>` returned the whole project, and
 * an agent received irrelevant memories presented as answers.
 *
 * The model's cosines live in a narrow high band (~0.69-0.95). No absolute
 * cutoff separates cleanly, and any constant that happened to work would break
 * the moment the embedding model changed.
 *
 * WHAT ACTUALLY SEPARATES. Calibrated over a 12-memory corpus and 13 queries
 * (8 answerable, 5 not):
 *
 *   signal      answerable     unanswerable   margin
 *   top         0.836-0.950    0.725-0.776    0.060
 *   top-2nd     0.029-0.179    0.000-0.021    0.008
 *   top-mean    0.058-0.182    0.011-0.055    0.003
 *   z-score     2.272-3.222    1.118-1.994    0.277   <- widest, and scale-free
 *
 * A query the corpus can answer makes ONE result stand out. A query it cannot
 * produces a flat pack. The z-score of the top result measures exactly that,
 * in units of the candidate set's own spread - so it does not care what band
 * the model's cosines occupy.
 *
 * WHY THE RULE IS AN `AND`. Suppression is destructive: hiding a memory
 * somebody needed is worse than showing one they did not. So results are
 * dropped only when BOTH signals agree nothing is relevant - a flat
 * distribution AND a top score below the answerable band. A tightly focused
 * corpus, where every memory is about one subject, can legitimately produce a
 * flat distribution; there the absolute score stays high and results survive.
 *
 * These constants come from n=12 memories on one embedding model. They are a
 * defensible starting point, not a tuned optimum, and should be re-calibrated
 * against a real corpus.
 */

/** Top-result z-score at or above which the set is considered answerable. */
export const RELEVANCE_MIN_Z = 2.1

/** Top score at or above which results are kept regardless of flatness. */
export const RELEVANCE_MIN_TOP = 0.80

/**
 * Below this many scored candidates the Z-SCORE is not meaningful - with one or
 * two rows the standard deviation is zero or dominated by a single point.
 *
 * Note what this does NOT gate: the absolute top score is meaningful at any set
 * size, so it still applies. An earlier version skipped both checks for small
 * sets, which meant a two-memory project had no floor at all — and that is
 * exactly the state a new project is in on day one.
 */
export const RELEVANCE_MIN_CANDIDATES = 5

export interface RelevanceVerdict {
  /** True when the candidate set looks like it actually answers the query. */
  relevant: boolean
  top: number
  mean: number
  z: number
  /** Why the verdict went the way it did - surfaced in diagnostics, never guessed at. */
  reason: 'too-few-candidates' | 'strong-top-score' | 'stands-out' | 'flat-and-low'
}

/**
 * Judge whether a scored candidate set is relevant at all.
 *
 * @param scores similarity scores, any order. Non-finite entries are ignored.
 */
export function judgeRelevance(scores: number[]): RelevanceVerdict {
  const clean = scores.filter((s) => Number.isFinite(s))
  if (clean.length === 0) {
    return { relevant: false, top: 0, mean: 0, z: 0, reason: 'flat-and-low' }
  }

  const top = Math.max(...clean)
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length
  const sd = Math.sqrt(variance)
  // A zero spread means every candidate scored identically; there is no
  // standout by definition, so z is 0 rather than infinite.
  const z = sd > 1e-9 ? (top - mean) / sd : 0

  // Absolute score first, and at any set size: measured answerable queries
  // bottomed out at 0.836 while nothing unanswerable exceeded 0.776, so a top
  // score clearing RELEVANCE_MIN_TOP is sufficient on its own.
  if (top >= RELEVANCE_MIN_TOP) {
    return { relevant: true, top, mean, z, reason: 'strong-top-score' }
  }
  // Rescue for a corpus whose scores all sit low but where one result clearly
  // stands out. Only trustworthy with enough candidates to have a spread.
  if (clean.length >= RELEVANCE_MIN_CANDIDATES && z >= RELEVANCE_MIN_Z) {
    return { relevant: true, top, mean, z, reason: 'stands-out' }
  }
  if (clean.length < RELEVANCE_MIN_CANDIDATES) {
    return { relevant: false, top, mean, z, reason: 'too-few-candidates' }
  }
  return { relevant: false, top, mean, z, reason: 'flat-and-low' }
}
