# SOC 2 Trust Service Criteria — Self-Assessment

> **Disclaimer**: This is a self-assessment, not a third-party SOC 2 Type II audit report. It has not been reviewed or attested by a licensed CPA firm. It is provided for transparency and to assist enterprise customers evaluating Tages. Formal audit engagement is on the roadmap.

**Assessment date**: 2026-04-06
**Scope**: Tages cloud service (tages.dev) — MCP server (`@tages/server`), CLI (`@tages/cli`), dashboard (`apps/dashboard`), and Supabase-hosted data store.

---

## 1. Security (CC6 – CC9)

### CC6.1 — Logical and Physical Access Controls

**Control objective**: Restrict access to data and system resources to authorized users only.

**Implementation**:
- Row-Level Security (RLS) is enabled on all Supabase tables. Each table has per-user/per-project policies ensuring users can only access their own data.
- Granular RBAC was introduced in migration `0031_rbac_write_policies.sql` via the `is_write_authorized(uid, pid)` function: only users with the `owner` or `admin` role in `team_members` (or who are the project owner in `projects.owner_id`) may write to `memories`, `decision_log`, and `architecture_snapshots`. Members have read-only access.
- CLI tokens are never stored in plaintext. `packages/cli/src/auth/token-auth.ts` hashes all tokens with SHA-256 (`createHash('sha256')`) before writing to the `api_tokens` table; validation re-hashes the presented token and compares hashes.
- Token expiry is enforced in `token-auth.ts`: if `expires_at` is set and in the past, the token is rejected and an audit event is emitted.

**Known gaps**:
- No hardware-based MFA enforcement at the Supabase Auth layer (GitHub OAuth is the primary auth mechanism; MFA is controlled by GitHub account settings).
- No IP allowlist controls for admin operations.

**Remediation roadmap**: Evaluate Supabase MFA add-on or require TOTP for admin role escalation. Add IP allowlist option for enterprise self-hosted deployments.

---

### CC6.2 — Authentication and Credential Management

**Control objective**: Authenticate users before granting access; manage credentials securely.

**Implementation**:
- Dashboard users authenticate via GitHub OAuth through Supabase Auth (`apps/dashboard/src/lib/supabase/`). No passwords are stored by Tages.
- CLI tokens are generated with 32 bytes of cryptographic randomness (`randomBytes(32)`) and prefixed with `tages_` for secret scanner detection.
- Token rotation is available via `tages token rotate [--expires-in <days>]`.
- Auth events (login success/failure, token invalid/expired) are written to `auth_audit_log` (migration `0033_auth_audit_log.sql`) with user ID, event type, IP address, and user agent.

**Known gaps**:
- The `auth_audit_log` INSERT policy (`WITH CHECK (true)`) allows any authenticated caller to insert audit rows. Service-role restriction is a planned improvement.
- No automatic session timeout for dashboard sessions beyond Supabase Auth defaults.

**Remediation roadmap**: Restrict `auth_audit_log` inserts to service role only. Configure explicit session lifetime in Supabase Auth dashboard.

---

### CC6.3 — Encryption

**Control objective**: Protect data at rest and in transit using industry-standard encryption.

**Implementation**:
- Data in transit is protected by TLS enforced by Vercel (dashboard/API) and Supabase (database connections). HSTS is set in `apps/dashboard/src/proxy.ts` with `max-age=31536000; includeSubDomains`, preventing protocol downgrade.
- Optional AES-256-GCM field-level encryption is available for memory values: set the `TAGES_ENCRYPTION_KEY` environment variable to enable. This provides encryption at rest for sensitive memory content beyond Supabase's platform-level disk encryption.
- Supabase-managed Postgres volumes use encrypted storage provided by the underlying cloud provider (AWS/GCP depending on region).

**Known gaps**:
- AES-256-GCM field-level encryption is opt-in, not on by default. Cloud-hosted Tages instances currently do not enforce it.
- No key rotation mechanism for `TAGES_ENCRYPTION_KEY` is implemented.

**Remediation roadmap**: Evaluate making field-level encryption the default for cloud. Implement key rotation procedure and document it in `docs/self-hosting.md`.

---

### CC7.1 — Monitoring and Anomaly Detection

**Control objective**: Monitor system activity and detect unauthorized or anomalous behavior.

**Implementation**:
- `auth_audit_log` (migration `0033_auth_audit_log.sql`) captures `login_success`, `login_failed`, `token_invalid`, and `token_expired` events with timestamps, IP, and user agent. Indexed by `(user_id, created_at DESC)` and `(event_type, created_at DESC)` for efficient query.
- Dashboard users can query their own audit history via the RLS `SELECT` policy (`auth.uid() = user_id`).
- Rate limiting in `apps/dashboard/src/proxy.ts` caps `/auth` and `/api` endpoints at 30 requests per minute per IP, with a `Retry-After: 60` header on rejection (HTTP 429).

**Known gaps**:
- No automated alerting on sustained auth failure rates or brute-force patterns (audit log is queryable but not wired to alerting).
- No SIEM integration.
- No log forwarding to external observability platform.

