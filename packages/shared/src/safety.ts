/**
 * Detects potential secrets, API keys, and PII in text values, and can redact
 * them before the text is persisted anywhere (disk, local cache, or remote sync).
 *
 * `scanForSensitiveData` / `hasHighSeverity` / `formatSafetyWarnings` only warn —
 * they leave the original text untouched, matching Tages' existing "warn on
 * write, let the user decide" behavior for `remember`/`observe`.
 *
 * `redactSensitiveData` actually replaces each matched span with a
 * `[REDACTED:<name>]` marker. This is required by the instrumented harness
 * (`@tages/harness-claude-code`), which must never let raw secrets touch the
 * local SQLite log or the Supabase sync path — redact-before-persist, not
 * warn-after-the-fact.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS secret key', pattern: /[0-9a-zA-Z/+]{40}/ },
  { name: 'GitHub token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/ },
  { name: 'GitHub OAuth', pattern: /gho_[A-Za-z0-9_]{36,}/ },
  { name: 'Slack token', pattern: /xox[baprs]-[0-9a-zA-Z-]+/ },
  { name: 'Stripe key', pattern: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/ },
  { name: 'Anthropic key', pattern: /sk-ant-[0-9a-zA-Z-]{20,}/ },
  { name: 'OpenAI key', pattern: /sk-[0-9a-zA-Z]{20,}/ },
  { name: 'Supabase key', pattern: /sbp_[0-9a-f]{40}/ },
  { name: 'Generic API key', pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}/i },
  { name: 'Bearer token', pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/ },
  { name: 'Password field', pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{4,}/i },
  { name: 'Connection string', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+:[^\s]+@/i },
  { name: 'Private key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
]

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Email address', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  { name: 'Phone number', pattern: /(?:\+1|1)?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/ },
  { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'Credit card', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/ },
  { name: 'IP address', pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/ },
]

// Redaction runs over both secrets and PII — the harness's privacy commitment
// covers "secrets/PII" as one bucket (see PRIVACY.md's instrumented-harness
// section), so redaction should too, not just the high-severity secret set.
const ALL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [...SECRET_PATTERNS, ...PII_PATTERNS]

export interface SafetyWarning {
  type: 'secret' | 'pii'
  name: string
  severity: 'high' | 'medium'
}

export function scanForSensitiveData(text: string): SafetyWarning[] {
  const warnings: SafetyWarning[] = []

  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push({ type: 'secret', name, severity: 'high' })
    }
  }

  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(text)) {
      warnings.push({ type: 'pii', name, severity: 'medium' })
    }
  }

  return warnings
}

export function hasHighSeverity(warnings: SafetyWarning[]): boolean {
  return warnings.some(w => w.severity === 'high')
}

export function formatSafetyWarnings(warnings: SafetyWarning[]): string {
  if (warnings.length === 0) return ''

  const lines = warnings.map(w => {
    const icon = w.severity === 'high' ? '🚫' : '⚡'
    return `${icon} Detected ${w.type}: ${w.name}`
  })

  if (hasHighSeverity(warnings)) {
    return `\n\nBlocked — secrets detected:\n${lines.join('\n')}\nRemove secrets from the value before storing. Use --force to override.`
  }

  return `\n\nSafety warnings:\n${lines.join('\n')}\nThe memory was stored, but consider removing sensitive data.`
}

/**
 * Replaces every matched secret/PII span in `text` with a `[REDACTED:<name>]`
 * marker and returns the redacted text plus how many spans were replaced.
 *
 * Unlike `scanForSensitiveData`, this actually mutates the text — callers that
 * persist data anywhere (local SQLite log, Supabase sync, etc.) must run this
 * BEFORE the write, not rely on the warning-only scan.
 */
export function redactSensitiveData(text: string): { redacted: string; count: number } {
  let redacted = text
  let count = 0

  for (const { name, pattern } of ALL_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const globalPattern = new RegExp(pattern.source, flags)
    redacted = redacted.replace(globalPattern, () => {
      count++
      return `[REDACTED:${name}]`
    })
  }

  return { redacted, count }
}
