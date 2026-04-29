# Memory Provenance Model

_Status: Shipped in migration 0057 (2026-04-20). Referenced by `/governance` marketing page and the forthcoming `tages drift` command._

Tages records full provenance for every memory write so teams can answer four questions at any time:

1. **Who** wrote this memory?
2. **Which agent session** wrote it?
3. **Which MCP tool** wrote it?
4. **What source artifact** (file, PR, commit, ticket) did the memory come from?

Provenance is non-lossy. Memories created before migration 0057 have null provenance fields; every write from 2026-04-20 onwards captures the full record.

## Fields

Stored on the `memories` table. All are nullable for backwards compatibility.

| Field | Column | Type | Source |
|---|---|---|---|
| User ID | `updated_by`, `created_by` | `uuid` → `auth.users(id)` | Migration 0048 |
| Agent name | `agent_name` | `text` | Migration 0001 |
| Agent session | `session_id` | `uuid` → `agent_sessions(id)` | **Migration 0057** |
| MCP tool | `tool_name` | `text` | **Migration 0057** |
| Source context | `source_context` | `jsonb` | **Migration 0057** |
| Created at | `created_at` | `timestamptz` (immutable) | Migration 0001 |
| Updated at | `updated_at` | `timestamptz` (mutable) | Migration 0001 |

### `agent_name`

Logical agent identifier. Free-form text, but Tages server code normalizes these values to a known set:

- `claude-code`
- `cursor`
- `codex`
- `gemini-cli`
- `cli` (direct `tages` command invocation)
- `dashboard` (write through the web UI)
- `auto-indexer` (git-hook extraction)
- `import` (bulk import commands)

### `session_id`

Foreign key to `agent_sessions.id`. `agent_sessions` is the existing tracking table (migration 0005) that records per-session counters: `memories_recalled`, `memories_stored`, `recall_hits`, `recall_misses`, and session start/end timestamps.

Memories written outside an explicit session (e.g. a one-shot CLI `tages remember ...`) may have `session_id = null`. Every MCP server session establishes an `agent_sessions` row on connect; subsequent tool calls during that connection all carry the same `session_id`.

### `tool_name`

The MCP tool or CLI command that wrote the memory. Examples:

- `remember` — explicit user-intent write
- `observe` — draft-memory queue write
- `import` / `import_claude_md` / `import_memories` — bulk imports
- `sharpen` — quality-pass rewrite (provenance preserved from original on update)
- `auto_archive` — background promotion
- `federate_memory` — federation write with origin-project source reference

### `source_context`

Flexible JSONB blob. Well-known keys (consumed by the dashboard and audit export):

```json
{
  "filePath": "packages/server/src/tools/remember.ts",
  "prNumber": 312,
  "commitSha": "a1b2c3d4",
  "ticketId": "TAGES-142",
  "url": "https://github.com/ryantlee25-droid/tages/pull/312"
}
```

Tool-specific metadata that does not fit the well-known keys goes under `extra`:

```json
{
  "filePath": "docs/rbac.md",
  "extra": { "section": "## Role hierarchy", "line": 42 }
}
```

GIN-indexed for containment queries, so `select ... where source_context @> '{"prNumber": 312}'` is fast.

## Write contract

Every MCP tool and CLI command that writes to `memories` MUST populate:

- `tool_name` — the exact tool/command name.
- `agent_name` — resolved from the request context.
- `session_id` — from the active `agent_sessions` row; null only when no session exists.
- `updated_by` — the `auth.users.id` of the authenticated caller; null only for anonymous local-cache writes.
- `source_context` — populated whenever the originating artifact is known (always for `observe`, `auto-indexer`, and `federate_memory`; best-effort for `remember` when the agent provides a file reference).

Tools that do not currently populate these fields are tracked as backlog items (see `eval/provenance-coverage.md`, to be written in Phase 2.5 completion). The Governance tier gates strict-provenance enforcement: at Governance tier, writes with incomplete provenance are rejected with a clear error.

## Read surface

Three ways to read provenance:

1. **MCP `recall` tool** — response includes `sessionId`, `toolName`, `sourceContext`, `agentName`, `createdBy`, `updatedBy` when `includeProvenance: true` is set on the request.
2. **CLI `tages recall --show-provenance`** — prints a compact provenance line under each memory.
3. **SQL RPC `get_memory_provenance(memory_id uuid)`** — dashboard and audit consumers.

## Audit log (separate from provenance)

Provenance is the origin record of a memory. The **audit log** records every read, write, update, delete, and export on that memory. Provenance lives on the `memories` row; audit events live in append-only audit tables (referenced by `/governance` marketing page and formalized separately in Phase 3.5).

## RLS

Provenance columns inherit the project-membership RLS policies that already protect `memories`. A user who cannot see the memory cannot see its provenance. `get_memory_provenance` is a `security definer` function that enforces the same project-membership check as the base row read.

## Why this matters

Mainstream agent memory frameworks do not track where a memory came from or how it was transformed. Audit-traceable AI reasoning requires lineage; Tages provenance provides it as a first-class table citizen rather than an add-on. Every downstream feature — drift detection, federation, audit export, erasure certificates, SOC 2 evidence — reads from this surface.

## Migration history

- **0001** — initial schema; `memories.agent_name`.
- **0005** — `agent_sessions`, `memory_access_log`; read-path tracking.
- **0048** — `memories.created_by`, `memories.updated_by`; user authorship.
- **0057** — `memories.session_id`, `memories.source_context`, `memories.tool_name`; full write provenance.
- **Planned:** audit log tamper-evidence via row-level hash chain (Governance tier).
