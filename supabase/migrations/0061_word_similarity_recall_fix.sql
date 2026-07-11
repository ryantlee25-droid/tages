-- ============================================================
-- Tages — word_similarity() recall-dilution fix
--
-- 22% of a 50-question LongMemEval eval run (11/50) returned ZERO memories,
-- concentrated on single-session haystacks of 13-18K chars. pg_trgm's
-- similarity(query, target) dilutes on long target values — the whole
-- string is compared trigram-set-to-trigram-set, so a short natural-
-- language query against a long value scores far below any usable
-- threshold even when the query's content is clearly present in the
-- value. Migration 0039_recall_ilike_fallback.sql diagnosed and partially
-- fixed this for `recall_memories` via an ILIKE substring fallback, but
-- ILIKE only matches literal substrings — agents (and this eval harness)
-- pass full natural-language sentences as the query, which essentially
-- never appears verbatim inside a transcript. `hybrid_recall` (added/
-- touched later, most recently by migration 0060) never got even that
-- fallback.
--
-- pg_trgm's word_similarity(query, target) is the correct primitive for
-- this asymmetric case: it returns the similarity of the query against the
-- BEST-matching word-bounded substring of target, rather than diluting
-- across the whole value. This migration widens both RPCs' scoring/filter
-- expressions to add word_similarity as an additional signal — it does not
-- remove or replace any existing clause (similarity() threshold and the
-- ILIKE fallback both stay, per this repo's "diff against the current
-- definition, don't drop a clause" convention — see 0060's header).
--
-- Neither function's RETURNS TABLE shape changes. No application code
-- changes required (confirmed via `grep -rn ".rpc('hybrid_recall'\|
-- .rpc('recall_memories'" apps packages`): apps/dashboard/src/components/
-- command-palette.tsx:49, apps/dashboard/src/components/memory-table.tsx:97,
-- packages/server/src/sync/supabase-sync.ts:304,330,
-- packages/cli/src/commands/query.ts:25, packages/cli/src/commands/
-- recall.ts:66 — all six call sites destructure columns that are unchanged
-- here, so none need edits.
--
-- word_similarity threshold: 0.4 (conservative starting point per plan;
-- pg_trgm's own `<%` operator GUC default is 0.6, but that's tuned for
-- exact-word search UIs, not this asymmetric long-document case — this is
-- a starting point, not a hard commitment; the eval harness rerun below is
-- the calibration signal).
--
-- *** DEV ONLY ***
-- Per explicit instruction, this migration is applied to a scratch/DEV
-- Supabase project (longmemeval-sandbox or equivalent) for the LongMemEval
-- eval effort ONLY. Do NOT apply to prod (wezagdgpvwfywjoxztfs) as part of
-- this plan. Verify target before applying:
--   supabase migration list --linked
-- and confirm the linked project ref is the DEV/sandbox project, not prod.
-- ============================================================

-- pgvector's `vector` type lives in the `extensions` schema; the migration
-- session's search_path does not include it by default, so the DROP/CREATE
-- FUNCTION statements below (hybrid_recall references vector(1536) in its
-- signature) must widen search_path to resolve it at DDL time. This is the
-- exact fix migration 0060 (commit #69, "0060 set search_path so vector
-- type resolves at DDL time") applied after hitting a "type vector does not
-- exist" failure from omitting this — reproduced here for the same reason.
set search_path = public, extensions;

-- ------------------------------------------------------------
-- recall_memories — live definition from 0039_recall_ilike_fallback.sql,
-- reproduced verbatim except:
--   1. the `similarity` score's greatest(...) now also considers
--      word_similarity(p_query, m.key) and word_similarity(p_query, m.value)
--   2. the WHERE filter's OR-chain gets a fourth branch:
--      word_similarity(p_query, m.value) > 0.4 or
--      word_similarity(p_query, m.key) > 0.4
-- The existing similarity() > 0.15 check and both ILIKE fallback branches
-- are unchanged and unremoved.
-- ------------------------------------------------------------
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
        similarity(m.value, p_query),
        word_similarity(p_query, m.key),
        word_similarity(p_query, m.value)
      ) as similarity
    from memories m
    where m.project_id = p_project_id
      and m.status = 'live'
      and (
        greatest(
          similarity(m.key, p_query),
          similarity(m.value, p_query)
        ) > 0.15
        or m.key ilike '%' || p_query || '%'
        or m.value ilike '%' || p_query || '%'
        or word_similarity(p_query, m.value) > 0.4
        or word_similarity(p_query, m.key) > 0.4
      )
      and (p_type is null or m.type = p_type)
    order by similarity desc
    limit p_limit;
end;
$$ language plpgsql security definer stable set search_path = public, extensions;

-- ------------------------------------------------------------
-- hybrid_recall — live definition from 0060_temporal_date_anchoring.sql
-- (which itself carries referenced_date/relative_date from Tier-1, plus the
-- search_path hardening from commit #69) — every clause preserved verbatim
-- EXCEPT the trigram_results CTE's `sim` computation and WHERE filter,
-- which get the same word_similarity widening as recall_memories above.
-- vector_results (the embedding leg) is untouched — word_similarity doesn't
-- apply to vector similarity, and the embedding-pooling dilution case is a
-- separate, deferred (multi-row chunk storage) problem, out of scope here.
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
        greatest(
          similarity(m.key, p_query),
          similarity(m.value, p_query),
          word_similarity(p_query, m.key),
          word_similarity(p_query, m.value)
        ) as sim,
        'trigram'::text as mtype
      from memories m
      where m.project_id = p_project_id
        and (
          greatest(similarity(m.key, p_query), similarity(m.value, p_query)) > 0.15
          or word_similarity(p_query, m.value) > 0.4
          or word_similarity(p_query, m.key) > 0.4
        )
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
$$ language plpgsql security definer stable set search_path = public, extensions;

-- ============================================================
-- Manual smoke-test steps (no automated SQL test harness in this repo —
-- confirmed via search, same convention as migration 0060).
--
-- Apply to a scratch/DEV Supabase project ONLY — never prod:
--
-- 1. Confirm the target is DEV, not prod, before applying:
--      supabase migration list --linked
--    (project ref must be the longmemeval-sandbox / DEV project, e.g.
--    ugogdqzhhnuzwgcaovty per project memory — NOT wezagdgpvwfywjoxztfs)
--
-- 2. Apply:
--      supabase db push
--
-- 3. Confirm recall_memories now finds a long-value row a short NL query
--    previously missed (use a real project/session that previously
--    produced a zero-hit question, e.g. gpt4_468eb063 from the LongMemEval
--    zero-hit set):
--      select id, similarity from recall_memories(
--        '<project_id>'::uuid, '<the literal question text>', null, 30
--      );
--    Expect: at least one row returned where zero returned before, and the
--    returned `similarity` reflects a word_similarity match (i.e. verify
--    directly: `select word_similarity('<query>', value) from memories
--    where id = '<the matched row id>';` returns > 0.4).
--
-- 4. Same check against hybrid_recall:
--      select id, similarity, match_type from hybrid_recall(
--        '<project_id>'::uuid, '<the literal question text>', null, null, 30
--      );
--    Expect: at least one 'trigram' row where none returned before.
--
-- 5. Re-run the LongMemEval 50-question harness (standard rerun procedure)
--    and confirm:
--      - recalled_memory_count == 0 count drops below the 11/50 baseline
--      - recall_at_k (overall, baseline 78.0%) increases
--      - no per-type regression versus baseline
-- ============================================================
