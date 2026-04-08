# Pen Test Readiness — Tages

Version: 1.0
Last updated: 2026-04-06
Contact: security@tages.ai

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         EXTERNAL CLIENTS                        │
│                                                                 │
│  Browser / User         AI Agent (Claude/Cursor)    CI/CD      │
│       │                        │                      │         │
│       │ HTTPS                  │ stdin/stdout         │ HTTPS   │
└───────┼────────────────────────┼──────────────────────┼─────────┘
        │                        │                      │
        ▼                        ▼                      ▼
┌───────────────┐   ┌────────────────────┐   ┌──────────────────┐
│   Dashboard   │   │    MCP Server      │   │      CLI         │
│  (Next.js 16) │   │  (@tages/server)   │   │    (tages)       │
│  Vercel Edge  │   │  stdio transport   │   │  Node.js binary  │
│               │   │  30 MCP tools      │   │  29 commands     │
│  /app/api/*   │   │  Zod validation    │   │  OAuth + tokens  │
│  /app/auth/*  │   │                    │   │                  │
└───────┬───────┘   └────────┬───────────┘   └────────┬─────────┘
        │                    │                         │
        │ Supabase JS SDK     │ better-sqlite3 (local) │ Supabase JS SDK
        │ (anon key + RLS)    ▼                        │ (anon key + RLS)
        │           ┌─────────────────┐                │
        │           │  SQLite Cache   │                │
        │           │  (local .db)    │◄───────────────┤
        │           │  ~60s sync      │ token validate │
        │           └────────┬────────┘                │
        │                    │ async WAL sync           │
        │                    ▼                         │
        └──────────►┌─────────────────┐◄──────────────┘
                    │ Supabase Postgres│
                    │  (hosted)        │
                    │  RLS enabled     │
                    │  pg_trgm search  │
                    │  pgvector embed  │
                    └─────────────────┘

Optional:
  ┌────────────────┐
  │ Stripe API     │  Payment webhook at /api/stripe/webhook
  │ (external)     │
  └────────────────┘
```

### Component Summary

| Component | Runtime | Transport | Auth Mechanism |
|---|---|---|---|
| Dashboard | Next.js 16, Vercel Edge | HTTPS | Supabase Auth (GitHub OAuth) + session cookies |
| MCP Server | Node.js, local process | stdio | Supabase anon key + CLI API token |
| CLI | Node.js binary, user machine | HTTPS to Supabase | GitHub OAuth (device flow) + API tokens |
| Supabase DB | Postgres, Supabase-hosted | Supabase JS SDK | Row Level Security (RLS) + JWT |

---

## 2. Attack Surface Inventory

### 2.1 Web Application — API Endpoints

All routes are under `apps/dashboard/src/app/`.

#### Authentication Routes

| Route | File | Method | Auth Required | Notes |
|---|---|---|---|---|
| `/auth/login` | `app/auth/login/page.tsx` | GET | No | Renders login page; initiates GitHub OAuth |
| `/auth/callback` | `app/auth/callback/route.ts` | GET | No | OAuth callback; exchanges code for session |
| `/auth/cli` | `app/auth/cli/route.ts` | GET/POST | Session cookie | Generates CLI API tokens; writes to `api_tokens` table |
| `/auth/signout` | `app/auth/signout/route.ts` | POST | Session cookie | Invalidates Supabase session |

#### API Routes

| Route | File | Method | Auth Required | Notes |
|---|---|---|---|---|
| `/api/projects/[slug]/export` | `app/api/projects/[slug]/export/route.ts` | GET | Session cookie | Exports project memory data; slug is URL parameter |
| `/api/stripe/checkout` | `app/api/stripe/checkout/route.ts` | POST | Session cookie | Creates Stripe checkout session |
| `/api/stripe/portal` | `app/api/stripe/portal/route.ts` | POST | Session cookie | Opens Stripe billing portal |
| `/api/stripe/webhook` | `app/api/stripe/webhook/route.ts` | POST | Stripe signature | Receives Stripe events; verifies `stripe-signature` header |

#### Security Headers (via `apps/dashboard/src/lib/supabase/middleware.ts`)

- HSTS enforced
- CSP with no `unsafe-eval` in production
- SameSite=Strict cookies
- Request session refresh on each request

### 2.2 Supabase Direct Database Access

Supabase exposes a REST API and realtime WebSocket at the project URL. Any client with the anon key can send requests; RLS policies are the enforcement boundary.

| Access Vector | Description | Controls |
|---|---|---|
| REST API (`/rest/v1/*`) | Direct table access via PostgREST | RLS policies on all tables; JWT required |
| Realtime WebSocket | Subscribe to row changes | RLS applied at subscription level |
| Supabase Auth API | User registration, password reset, OAuth | Managed by Supabase; GitHub OAuth only |
| Service Role Key | Admin bypass of RLS | Not exposed to client-side code; server-only |
| `api_tokens` table | Stores SHA-256 hashed CLI tokens | RLS; tokens never stored in plaintext |
| `auth_audit_log` table | Auth event log | Append-only pattern; RLS restricts reads |

### 2.3 CLI Token Authentication

File: `packages/cli/src/auth/token-auth.ts`

- Token format: `tages_<32 random bytes as hex>` (65-character string)
- Storage: SHA-256 hash stored in Supabase `api_tokens` table; plaintext shown to user once at generation
- Validation flow: hash lookup → expiry check → `last_used` update
- Expiry: optional `expires_at` per token; enforced at validation time
- Rotation: `tages token rotate [--expires-in <days>]`
- Audit: invalid and expired token attempts logged to `auth_audit_log`

Attack vectors:
- Token theft from config file (typically `~/.tages/config.json` or env var)
- Brute force of token space (65-char hex prefixed string — 256-bit entropy, not feasible)
- Token replay after revocation (no active revocation list beyond deletion from `api_tokens`)
- Timing oracle on token comparison (mitigated: comparison is on stored hash, not plaintext)

### 2.4 MCP Server (stdio Transport)

File: `packages/server/src/index.ts`

The MCP server communicates exclusively over stdio. It is invoked as a child process by the AI host (Claude Code, Cursor, etc.) and is not exposed on any network port under standard operation.

| Tool Category | Tools | Notes |
|---|---|---|
| Memory CRUD | `remember`, `recall`, `forget`, `observe` | Core data operations |
| Context | `context`, `contextual_recall`, `conventions`, `architecture`, `decisions` | Read-heavy |
| Analytics | `session_replay`, `agent_metrics`, `trends` | Query logs |
| Federation | `promote`, `import_federated`, `list_federated`, `resolve_overrides` | Cross-project memory sharing |
| Admin | `archive`, `restore`, `auto_archive`, `dedup`, `consolidate` | Destructive operations |
| Import | `import` | Accepts external data; input sanitized via Zod |

Attack vectors:
- Malicious MCP host injecting crafted JSON to tool inputs (Zod validation is the boundary)
- SQLite cache file manipulation (local filesystem access required)
- WAL file tampering (`-wal.db` file alongside the main cache)
- Memory poisoning via `remember` — storing adversarial content that surfaces in `recall`
- Supabase sync exfiltration (anon key in config file could allow reading other project data if RLS misconfigured)

### 2.5 npm Package Supply Chain

Published packages: `tages` (CLI), `@tages/server` (MCP server), `@tages/shared` (types)

| Vector | Description |
|---|---|
| Dependency confusion | Package names in `@tages/` scope; scoped packages require explicit npm publish rights |
| Compromised dependency | `@modelcontextprotocol/sdk`, `better-sqlite3`, `@supabase/supabase-js` are high-value targets |
| Build pipeline | GitHub Actions builds and publishes; Actions runners are out of scope but the `npm publish` token is in scope |
| Malicious publish | If npm token or GitHub Actions secret is compromised, a backdoored package version could be pushed |

---

## 3. STRIDE Threat Model

### 3.1 Dashboard Web Application

| Attack Surface | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| `/auth/callback` | HIGH | MED | MED | MED | LOW | MED | OAuth state parameter must prevent CSRF; session fixation possible if state not validated |
| `/auth/cli` token issuance | MED | LOW | MED | HIGH | LOW | MED | Token generated here; if session cookie is stolen, attacker can mint CLI tokens |
| `/api/projects/[slug]/export` | MED | LOW | LOW | HIGH | MED | LOW | Slug traversal; must verify ownership via RLS before exporting |
| `/api/stripe/webhook` | MED | HIGH | LOW | LOW | MED | MED | Tampering if `stripe-signature` verification is skipped; replayed webhooks |
| Session cookies | HIGH | MED | LOW | MED | LOW | MED | SameSite=Strict and HSTS help; MITM if HSTS not preloaded |
| CSP headers | LOW | LOW | LOW | HIGH | LOW | LOW | XSS vector if CSP is misconfigured in production |

**Legend**: HIGH/MED/LOW = estimated likelihood/impact of that STRIDE category applying.

### 3.2 Supabase Direct Access

| Attack Surface | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| RLS policies | HIGH | HIGH | LOW | HIGH | LOW | HIGH | Policy misconfiguration is the primary risk; any user could access other users' memories |
| Anon key exposure | MED | LOW | LOW | MED | LOW | MED | Anon key is semi-public; RLS must enforce all access controls |
| Service role key | HIGH | HIGH | LOW | HIGH | LOW | HIGH | Must never be exposed in client or CLI; full RLS bypass |
| `api_tokens` table | HIGH | MED | LOW | HIGH | LOW | HIGH | If RLS allows cross-user reads, tokens (hashed) could be enumerated |

### 3.3 CLI Token Auth

| Attack Surface | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| Token stored in config file | MED | LOW | LOW | HIGH | LOW | HIGH | Plaintext token in `~/.tages/config.json`; local file read = full API access |
| Token transmitted to Supabase | LOW | LOW | LOW | MED | LOW | LOW | HTTPS; token is hashed before DB write but transmitted in full over TLS |
| Token expiry enforcement | MED | LOW | LOW | MED | LOW | MED | Expired token check is at validation time; no server-push revocation |
| `auth_audit_log` integrity | LOW | MED | HIGH | LOW | LOW | LOW | Fire-and-forget inserts could be dropped; non-repudiation is weak |

### 3.4 MCP Server (stdio)

| Attack Surface | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| Tool input injection | MED | HIGH | LOW | MED | LOW | MED | Adversarial JSON through MCP protocol; Zod schemas validate structure but not semantic safety |
| SQLite cache file | MED | HIGH | LOW | HIGH | MED | MED | Local file; attacker with filesystem access can read or tamper; no encryption at rest by default |
| Memory poisoning | MED | HIGH | LOW | HIGH | LOW | LOW | `remember` stores arbitrary strings; stored XSS or prompt injection in recalled values |
| Supabase sync | LOW | MED | LOW | MED | MED | LOW | Sync uses anon key; compromised key could allow writes to DB if RLS has gaps |
| WAL file | LOW | HIGH | LOW | HIGH | LOW | LOW | Unencrypted WAL beside the cache DB; contains recent write operations |

### 3.5 npm Supply Chain

| Attack Surface | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| Compromised dependency | HIGH | HIGH | LOW | HIGH | LOW | HIGH | A backdoored `@modelcontextprotocol/sdk` or `better-sqlite3` would run in MCP server context |
| npm publish token | HIGH | HIGH | LOW | HIGH | LOW | HIGH | Allows publishing a new package version; affects all downstream users |
| Typosquatting | HIGH | LOW | LOW | LOW | LOW | MED | `tages` is a short name; typos (`tagees`, `teges`) could be registered |

---

## 4. In-Scope / Out-of-Scope

Consistent with `SECURITY.md`.

### In Scope

- Cloud dashboard at `tages.ai` (Next.js on Vercel)
- API routes under `/api/*` and auth routes under `/auth/*`
- MCP server (`@tages/server` npm package, stdio transport)
- CLI (`tages` npm package, all subcommands)
- Supabase schema and RLS policies (tages-owned configuration, not Supabase infrastructure)
- npm packages published under the `@tages` organization
- Token authentication flow (generation, validation, rotation, expiry)
- AES-256-GCM optional field encryption (`TAGES_ENCRYPTION_KEY` path)

### Out of Scope

- Supabase-managed infrastructure (database servers, Auth service internals) — report to [Supabase](https://supabase.com/security)
- GitHub Actions runners and GitHub-managed infrastructure
- Stripe infrastructure (report to Stripe)
- A user's own local machine or self-hosted deployment
- Vulnerabilities in third-party dependencies — report upstream; notify Tages only if the vulnerability is uniquely exploitable in the Tages context
- Social engineering of Tages staff or users
- Denial-of-service testing against production endpoints

---

## 5. Testing Constraints

### Hard Rules

1. **No production data access.** All testing must use dedicated test accounts and a separate Supabase project. Do not access, read, modify, or exfiltrate data belonging to other users.
2. **No denial-of-service.** Do not send traffic volumes intended to degrade service availability. Rate-limit probing is acceptable with prior coordination.
3. **Coordinate before active exploitation.** Report intent to `security@tages.ai` before attempting to exploit RLS bypasses, token forgery, or Stripe webhook manipulation.
4. **No production Stripe operations.** Use Stripe test mode keys only. Do not trigger real payment events.
5. **Scope creep stops at Supabase infrastructure.** If an attack path leads through Supabase-managed infrastructure, stop and report — do not pursue.

### Coordination

- Initial contact: `security@tages.ai`
- GitHub Security Advisories: [private report](https://github.com/ryantlee25-droid/tages/security/advisories/new)
- Acknowledgment SLA: 48 hours
- Fix SLA: Critical 7 days, High 30 days, Medium 90 days

### Reporting Format

Include in each finding:
- Affected component and file path
- STRIDE category
- Steps to reproduce
- Evidence (screenshots, HTTP traces, tool output)
- Suggested remediation

---

## 6. Test Account Provisioning

### 6.1 Supabase Test Project

1. Create a new Supabase project (free tier) at [supabase.com](https://supabase.com)
2. Run all migrations from `supabase/migrations/` against the test project:
   ```bash
   # Using Supabase CLI
   supabase db push --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
   ```
3. Note your test project `URL` and `anon key` from Project Settings > API

### 6.2 Dashboard Test Account

1. Visit the test deployment or `localhost:3000` (see step 6.4 for local setup)
2. Sign in with a dedicated GitHub test account (create one at github.com)
3. The OAuth callback will create a Supabase user record automatically
4. Create a test project via the dashboard UI (Project list > New Project)

### 6.3 CLI Test Configuration

```bash
# Install the CLI
npm install -g @tages/cli

# Initialize with your test Supabase project
tages init \
  --supabase-url "https://<test-project-ref>.supabase.co" \
  --supabase-key "<test-anon-key>" \
  --project-id "<test-project-slug>"

# Generate a test CLI token
# 1. Open dashboard at localhost:3000 (or tages.ai test account)
# 2. Navigate to Settings > API Tokens > Generate Token
# 3. Copy the token (shown only once)

# Set the token in CLI config
tages config set token tages_<your-test-token>

# Verify connectivity
tages status
```

Config file location: `~/.tages/config.json` (contains plaintext token — treat as a credential)

### 6.4 Local Dashboard Development Setup

```bash
# Clone and install
git clone https://github.com/ryantlee25-droid/tages
cd tages
pnpm install

# Create environment file
cp apps/dashboard/.env.example apps/dashboard/.env.local
# Edit .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=https://<test-ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<test-anon-key>
#   STRIPE_SECRET_KEY=sk_test_...  (Stripe test mode key)
#   STRIPE_WEBHOOK_SECRET=whsec_... (from `stripe listen` output)

# Start the dashboard
pnpm dev
# Dashboard available at http://localhost:3000
```

### 6.5 MCP Server Test Setup

```bash
# The MCP server runs as a child process of the AI host.
# For manual testing, invoke it directly:
node packages/server/dist/index.js

# It expects config at:
#   ~/.tages/config.json  (or TAGES_CONFIG_PATH env var)
# With fields: supabaseUrl, supabaseAnonKey, projectId, cachePath

# To test with a real MCP client:
# Add to Claude Code settings (~/Library/Application Support/Claude/claude_desktop_config.json):
{
  "mcpServers": {
    "tages-test": {
      "command": "node",
      "args": ["/path/to/tages/packages/server/dist/index.js"],
      "env": {
        "TAGES_SUPABASE_URL": "https://<test-ref>.supabase.co",
        "TAGES_SUPABASE_KEY": "<test-anon-key>",
        "TAGES_PROJECT_ID": "test-project"
      }
    }
  }
}
```

### 6.6 Optional: Encryption Testing

To test the AES-256-GCM field encryption path:
```bash
# Generate a 256-bit key (32 bytes, base64-encoded)
openssl rand -base64 32

# Set in MCP server env or CLI config:
TAGES_ENCRYPTION_KEY=<base64-key>
```

### 6.7 Stripe Webhook Testing

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward events to local dashboard
stripe listen --forward-to localhost:3000/api/stripe/webhook

# The CLI outputs a webhook signing secret (whsec_...)
# Set STRIPE_WEBHOOK_SECRET in apps/dashboard/.env.local
```

---

## 7. Known Security Controls Summary

For reference during testing — these are the controls a pen tester should attempt to bypass:

| Control | Implementation | Location |
|---|---|---|
| RBAC | Owner/admin write, member read-only | Migration `0031_rbac.sql`; RLS policies |
| RLS | Per-user/per-project row policies | All Supabase tables; `supabase/migrations/` |
| Token hashing | SHA-256 before DB storage | `packages/cli/src/auth/token-auth.ts` |
| Token expiry | `expires_at` check at validation | `packages/cli/src/auth/token-auth.ts:42` |
| Input validation | Zod schemas on all 30 MCP tools | `packages/server/src/schemas.ts` |
| Request size limit | 1MB max | Dashboard Next.js config |
| Secret/PII detection | Blocks high-severity secrets before storage | MCP server `remember` tool |
| CSP | No `unsafe-eval` in production | `apps/dashboard/src/lib/supabase/middleware.ts` |
| HSTS | Enforced via middleware | `apps/dashboard/src/lib/supabase/middleware.ts` |
| SameSite cookies | `SameSite=Strict` | Supabase Auth session config |
| Audit logging | Auth events → `auth_audit_log` table | `packages/cli/src/auth/token-auth.ts`, `apps/dashboard/src/app/auth/cli/route.ts` |
| Encryption at rest | AES-256-GCM (opt-in, memory values) | MCP server, `TAGES_ENCRYPTION_KEY` env var |
| Stripe signature | `stripe-signature` header verification | `apps/dashboard/src/app/api/stripe/webhook/route.ts` |
