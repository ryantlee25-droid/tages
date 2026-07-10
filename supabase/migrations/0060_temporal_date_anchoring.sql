-- ============================================================
-- Tages — 3-Date Temporal Anchoring
--
-- Adds two nullable columns to `memories` so recall can reason about time
-- along three axes: `created_at` (observation date, already exists),
-- `referenced_date` (an absolute date explicitly mentioned in the memory's
-- text), and `relative_date` (a relative expression — "3 days ago", "last
-- Tuesday" — resolved to an absolute timestamp at write time). Both new
-- columns are populated by packages/{server,cli}'s extractDates() and are
-- nullable with NO backfill for historical rows — same convention as
-- migration 0057 (provenance fields).
--
-- `hybrid_recall` and `semantic_recall` are the only two RPCs called from
-- application code repo-wide (confirmed via `grep -rn ".rpc('hybrid_recall'"
-- and ".rpc('semantic_recall'" across packages/server, packages/cli, and
-- apps/dashboard) — packages/server/src/sync/supabase-sync.ts:330 and
-- packages/cli/src/commands/recall.ts:82, respectively. `recall_memories`
-- and `importance_recall` are also called (packages/cli/src/commands/
-- recall.ts:65) but are NOT modified here — they are out of scope for this
-- migration and continue to return their existing column sets unchanged.
--
-- Each function below is reproduced from its live definition (hybrid_recall:
-- 0012_fix_hybrid_thresholds.sql; semantic_recall: 0014_fix_rpc_return_types
-- .sql) with only `m.referenced_date, m.relative_date` added to the SELECT
-- list and RETURNS TABLE — every other clause (thresholds, status filter,
-- join shape, ordering) is preserved verbatim per the "diff against the
-- current definition, don't drop a clause" convention.
--
-- Postgres note: `CREATE OR REPLACE FUNCTION` cannot change an existing
-- function's RETURNS TABLE column list in place — it requires DROP FUNCTION
-- first when the signature changes shape, so both functions are dropped by
-- their existing (unchanged) argument signature before being recreated.
-- ============================================================

alter table memories add column if not exists referenced_date timestamptz;
alter table memories add column if not exists relative_date timestamptz;

-- Supporting indexes for temporal-ordered recall (fallback chain:
-- referenced_date -> relative_date -> created_at). Partial indexes since both
-- columns are sparse (most memories will never mention a date).
create index if not exists memories_referenced_date_idx
  on memories (project_id, referenced_date) where referenced_date is not null;
create index if not exists memories_relative_date_idx
  on memories (project_id, relative_date) where relative_date is not null;

-- ------------------------------------------------------------
-- hybrid_recall — live definition from 0012_fix_hybrid_thresholds.sql,
-- adding m.referenced_date / m.relative_date to every leg of the union and
-- to the final RETURNS TABLE / SELECT. No other clause changed.
-- ------------------------------------------------------------
drop function if exists hybrid_recall(uuid, text, vector, text, int);

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
  referenced_date timestamptz,
  relative_date timestamptz,
  similarity real,
  match_type text
) as $$
begin
  return query
    with trigram_results as (
      select m.id, m.project_id, m.key, m.value, m.type, m.source,
        m.file_paths, m.tags, m.confidence, m.created_at,
        m.referenced_date, m.relative_date,
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
        m.referenced_date, m.relative_date,
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
      referenced_date, relative_date,
      sim as similarity, mtype as match_type
    from deduped
    order by sim desc
    limit p_limit;
end;
$$ language plpgsql security definer stable;

-- ------------------------------------------------------------
-- semantic_recall — live definition from 0014_fix_rpc_return_types.sql,
-- adding m.referenced_date / m.relative_date to the RETURNS TABLE / SELECT.
-- No other clause changed (status filter, threshold, ordering preserved).
-- ------------------------------------------------------------
drop function if exists semantic_recall(uuid, vector, text, int, real);

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
  referenced_date timestamptz,
  relative_date timestamptz,
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
      m.referenced_date, m.relative_date,
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

-- ============================================================
-- Manual smoke-test steps (no automated SQL harness in this repo — verified
-- via Step 1 search per the plan; this is the established verification
-- convention for migrations here).
--
-- Run against a scratch/dev Supabase project before applying to prod:
--
-- 1. Apply the migration:
--      supabase db push   (or: psql -f 0060_temporal_date_anchoring.sql)
--
-- 2. Confirm the columns exist and are nullable:
--      select column_name, is_nullable, data_type
--      from information_schema.columns
--      where table_name = 'memories'
--        and column_name in ('referenced_date', 'relative_date');
--    Expect: both rows, is_nullable = 'YES', data_type = 'timestamp with time zone'.
--
-- 3. Confirm existing rows are unaffected (no backfill):
--      select count(*) from memories where referenced_date is not null
--         or relative_date is not null;
--    Expect: 0 immediately after migration (all historical rows untouched).
--
-- 4. Confirm hybrid_recall still returns rows and now includes the new
--    columns, using a project/query known to have live memories:
--      select * from hybrid_recall(
--        '<project_id>'::uuid, 'some existing query text', null, null, 5
--      );
--    Expect: same row count/ordering as before the migration, plus
--    referenced_date and relative_date columns present (null for rows
--    written before this migration).
--
-- 5. Confirm semantic_recall still returns rows the same way, using a known
--    embedding vector for a project with embedded memories:
--      select * from semantic_recall(
--        '<project_id>'::uuid, '[0.01, 0.02, ...]'::vector(1536), null, 5, 0.3
--      );
--    Expect: same behavior as before, plus the two new columns present.
--
-- 6. Write a new memory via `tages remember` (or the MCP `remember` tool)
--    whose value contains an explicit date ("shipped on July 9, 2026") and
--    confirm referenced_date is populated:
--      select key, referenced_date, relative_date, created_at from memories
--      where key = '<the key just written>';
-- ============================================================
