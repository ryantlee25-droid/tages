/**
 * Detects potential secrets, API keys, and PII in memory values.
 * Returns warnings but does not block storage — the user decides.
 *
 * Implementation lives in @tages/shared (packages/shared/src/safety.ts) so it
 * can be reused by non-server consumers (e.g. @tages/harness-claude-code).
 * Re-exported here unchanged so existing importers (remember.ts, observe.ts)
 * need zero call-site changes.
 */
export {
  scanForSensitiveData,
  hasHighSeverity,
  formatSafetyWarnings,
  redactSensitiveData,
} from '@tages/shared'
export type { SafetyWarning } from '@tages/shared'