**Remediation roadmap**: Add a Supabase Edge Function or cron job to detect and alert on high `login_failed` / `token_invalid` event rates. Evaluate Datadog or equivalent for log aggregation.

---

### CC8.1 — Change Management

**Control objective**: Control changes to production systems through a defined process.

**Implementation**:
- All schema changes are tracked as sequential numbered migrations (`supabase/migrations/0001` through `0033`). Migrations are committed to the repository and applied through Supabase CLI, providing an auditable history.
- Infrastructure changes (Vercel deployments, Supabase migrations) are gated by GitHub pull request review.

**Known gaps**:
- No formal change management policy document or approval matrix beyond PR review.
- No automated rollback procedure for failed migrations.

**Remediation roadmap**: Document change management process. Add migration dry-run validation to CI pipeline.

---

### CC9.1 — Risk Mitigation

**Control objective**: Identify and mitigate risks from vendors and business disruptions.

**Implementation**:
- Tages relies on Supabase (database, auth) and Vercel (hosting) as primary infrastructure vendors, both of which maintain their own SOC 2 Type II certifications.
- `SECURITY.md` defines a responsible disclosure policy with SLA targets by severity: Critical 7 days, High 30 days, Medium 90 days. Security contact is `security@tages.dev`.
- Input validation on all 30 MCP server tools uses Zod schemas (`packages/server/src/schemas.ts`), rejecting malformed inputs before they reach business logic.
- Request body size is capped at 1 MB in `apps/dashboard/src/proxy.ts` for all non-GET API routes.

**Known gaps**:
- No vendor risk assessment documentation for Supabase or Vercel.
- No business continuity or disaster recovery runbook.

**Remediation roadmap**: Document vendor risk posture. Write a DR runbook covering Supabase backup recovery and Vercel rollback procedures.

---

## 2. Availability (A1)

### A1.1 — Availability Commitments

**Control objective**: Provide system availability consistent with commitments and expectations.

**Implementation**:
- The dashboard and API are hosted on Vercel, which provides managed availability with automatic scaling and global CDN.
- The database is hosted on Supabase, which offers managed Postgres with automated backups.
- The MCP server runs locally on the user's machine via stdio transport and has no cloud availability dependency for core memory operations. A local SQLite cache (`better-sqlite3`) serves queries in under 10ms even when the Supabase sync is unavailable, providing resilience against network interruptions.

**Known gaps**:
- No formal SLA or uptime commitment is published for the cloud service.
- No status page for service availability.

**Remediation roadmap**: Publish a status page (e.g., via Vercel or statuspage.io). Define and publish an uptime SLA for enterprise customers.

---

### A1.2 — Incident Response

**Control objective**: Respond to availability incidents in a timely and organized manner.

**Implementation**:
- `SECURITY.md` defines the disclosure and response process for security incidents, with acknowledgment within 48 hours and severity-tiered patch SLAs.
- Vercel and Supabase each have their own incident response processes for infrastructure-level events.

**Known gaps**:
- No internal incident response runbook beyond the security disclosure process in `SECURITY.md`.
- No on-call rotation or escalation path documented.

**Remediation roadmap**: Write an internal incident response runbook covering both security and availability incidents. Define on-call responsibilities.

---

## 3. Processing Integrity (PI1)

### PI1.1 — Complete and Accurate Processing

**Control objective**: Process data completely, accurately, and in a timely manner.

**Implementation**:
- All 30 MCP tool inputs are validated by Zod schemas in `packages/server/src/schemas.ts` before processing. Schemas enforce field types, minimum lengths, enum membership, and integer bounds (e.g., `RecallSchema` enforces `limit` between 1 and 50).
- Secret and PII detection runs before memory values are persisted: high-severity secrets (e.g., API keys, private keys) are blocked; PII triggers a warning. This is implemented in the server's scan tool path.
- Deduplication logic (`tages dedup`) and conflict resolution (migration `0017_conflict_resolution.sql`) prevent duplicate or conflicting memory entries from corrupting the store.

**Known gaps**:
- No end-to-end processing integrity checksums on stored memory records.
- Secret/PII scanner coverage is not formally documented or tested against a fixed ruleset.

**Remediation roadmap**: Document the secret/PII detection ruleset and coverage. Add integration tests validating that known secret patterns are blocked.

---

## 4. Confidentiality (C1)

### C1.1 — Protection of Confidential Information

**Control objective**: Identify, handle, and protect confidential information throughout its lifecycle.

**Implementation**:
- RLS policies ensure project data is visible only to members of that project. No cross-tenant data leakage is possible through the Supabase query layer for users operating within their own credentials.
- `Content-Security-Policy` in `apps/dashboard/src/proxy.ts` blocks `unsafe-eval` in production and restricts `connect-src` to known origins (`*.supabase.co`, `api.stripe.com`), reducing XSS-based data exfiltration risk.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'` (in CSP) prevent clickjacking attacks that could expose confidential data.
- `Referrer-Policy: strict-origin-when-cross-origin` limits referrer leakage to third-party sites.
- SameSite=Strict cookies (enforced by Supabase Auth) prevent cross-site request forgery.

