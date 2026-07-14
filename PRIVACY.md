# Privacy Policy

**Effective date:** April 10, 2026
**Last updated:** April 10, 2026

Tages is an open-source tool that gives AI coding agents persistent memory about your codebase. This policy explains exactly what data Tages collects, where it goes, and what we do with it.

The short version: **we store your memories on your behalf. We do not train AI models on your data. We do not sell your data. In local-only mode, nothing leaves your machine.**

---

## 1. Two Modes, Two Data Stories

Tages operates in two modes. Which one you choose determines what data leaves your machine.

| | Local-Only Mode | Cloud Mode |
|---|---|---|
| **Activated by** | `tages init --local` | `tages init` (default) |
| **Storage** | SQLite on your machine | SQLite cache + Supabase Postgres (US) |
| **Authentication** | None required | GitHub OAuth via Supabase |
| **Data sent to cloud** | Nothing | Memories, project metadata, auth profile |
| **Account required** | No | Yes (GitHub) |

If you use local-only mode, the rest of this policy largely does not apply to you. Your data stays on your filesystem. We have no access to it.

---

## 2. Data We Collect

### All users (local and cloud)

- **Nothing by default.** Tages does not phone home, send telemetry, or collect analytics unless you opt in.

### Cloud mode only

When you authenticate and sync to the cloud, we store:

- **Codebase memories** — key/value pairs you create via `remember`, with category (convention, architecture, decision, gotcha), context string, and timestamps
- **Project metadata** — project name, project UUID, creation date
- **Authentication profile** — GitHub username, email address, and avatar URL (received from GitHub OAuth). We do not request access to your repositories.
- **Usage metadata** — memory counts, tool invocation counts, sync timestamps
- **Auth tokens** — stored as SHA-256 hashes only. We never store plaintext tokens.

### What we do NOT collect

- Your source code
- Your repository contents
- Your file system structure
- Telemetry or analytics (unless you explicitly opt in)

**Exception:** if you explicitly opt in to the Instrumented Harness described below, we collect a redacted record of your AI coding agent's tool-call activity. We do not collect general IDE or editor activity, and we collect nothing from the harness until you take the affirmative step of enabling it yourself.

### The Instrumented Harness (opt-in, off by default)

Tages offers an optional, **per-developer opt-in** capture path for Claude Code. It is off by default and is never turned on for you or your team automatically — each developer who wants it runs `tages harness enable` on their own machine. Enabling it is a personal choice, not a team-wide or admin-forced setting.

If you enable it:

