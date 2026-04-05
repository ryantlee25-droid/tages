-- ============================================================
-- Tages — Memory Importance Scoring
-- Composite score based on recency, access frequency, confidence,
-- and staleness. Used to rank recall results.
-- ============================================================

-- Add importance score column
alter table memories add column importance real not null default 0.5;

-- RPC: recalculate importance scores for a project
create or replace function recalculate_importance(p_project_id uuid)
returns int as $$
  with scored as (
    update memories
    set importance = (
      -- Confidence (0-1): direct weight
      confidence * 0.3
      +
      -- Recency (0-1): exponential decay over 90 days
      greatest(0, 1.0 - extract(epoch from (now() - updated_at)) / (90 * 86400))::real * 0.25
      +
      -- Access frequency (0-1): log scale, capped at 50 accesses
      least(1.0, ln(greatest(1, access_count) + 1) / ln(51))::real * 0.25
      +
      -- Freshness penalty: stale memories lose 0.2
      case when stale then 0.0 else 0.2 end
    )
    where project_id = p_project_id
    returning id
  )
  select count(*)::int from scored;
$$ language sql security definer;

-- RPC: importance-weighted recall (replaces basic recall for ranked results)
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
      -- Final score: 60% text match + 40% importance
      (
        greatest(similarity(m.key, p_query), similarity(m.value, p_query)) * 0.6
        + m.importance * 0.4
      ) as final_score
    from memories m
    where m.project_id = p_project_id
      and greatest(
        similarity(m.key, p_query),
        similarity(m.value, p_query)
      ) > 0.15
      and (p_type is null or m.type = p_type)
    order by final_score desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;