**Known gaps**:
- Field-level encryption is opt-in; in the default cloud configuration, memory values are stored in plaintext in Postgres (protected only by Supabase platform encryption and RLS).
- No formal data classification scheme to distinguish confidential from non-sensitive records.

**Remediation roadmap**: Evaluate enforcing field-level encryption by default. Define a data classification policy.

---

## 5. Privacy (P1 – P8)

### P1 — Privacy Notice

**Control objective**: Communicate the entity's privacy practices to individuals.

**Implementation**:
- A privacy policy has not yet been published for the Tages cloud service.

**Known gaps**: No formal privacy notice exists.

**Remediation roadmap**: Draft and publish a privacy notice covering data collected, purposes, retention, and user rights before general availability of the cloud service.

---

### P3 — Collection of Personal Information

**Control objective**: Collect personal information only for the purposes identified in the privacy notice.

**Implementation**:
- Tages collects: GitHub OAuth identity (email, username) via Supabase Auth, and IP address / user agent in `auth_audit_log`. No additional PII is solicited during onboarding.
- The PII detection feature in the MCP server warns users before memory content containing personal information is stored.

**Known gaps**:
- Collection purposes are not formally documented in a privacy notice.

**Remediation roadmap**: Document all data collection points and purposes in the privacy notice.

---

### P4 — Use and Retention of Personal Information

**Control objective**: Use and retain personal information only as long as necessary.

**Implementation**:
- Memory archive functionality (`tages archive`) allows users to archive stale memories. The `0028_archive.sql` migration introduces archival state.
- Auth audit log rows have a `created_at` timestamp but no automated expiry or deletion schedule is enforced.

**Known gaps**:
- No automated data retention policy (e.g., TTL on audit logs, automatic deletion of data for churned users).
- No documented retention schedule.

**Remediation roadmap**: Implement a retention policy: e.g., purge `auth_audit_log` rows older than 90 days. Define and document retention periods for all data categories.

---

### P5 — Access to Personal Information

**Control objective**: Provide individuals with access to their personal information for review and correction.

**Implementation**:
- Dashboard users can view and delete their own memories through the memory browser interface.
- Users can read their own `auth_audit_log` entries via the RLS `SELECT` policy.
- `tages forget <key>` allows deletion of specific memory records via the CLI.

**Known gaps**:
- No formal data export ("right to portability") mechanism for all user data.
- No account deletion flow that purges all associated data.

**Remediation roadmap**: Build a data export endpoint returning all user data as JSON/CSV. Implement account deletion that cascade-deletes all user records.

---

### P6 – P8 — Disclosure, Quality, and Monitoring

**Control objective**: Disclose personal information only to authorized parties; maintain data quality; monitor privacy compliance.

**Implementation**:
- No personal information is sold or shared with third parties. Supabase and Vercel are infrastructure processors operating under their own data processing agreements.
- The secret/PII detection feature acts as a quality gate preventing unintentional storage of sensitive third-party PII in memory records.
- `SECURITY.md` provides a channel for individuals to report privacy concerns alongside security vulnerabilities.

**Known gaps**:
- No Data Processing Agreement (DPA) is available for enterprise customers.
- No privacy compliance monitoring or annual review process.

**Remediation roadmap**: Draft a DPA for enterprise customers. Establish an annual privacy review process.

---

## Summary Table

| Trust Service Criterion | Status | Key Evidence |
|---|---|---|
| CC6.1 — Access controls | Implemented | RLS on all tables; RBAC via migration 0031 |
| CC6.2 — Authentication | Implemented | GitHub OAuth; SHA-256 token hashing; token expiry |
| CC6.3 — Encryption | Partial | TLS + HSTS enforced; AES-256-GCM at rest is opt-in |
| CC7.1 — Monitoring | Partial | Auth audit log (migration 0033); no alerting |
| CC8.1 — Change management | Partial | Sequential migrations in source control; no formal policy |
| CC9.1 — Risk mitigation | Partial | Zod validation; rate limiting; SECURITY.md; no DR runbook |
| A1.1 — Availability | Partial | Vercel + Supabase managed; local SQLite fallback; no SLA |
| A1.2 — Incident response | Partial | SECURITY.md SLAs; no internal runbook |
| PI1.1 — Processing integrity | Partial | Zod schemas on all 30 tools; secret/PII detection |
| C1.1 — Confidentiality | Implemented | RLS; CSP; HSTS; SameSite cookies; X-Frame-Options |
| P1 — Privacy notice | Not started | No privacy policy published |
| P3 — Data collection | Partial | Minimal collection; no documented purposes |
| P4 — Data retention | Not started | No automated retention policy |
| P5 — Access rights | Partial | Memory browser + forget; no export or deletion flow |
| P6-P8 — Disclosure/quality | Partial | No DPA; PII detection gate present |
