-- Instrumented harness: richer per-tool-call event stream ingested from
-- Claude Code hooks (PreToolUse/PostToolUse/SessionEnd/Stop), captured
-- locally, secret-redacted, and batch-synced by `tages harness sync`.
--
-- This table is deliberately separate from `tool_call_log` (0030_analytics.sql)
-- rather than an extension of it -- see PLAN-INSTRUMENTED-HARNESS.md Task 1 /
-- Decision 2. `computeBehavioralDrift` is source-agnostic (consumes
-- ToolCallRow projections), so the two tables are merged at query time in
-- `packages/cli/src/commands/drift.ts` (Milestone 2), not at the schema level.
--
-- RLS policy below is copied VERBATIM from `tool_call_log_access` in
-- 0030_analytics.sql, substituting only the table name. Do not reimplement
-- via a helper function and do not paraphrase either branch -- a dropped
-- OR-branch in a copied RLS policy previously cost 12h of broken owner
-- access (see memory: feedback_rls_function_diff / the 0051 RBAC hardening
-- regression). Both the owner_id branch and the team_members branch must be
-- present exactly as they are in tool_call_log_access.
--
-- MANUAL RLS SMOKE TEST (no automated pgTAP harness in this repo -- run
-- these psql steps by hand against a linked/staging project before merging,
-- matching the "smoke-test as real user" lesson from the 0051 regression):
--
--   -- Setup: two distinct auth users (owner_a, stranger_b) and one project
--   -- owned by owner_a, e.g. via the dashboard or:
--   --   insert into projects (id, owner_id, name, slug) values
--   --     ('11111111-1111-1111-1111-111111111111', '<owner_a-uid>', 'Smoke Test', 'smoke-test');
--   --   insert into harness_tool_events (project_id, session_id, tool_name, source)
--   --     values ('11111111-1111-1111-1111-111111111111', 'sess-1', 'Read', 'claude_code_hook');
--
--   -- 1. As owner_a (owner_id branch), confirm the row is visible:
--   set role authenticated;
--   set request.jwt.claims = '{"sub": "<owner_a-uid>"}';
--   select count(*) from harness_tool_events
--     where project_id = '11111111-1111-1111-1111-111111111111';
--   -- expect: 1
--
--   -- 2. As stranger_b (no owner_id/team_members row), confirm isolation:
--   set request.jwt.claims = '{"sub": "<stranger_b-uid>"}';
--   select count(*) from harness_tool_events
--     where project_id = '11111111-1111-1111-1111-111111111111';
--   -- expect: 0
--
--   -- 3. Add stranger_b to team_members for the project (team_members branch):
--   reset role;
--   insert into team_members (project_id, user_id) values
--     ('11111111-1111-1111-1111-111111111111', '<stranger_b-uid>');
--   set role authenticated;
--   set request.jwt.claims = '{"sub": "<stranger_b-uid>"}';
--   select count(*) from harness_tool_events
--     where project_id = '11111111-1111-1111-1111-111111111111';
--   -- expect: 1 (team_members branch now grants access)
--
--   -- 4. Cleanup: reset role; delete the smoke-test rows/project/team_members entry.

CREATE TABLE IF NOT EXISTS harness_tool_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  agent_name TEXT,
  source TEXT,
  tool_name TEXT,
  event_type TEXT,
  exit_code INTEGER,
  file_path TEXT,
  duration_ms INTEGER,
  args_scrubbed JSONB,
  result_summary TEXT,
  secrets_redacted_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_tool_events_project ON harness_tool_events(project_id);
CREATE INDEX IF NOT EXISTS idx_harness_tool_events_session ON harness_tool_events(session_id);
CREATE INDEX IF NOT EXISTS idx_harness_tool_events_agent ON harness_tool_events(project_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_harness_tool_events_created ON harness_tool_events(project_id, created_at DESC);
-- Supports the drift-merge query pattern (Milestone 2, Task 5): fetch a
-- project's events for a given agent ordered by time.
CREATE INDEX IF NOT EXISTS idx_harness_tool_events_project_agent_created ON harness_tool_events(project_id, agent_name, created_at);

ALTER TABLE harness_tool_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "harness_tool_events_access" ON harness_tool_events
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects WHERE owner_id = auth.uid()
      UNION
      SELECT project_id FROM team_members WHERE user_id = auth.uid()
    )
  );
