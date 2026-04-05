-- Lower hybrid recall thresholds so semantic matches aren't filtered out
create or replace function hybrid_recall(
  p_project_id uuid,
  p_query text,
  p_embedding vector(1536) default null,
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
  created_at timestamptz,
  similarity real,
  match_type text
) as $$
begin
  return query
    with trigram_results as (
      select m.id, m.project_id, m.key, m.value, m.type, m.source,
        m.file_paths, m.tags, m.confidence, m.created_at,
        greatest(similarity(m.key, p_query), similarity(m.value, p_query)) as sim,
        'trigram'::text as mtype
      from memories m
      where m.project_id = p_project_id
        and greatest(similarity(m.key, p_query), similarity(m.value, p_query)) > 0.15
        and (p_type is null or m.type = p_type)
    ),
    vector_results as (
      select m.id, m.project_id, m.key, m.value, m.type, m.source,
        m.file_paths, m.tags, m.confidence, m.created_at,
        (1 - (m.embedding <=> p_embedding))::real as sim,
        'semantic'::text as mtype
      from memories m
      where m.project_id = p_project_id
        and p_embedding is not null
        and m.embedding is not null
        and (1 - (m.embedding <=> p_embedding)) > 0.3
        and (p_type is null or m.type = p_type)
    ),
    combined as (
      select * from trigram_results
      union all
      select * from vector_results
    ),
    deduped as (
      select distinct on (id) *
      from combined
      order by id, sim desc
    )
    select id, project_id, key, value, type, source,
      file_paths, tags, confidence, created_at,
      sim as similarity, mtype as match_type
    from deduped
    order by sim desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;
