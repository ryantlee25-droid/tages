-- ============================================================
-- Fix: drop and recreate RPCs with updated return types
-- (0013 added columns but couldn't alter existing function returns)
-- ============================================================

drop function if exists recall_memories(uuid, text, text, int);
drop function if exists semantic_recall(uuid, vector, text, int, real);
drop function if exists importance_recall(uuid, text, text, int);

-- Recreate recall_memories with new columns + status filter
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
      ) > 0.3
      and (p_type is null or m.type = p_type)
    order by similarity desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;

-- Recreate semantic_recall with status filter
create or replace function semantic_recall(
  p_project_id uuid,
  p_embedding vector(1536),
  p_type text default null,
  p_limit int default 5,
  p_threshold real default 0.3
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
      (1 - (m.embedding <=> p_embedding))::real as similarity
    from memories m
    where m.project_id = p_project_id
      and m.status = 'live'
      and m.embedding is not null
      and (1 - (m.embedding <=> p_embedding)) > p_threshold
      and (p_type is null or m.type = p_type)
    order by m.embedding <=> p_embedding
    limit p_limit;
end;
$$ language plpgsql security definer stable;

-- Recreate importance_recall with status filter + structured metadata columns
create or replace function importance_recall(
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
  file_paths text[],
  tags text[],
  confidence real,
  conditions text[],
  phases text[],
  cross_system_refs text[],
  examples jsonb,
  execution_flow jsonb,
  importance real,
  access_count int,
  stale boolean,
  created_at timestamptz,
  similarity real,
  final_score real
) as $$
begin
  return query
    select
      m.id, m.project_id, m.key, m.value, m.type, m.source,
      m.file_paths, m.tags, m.confidence,
      m.conditions, m.phases, m.cross_system_refs,
      m.examples, m.execution_flow,
      m.importance, m.access_count,
      m.stale, m.created_at,
      greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) as similarity,
      (
        greatest(similarity(m.key, p_query), similarity(m.value, p_query)) * 0.6
        + m.importance * 0.4
      ) as final_score
    from memories m
    where m.project_id = p_project_id
      and m.status = 'live'
      and greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) > 0.15
      and (p_type is null or m.type = p_type)
    order by final_score desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;
