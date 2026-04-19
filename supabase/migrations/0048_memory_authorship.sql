-- ============================================================
-- Tages — Memory Authorship
-- Adds created_by / updated_by columns to memories, and
-- changed_by_user_id to memory_versions. Provides a safe
-- get_memory_authors RPC that never exposes raw email addresses.
-- ============================================================

-- 1. Add authorship columns to memories (nullable — no backfill)
alter table memories
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_by uuid references auth.users(id);

-- 2. Add user FK to memory_versions alongside existing text changed_by
alter table memory_versions
  add column if not exists changed_by_user_id uuid references auth.users(id);

-- 3. get_memory_authors: returns display name only, never raw email
create or replace function get_memory_authors(memory_ids uuid[])
returns table (
  memory_id  uuid,
  display_name text,
  updated_at timestamptz
)
language sql
security definer
stable
as $$
  select
    m.id                                               as memory_id,
    coalesce(
      u.raw_user_meta_data->>'full_name',
      split_part(u.email, '@', 1),
      'Unknown'
    )                                                  as display_name,
    m.updated_at
  from memories m
  left join auth.users u on u.id = m.updated_by
  where m.id = any(memory_ids);
$$;

-- 4. Replace list_unresolved_conflicts RPC to add authorship columns.
--    Postgres cannot ALTER the return type of a function; must drop + recreate.
drop function if exists list_unresolved_conflicts(uuid);

create function list_unresolved_conflicts(p_project_id uuid)
returns table (
  id           uuid,
  memory_a_id  uuid,
  memory_b_id  uuid,
  reason       text,
  a_key        text,
  a_value      text,
  b_key        text,
  b_value      text,
  a_updated_by text,
  b_updated_by text,
  a_updated_at timestamptz,
  b_updated_at timestamptz,
  created_at   timestamptz
)
language sql
security definer
stable
as $$
  select
    c.id,
    c.memory_a_id,
    c.memory_b_id,
    c.reason,
    a.key                                              as a_key,
    a.value                                            as a_value,
    b.key                                              as b_key,
    b.value                                            as b_value,
    coalesce(
      ua.raw_user_meta_data->>'full_name',
      split_part(ua.email, '@', 1),
      'Unknown'
    )                                                  as a_updated_by,
    coalesce(
      ub.raw_user_meta_data->>'full_name',
      split_part(ub.email, '@', 1),
      'Unknown'
    )                                                  as b_updated_by,
    a.updated_at                                       as a_updated_at,
    b.updated_at                                       as b_updated_at,
    c.created_at
  from memory_conflicts c
  join memories a on a.id = c.memory_a_id
  join memories b on b.id = c.memory_b_id
  left join auth.users ua on ua.id = a.updated_by
  left join auth.users ub on ub.id = b.updated_by
  where c.project_id = p_project_id
    and c.resolved = false
  order by c.created_at desc;
$$;

-- 5. Grant execute to authenticated users (RPC callable from dashboard)
grant execute on function get_memory_authors(uuid[]) to authenticated;
grant execute on function list_unresolved_conflicts(uuid) to authenticated;
