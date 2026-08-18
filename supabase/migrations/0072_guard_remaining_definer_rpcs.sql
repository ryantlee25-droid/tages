-- ============================================================
-- Tages — close the three SECURITY DEFINER RPCs that 0066/0068 missed
--
-- 0066 added an access guard to the four recall RPCs and its header claimed to
-- close "the same class of hole". It closed four of seven. These three have the
-- identical shape — SECURITY DEFINER, a caller-supplied `p_project_id`, no
-- `auth.uid()` check, and no explicit GRANT so EXECUTE defaults to PUBLIC:
--
--   revert_memory_to_version  (0015)  -- a WRITE
--   get_memory_versions       (0015)  -- reads full version history
--   contextual_recall         (0016)  -- reads live memories
--
-- `revert_memory_to_version` is the serious one and is strictly worse than the
-- read hole 0066 closed: it issues
--     update memories set value = ... where project_id = p_project_id and key = p_key
-- so ANY authenticated caller who can guess or observe a project UUID can
-- overwrite that project's memory with any value from its own history. Since
-- 0069 that UPDATE also fires a SECURITY DEFINER snapshot trigger, so the
-- forged edit is written into the audit trail as though it were legitimate.
--
-- The guard is copied verbatim from 0068 so all seven functions now share one
-- implementation. As there: the role claim is read from the request-scoped JWT
-- GUC rather than `current_user`, which under SECURITY DEFINER resolves to the
-- function owner and would exempt every caller; `nullif(..., '')` avoids the
-- `''::jsonb` throw; an absent GUC yields NULL and `NULL is distinct from
-- 'service_role'` is true, so it fails closed.
--
-- Function bodies are otherwise reproduced UNCHANGED from 0015 and 0016. The
-- only additions are the guard and, on the two that lacked it, the
-- `set search_path = public, extensions` that the 0042 rule requires.
-- ============================================================

set search_path = public, extensions;

-- ------------------------------------------------------------
-- 1. revert_memory_to_version — body verbatim from
--    0015_memory_versions_rpc.sql:38-66, guard added. THE WRITE.
-- ------------------------------------------------------------
create or replace function revert_memory_to_version(
  p_project_id uuid,
  p_key text,
  p_version int
)
returns void as $$
declare
  v_value text;
  v_confidence real;
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
     ) is distinct from 'service_role'
     and not exists (
       select 1 from projects p
       where p.id = p_project_id
         and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
     ) then
    raise exception 'not authorized for project %', p_project_id
      using errcode = '42501';
  end if;

  select value, confidence
  into v_value, v_confidence
  from memory_versions
  where project_id = p_project_id
    and key = p_key
    and version = p_version;

  if not found then
    raise exception 'Version % not found for key %', p_version, p_key;
  end if;

  update memories
  set value = v_value,
      confidence = v_confidence,
      updated_at = now()
  where project_id = p_project_id
    and key = p_key;
end;
$$ language plpgsql security definer set search_path = public, extensions;

-- ------------------------------------------------------------
-- 2. get_memory_versions — body verbatim from
--    0015_memory_versions_rpc.sql:8-35, guard added.
--
--    This one stays `language sql`. The guard is expressed as a WHERE predicate
--    rather than an early return, because rewriting it as plpgsql to get an
--    `if ... then return` would block the planner from inlining it and change
--    its cost profile for no behavioural gain. The predicate short-circuits on
--    the role claim exactly as the plpgsql form does.
--
--    Returns empty rather than raising: it is a read, and the four recall RPCs
--    already answer an unauthorized read with zero rows. Matching them keeps a
--    single observable behaviour and avoids turning this into a project-id
--    probe that distinguishes "exists but forbidden" from "does not exist".
-- ------------------------------------------------------------
create or replace function get_memory_versions(
  p_project_id uuid,
  p_key text
)
returns table (
  id uuid,
  memory_id uuid,
  version int,
  value text,
  confidence real,
  changed_by text,
  change_reason text,
  created_at timestamptz
) as $$
  select
    mv.id,
    mv.memory_id,
    mv.version,
    mv.value,
    mv.confidence,
    mv.changed_by,
    mv.change_reason,
    mv.created_at
  from memory_versions mv
  where mv.project_id = p_project_id
    and mv.key = p_key
    and (
      coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
      ) is not distinct from 'service_role'
      or exists (
        select 1 from projects p
        where p.id = p_project_id
          and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
      )
    )
  order by mv.version desc;
$$ language sql security definer stable set search_path = public, extensions;

-- ------------------------------------------------------------
-- 3. contextual_recall — body verbatim from
--    0016_contextual_recall.sql:6-71, guard added. Empty on denial, matching
--    the other recall RPCs.
-- ------------------------------------------------------------
create or replace function contextual_recall(
  p_project_id uuid,
  p_query text,
  p_conditions text[] default null,
  p_agent_name text default null,
  p_phase text default null,
  p_type text default null,
  p_limit int default 5
)
returns table (
  id uuid,
  project_id uuid,
  key text,
  value text,
  type text,
  source text,
  agent_name text,
  file_paths text[],
  tags text[],
  confidence real,
  conditions text[],
  phases text[],
  cross_system_refs text[],
  examples jsonb,
  execution_flow jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity real
) as $$
begin
  if coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
     ) is distinct from 'service_role'
     and not exists (
       select 1 from projects p
       where p.id = p_project_id
         and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
     ) then
    return;
  end if;

  return query
    select
      m.id, m.project_id, m.key, m.value, m.type, m.source,
      m.agent_name, m.file_paths, m.tags, m.confidence,
      m.conditions, m.phases, m.cross_system_refs,
      m.examples, m.execution_flow,
      m.created_at, m.updated_at,
      greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) as similarity
    from memories m
    where m.project_id = p_project_id
      and m.status = 'live'
      and (p_type is null or m.type = p_type)
      and (p_agent_name is null or m.agent_name = p_agent_name)
      and (p_phase is null or m.phases @> array[p_phase])
      and (
        p_conditions is null
        or m.conditions is null
        or m.conditions && p_conditions
      )
      and (
        p_query = ''
        or greatest(
          similarity(m.key, p_query),
          similarity(m.value, p_query)
        ) > 0.1
      )
    order by greatest(
      similarity(m.key, p_query),
      similarity(m.value, p_query)
    ) desc
    limit p_limit;
end;
$$ language plpgsql security definer stable set search_path = public, extensions;
