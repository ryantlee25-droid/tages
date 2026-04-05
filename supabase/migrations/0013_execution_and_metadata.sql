-- ============================================================
-- Tages — Execution memories, structured metadata, quality gates
-- Closes reviewer-identified gaps 1-7.
-- ============================================================

-- Drop existing functions that we're changing return types on
drop function if exists recall_memories(uuid, text, text, int);
drop function if exists semantic_recall(uuid, vector, text, int, real);
drop function if exists importance_recall(uuid, text, text, int);

-- Allow 'execution' as a memory type
alter table memories drop constraint if exists memories_type_check;
alter table memories add constraint memories_type_check
  check (type in (
    'convention', 'decision', 'architecture',
    'entity', 'lesson', 'preference', 'pattern', 'execution'
  ));

-- Structured metadata fields (all optional, nullable)
alter table memories add column if not exists conditions text[];
alter table memories add column if not exists phases text[];
alter table memories add column if not exists cross_system_refs text[];
alter table memories add column if not exists examples jsonb;
alter table memories add column if not exists execution_flow jsonb;

-- Quality gate: status (live = in recall, pending = needs verification)
alter table memories add column if not exists status text not null default 'live'
  check (status in ('live', 'pending'));
alter table memories add column if not exists verified_at timestamptz;

-- Index for filtering by status in recall queries
create index if not exists memories_status_idx on memories(project_id, status);

-- Update recall_memories to only return live memories
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

-- Update semantic_recall to only return live memories
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

-- Update importance_recall to filter by status
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
      m.file_paths, m.tags, m.confidence, m.importance, m.access_count,
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