- **What's captured:** the tool name your AI coding agent invokes (Read, Edit, Bash, etc.), redacted arguments and file paths, exit codes where available, durations where they can be derived, timestamps, your session id, and your agent id.
- **What's redacted:** secrets and PII are stripped out of the captured data **before anything is written to disk or synced anywhere**. Raw, unredacted tool-call payloads never leave your machine — the redaction happens locally, first.
- **Local vs. synced:** capture always writes to a local SQLite log on your machine first. Nothing is uploaded automatically. A batch `sync` command you run (or trigger) uploads the already-redacted records to your own project.
- **Where the config lives:** enabling the harness writes hook configuration to your own `.claude/settings.local.json` — a file that is gitignored by convention and personal to you, not a shared or committed project file. It is never pushed to your team.
- **Retention:** synced records are retained for **90 days** on our servers, then deleted. Your local cache is retained until you clear it yourself (delete the file or run the harness's disable/clear step).

You can disable the harness and stop capture at any time by running `tages harness disable`.

**Known limitation: redaction is pattern-based, not entropy-based.** Our redaction logic recognizes secrets by matching known patterns, and for several categories — generic API keys, passwords, tokens, and AWS secret access keys — it looks for the value to appear next to a marker word (like `api_key=`, `password:`, or `secret_access_key`). A bare high-entropy secret pasted into a tool call with no adjacent marker word can be indistinguishable from an ordinary hash or base64 blob, and may not be caught. This is a known, disclosed gap, not a hidden one: entropy-based detection (to catch markerless secrets) is a future improvement we have not yet built. Until it ships, treat harness redaction as best-effort rather than a guarantee, and avoid pasting raw secrets, credentials, or tokens directly into your AI coding agent's tool calls on any machine where the harness is enabled — the same caution you'd apply to shell history or a terminal log.

---

## 3. How Data Is Stored

**Local storage:** SQLite database in `.tages/` within your project directory. You control this file entirely — delete it anytime.

**Cloud storage:** Supabase Postgres hosted in the United States (AWS us-east-1). Supabase encrypts data at rest and in transit. See [Supabase's security practices](https://supabase.com/security).

**Optional encryption:** Set `TAGES_ENCRYPTION_KEY` to enable AES-256-GCM field-level encryption on memory values before they leave your machine. When enabled, we cannot read your memory contents on the server.

**Row-level security:** Every Supabase table has RLS policies. Users can only access their own data. Project members are scoped by RBAC role (owner, admin, member).

---

## 4. Your Code and Intellectual Property

**We do not train AI models on your data.** Not now, not in the future, not with anonymization, not with aggregation. Your memories are yours.

**You retain all intellectual property** in the memories you store. Tages acts as a **data processor** — we store data on your behalf and return it when you ask. We are not a data controller over your codebase context.

**We do not access your memories** except to provide the service (storage, sync, search). No Tages employee will read your memory contents unless you explicitly share them with us for debugging purposes.

---

## 5. Third-Party Services

Tages uses two third-party services in cloud mode:

| Service | Purpose | Data shared | Their privacy policy |
|---|---|---|---|
| **Supabase** | Authentication, database, storage | Auth profile, memories, project metadata | [supabase.com/privacy](https://supabase.com/privacy) |
| **GitHub** | OAuth identity provider | OAuth token exchange only — we request `user:email` scope | [docs.github.com/en/site-policy/privacy-policies](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |

We do not use any advertising services, analytics platforms, or data brokers.

---

## 6. Data Retention and Deletion

**Local data:** Entirely under your control. Delete `.tages/` or run `tages forget` to remove memories.

**Cloud data:**
- Run `tages forget --key <key>` to delete specific memories
- Run `tages forget --all` to delete all memories for a project
- Delete your account to remove all data associated with your user ID
- After deletion, data is removed from the active database immediately. Supabase database backups are retained for up to 7 days, after which deleted data is permanently gone.

**Auth tokens:** Revocable via `tages token rotate`. Old token hashes are deleted on rotation.

**Account deletion:** Email contact@tages.ai to request full account deletion. We will process requests within 30 days.

---

## 7. Your Rights

### GDPR (EU/EEA/UK residents)

You have the right to:
- **Access** your personal data — export via `tages recall` or the dashboard
- **Rectify** inaccurate data — update memories via `tages remember`
- **Erase** your data — `tages forget --all` or request account deletion
- **Port** your data — export via CLI or dashboard in JSON format
- **Object** to processing — switch to local-only mode or delete your account

To exercise these rights, email contact@tages.ai. We respond within 30 days.

### CCPA (California residents)

You have the right to:
- **Know** what personal information we collect (this document)
- **Delete** your personal information (see Section 6)
- **Opt out** of the sale of personal information — we do not sell personal information, period

---

## 8. Open-Source Considerations

Tages is MIT licensed. The source code is publicly auditable at [github.com/ryantlee25-droid/tages](https://github.com/ryantlee25-droid/tages).

**Local-only mode is a complete zero-data option.** You can use Tages without creating an account, without connecting to the internet, and without sharing any data with us or anyone else.

**No telemetry by default.** We do not collect usage analytics, crash reports, or behavioral data unless you explicitly opt in to a future telemetry program (which does not currently exist).

**Self-hosting:** You can run the entire stack yourself (MCP server + CLI + Supabase instance). In that configuration, no data touches our infrastructure.

---

## 9. Security

We take security seriously. Highlights:

- AES-256-GCM optional field-level encryption
- SHA-256 token hashing (no plaintext storage)
- Row-level security on all database tables
- RBAC with owner/admin/member roles
- HTTPS/TLS for all cloud communication
- Zod input validation on all 56 MCP tools
- Secret and PII detection before storage

For full details, responsible disclosure process, and security contact, see [SECURITY.md](SECURITY.md).

---

## 10. Children

Tages is a developer tool. It is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, contact us at contact@tages.ai and we will delete it.

---

## 11. Changes to This Policy

We will update this policy as Tages evolves. For material changes (new data collection, new third parties, changes to IP commitments), we will:

- Update this document with a new "Last updated" date
- Note the change in the repository changelog
- Provide at least 30 days notice before material changes take effect

---

## 12. Contact

For privacy questions, data requests, or account deletion:

- **Email:** contact@tages.ai
- **GitHub:** [github.com/ryantlee25-droid/tages/issues](https://github.com/ryantlee25-droid/tages/issues)

For security issues, see [SECURITY.md](SECURITY.md).
