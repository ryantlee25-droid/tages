-- ============================================================
-- Tages — Drop user_id from get_memory_provenance return shape
--
-- Resolves the W1 finding from the PR #55 White review: returning a raw
-- auth.users UUID exposes an internal Supabase identifier that callers
-- shouldn't depend on for stable cross-tenant correlation. The function
-- still returns user_display (full_name → email-prefix → "Unknown"), which
-- covers every current and planned caller.
--
-- Confirmed before this migration was written:
--   grep -r "get_memory_provenance" apps/dashboard/src/  → 0 results
--   grep -r "get_memory_provenance" packages/            → 0 results
-- The function has zero callers in the codebase, so this is zero-risk.
--
-- If a future feature genuinely needs the auth.users UUID, re-add via a
-- new migration. Avoid the temptation to silently re-introduce it here.
--
-- NOTE: this must be DROP + CREATE, not CREATE OR REPLACE. Postgres
-- rejects CREATE OR REPLACE FUNCTION when the RETURNS TABLE shape changes
-- (SQLSTATE 42P13 - "cannot change return type of existing function"),
-- which 0057 -> 0058 does (0057's shape includes user_id; this one omits
-- it). A fresh `db push` from a clean 0001 state would fail at this
-- migration under CREATE OR REPLACE.
-- ============================================================

drop function if exists get_memory_provenance(uuid);

create function get_memory_provenance(p_memory_id uuid)
returns table (
  memory_id      uuid,
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
