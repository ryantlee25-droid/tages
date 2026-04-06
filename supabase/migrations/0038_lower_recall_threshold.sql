-- ============================================================
-- Fix: lower trigram similarity threshold in recall_memories
-- from 0.3 to 0.15 to match importance_recall behavior.
-- 0.3 is too aggressive — broad queries like "memory" or short
-- terms get filtered out despite being relevant matches.
-- ============================================================

drop function if exists recall_memories(uuid, text, text, int);

create or replace function recall_memories(
  p_project_id uuid,
  p_query text,
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
      and greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) > 0.15
      and (p_type is null or m.type = p_type)
    order by similarity desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;
