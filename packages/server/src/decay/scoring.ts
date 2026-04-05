/**
 * Confidence Decay & Auto-Archive Scoring
 *
 * Computes a staleness score (0–1) based on time since last update,
 * time since last access, and access frequency. Higher score = more stale.
 */
import type { Memory } from '@tages/shared'

export interface DecayConfig {
  // How many days before a memory starts decaying (default: 30)
  gracePeriodDays?: number
  // Half-life in days — score reaches 0.5 at this age (default: 90)
  halfLifeDays?: number
  // Access frequency that fully prevents decay (default: 10 accesses)
  maxAccessCount?: number
  // Weight of access frequency in score reduction (0–1, default: 0.4)
  accessWeight?: number
  // Per-type decay rate multipliers (default: 1.0 for all)
  typeRates?: Partial<Record<Memory['type'], number>>
}

export interface AccessLog {
  lastAccessedAt?: string | null
  accessCount?: number
}

const DEFAULTS: Required<DecayConfig> = {
  gracePeriodDays: 30,
  halfLifeDays: 90,
  maxAccessCount: 10,
  accessWeight: 0.4,
  typeRates: {
    convention: 0.7,   // conventions decay slowly
    decision: 0.8,     // decisions decay slowly
    architecture: 0.6, // architecture is relatively stable
    entity: 1.0,
    lesson: 0.9,
    preference: 1.2,   // preferences change faster
    pattern: 0.8,
    execution: 1.1,
  },
}

/**
 * Compute a decay score (0–1) for a memory.
 * 0 = fresh (keep), 1 = fully stale (archive candidate).
 */
export function computeDecayScore(
  memory: Memory,
  accessLog: AccessLog,
  config: DecayConfig = {},
  now: Date = new Date(),
): number {
  const cfg = { ...DEFAULTS, ...config }
  const typeRates = { ...DEFAULTS.typeRates, ...(config.typeRates || {}) }
  const typeRate = (typeRates as Record<string, number>)[memory.type] ?? 1.0

  // Use last accessed or last updated as the "freshness" timestamp
  const lastActiveStr = accessLog.lastAccessedAt || memory.updatedAt
  const lastActive = new Date(lastActiveStr).getTime()
  const ageMs = now.getTime() - lastActive
  const ageDays = ageMs / (24 * 60 * 60 * 1000)

  // Within grace period: no decay
  if (ageDays <= cfg.gracePeriodDays) return 0

  // Exponential decay: score = 1 - 2^(-(age-grace)/halfLife)
  const effectiveAge = ageDays - cfg.gracePeriodDays
  const rawDecay = 1 - Math.pow(2, -effectiveAge / cfg.halfLifeDays)

  // Access frequency reduces decay
  const accessCount = accessLog.accessCount ?? 0
  const accessFactor = Math.min(accessCount / cfg.maxAccessCount, 1)
  const accessReduction = accessFactor * cfg.accessWeight

  // Apply type-specific rate
  const score = rawDecay * typeRate * (1 - accessReduction)

  return Math.max(0, Math.min(1, score))
}

/**
 * Determine if a memory should be archived based on its decay score.
 */
export function shouldArchive(score: number, threshold = 0.8): boolean {
  return score >= threshold
}

/**
 * Get type-specific decay rate.
 */
export function getTypeDecayRate(type: Memory['type'], config: DecayConfig = {}): number {
  const typeRates = { ...DEFAULTS.typeRates, ...(config.typeRates || {}) }
  return (typeRates as Record<string, number>)[type] ?? 1.0
}
