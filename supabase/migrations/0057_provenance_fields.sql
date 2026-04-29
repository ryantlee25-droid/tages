-- ============================================================
-- Tages — Memory Provenance Fields
-- Adds session_id, source_context, tool_name columns to memories
-- so every memory write can be traced to the agent session,
-- source artifact (file/PR/commit), and MCP tool that created it.
--
-- Ref: analysis/positioning.md Bet A, deep-research-execution-2026-04.md Q1/Finding 2
-- ============================================================

-- 1. Add provenance columns to memories (nullable — no backfill for historical rows)
alter table memories
  add column if not exists session_id uuid references agent_sessions(id) on delete set null,
  add column if not exists source_context jsonb,
  add column if not exists tool_name text;

-- 2. Index session_id for provenance lookups by session
create index if not exists memories_session_id_idx
  on memories(session_id)
  where session_id is not null;

-- 3. Index tool_name for audit filters ("all memories written by `remember` in last 30d")
create index if not exists memories_tool_name_idx
  on memories(project_id, tool_name)
  where tool_name is not null;

-- 4. GIN index on source_context for containment queries
--    (e.g. "all memories sourced from this file path or PR number")
create index if not exists memories_source_context_gin_idx
  on memories using gin (source_context)
  where source_context is not null;

-- 5. Convenience RPC for the dashboard: fetch full provenance row for a memory.
--    SECURITY DEFINER bypasses RLS on `memories`, so the function must enforce
--    project membership explicitly via is_project_member. search_path is pinned
--    to match the pattern established in migrations 0048 and 0051.
create or replace function get_memory_provenance(p_memory_id uuid)
returns table (
  memory_id      uuid,
  user_id        uuid,
  user_display   text,
  agent_name     text,
  session_id     uuid,
  tool_name      text,
  source_context jsonb,
  created_at     timestamptz,
  updated_at     timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id                                               as memory_id,
    m.updated_by                                       as user_id,
    coalesce(
      u.raw_user_meta_data->>'full_name',
      split_part(u.email, '@', 1),
      'Unknown'
    )                                                  as user_display,
    m.agent_name,
    m.session_id,
    m.tool_name,
    m.source_context,
    m.created_at,
    m.updated_at
  from memories m
  left join auth.users u on u.id = m.updated_by
  where m.id = p_memory_id
    and is_project_member(auth.uid(), m.project_id);
$$;

grant execute on function get_memory_provenance(uuid) to authenticated;
