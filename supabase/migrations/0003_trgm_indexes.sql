-- ============================================================
-- Tages — pg_trgm fuzzy search indexes
-- ============================================================

create extension if not exists "pg_trgm";

-- Trigram GIN index on key + value for fuzzy recall
create index memories_trgm_idx
  on memories using gin (key gin_trgm_ops, value gin_trgm_ops);

-- -----------------------------------------------------------
-- RPC function for fuzzy recall queries
-- Uses trigram similarity on concatenated key + value.
-- Called by the MCP server's `recall` tool.
-- -----------------------------------------------------------
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
  created_at timestamptz,
  updated_at timestamptz,
  similarity real
) as $$
begin
  return query
    select
      m.id, m.project_id, m.key, m.value, m.type, m.source,
      m.agent_name, m.file_paths, m.tags, m.confidence,
      m.created_at, m.updated_at,
      greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) as similarity
    from memories m
    where m.project_id = p_project_id
      and greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) > 0.3
      and (p_type is null or m.type = p_type)
    order by similarity desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;
