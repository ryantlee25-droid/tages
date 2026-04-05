-- ============================================================
-- Tages — Contextual Recall RPC
-- Filters recall results by conditions array overlap.
-- ============================================================

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
$$ language plpgsql security definer stable;
