-- ============================================================
-- Tages — hybrid_recall: Reciprocal Rank Fusion (RRF) in place of
-- raw-score UNION ALL + DISTINCT ON
--
-- Two-Stage Retrieval plan, Task 5 (PLAN.md lines 908-922). Today's
-- hybrid_recall merges the trigram and vector legs by UNION ALL-ing both
-- result sets and picking, per id, whichever leg scored higher via
-- `distinct on (id) order by id, sim desc`. That is a raw-score jam: a
-- trigram similarity and a cosine similarity are not on the same scale, so
-- "highest sim wins" silently privileges whichever signal happens to
-- produce larger numbers rather than whichever signal ranked the row
-- higher relative to its own distribution. This migration replaces that
-- with rank-based fusion (RRF, k=60 — the standard/Elasticsearch-default
-- constant, matching the CLI-side TypeScript `reciprocalRankFusion`
-- introduced in this same plan's Task 1): each leg is ranked
-- independently via `RANK() OVER (ORDER BY sim DESC)`, then the two
-- ranked sets are combined with a FULL OUTER JOIN on id, and each row's
-- final score is the sum of `1/(60+rank)` across whichever leg(s) it
-- appears in (0 contribution from a leg it's absent from).
--
-- Reproduced from `hybrid_recall`'s live definition in
-- supabase/migrations/0061_word_similarity_recall_fix.sql: the
-- trigram leg's word_similarity widening (word_similarity(p_query, m.key)
-- / word_similarity(p_query, m.value) added to the greatest(...) score,
-- plus the word_similarity > 0.4 WHERE branches) and both legs'
-- referenced_date/relative_date columns are preserved verbatim. The
-- vector leg's threshold (> 0.3) and the trigram leg's threshold
-- (similarity > 0.15) are unchanged — this migration only replaces the
-- fusion/dedup mechanics downstream of each leg's own WHERE filter, it
-- does not touch either leg's own matching/threshold logic.
--
-- RETURNS TABLE shape is unchanged from 0061 (id, project_id, key, value,
-- type, source, file_paths, tags, confidence, created_at, referenced_date,
-- relative_date, similarity, match_type) — `similarity` now carries the
-- fused RRF score rather than a raw trigram/cosine score, same convention
-- as the CLI's RRF output. No application code changes required: per
-- 0061's header, the three live call sites (packages/server/src/sync/
-- supabase-sync.ts, apps/dashboard/src/components/command-palette.tsx,
-- apps/dashboard/src/components/memory-table.tsx) all destructure columns
-- that are unchanged here.
--
-- `match_type` semantics change slightly: 'both' when a row has a rank in
-- both legs (previously impossible to express — the old DISTINCT ON could
-- only ever tag a row 'trigram' or 'semantic', even when both legs found
-- it), 'trigram' when only the trigram leg ranked it, 'semantic' when only
-- the vector leg did.
--
-- `recall_memories` (the non-hybrid trigram-only RPC) is unchanged by
-- this migration.
--
-- *** DEV ONLY ***
-- Per this plan's Scope section, migrations 0062-0064 apply to the DEV
-- Supabase project (ugogdqzhhnuzwgcaovty) only. Do NOT apply to prod
-- (wezagdgpvwfywjoxztfs) as part of this plan — prod stays on migration
-- 0060 for this entire effort. Verify target before applying:
--   supabase migration list --linked
-- and confirm the linked project ref is DEV, not prod.
-- ============================================================

-- pgvector's `vector` type lives in the `extensions` schema; the migration
-- session's search_path does not include it by default, so the DROP/CREATE
-- FUNCTION statements below (hybrid_recall references vector(1536) in its
-- signature) must widen search_path to resolve it at DDL time. This is the
-- exact fix migration 0060 (commit #69) applied after hitting a "type
-- vector does not exist" failure from omitting this — reproduced here for
-- the same reason, same as 0061.
set search_path = public, extensions;

-- ------------------------------------------------------------
-- hybrid_recall — live definition from 0061_word_similarity_recall_fix.sql,
-- reproduced verbatim except the trigram_results/vector_results/combined/
-- deduped raw-score-jam pipeline is replaced with RANK() + FULL OUTER
-- JOIN + RRF fusion, described above.
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
    with trigram_scored as (
      select m.id, m.project_id, m.key, m.value, m.type, m.source,
        m.file_paths, m.tags, m.confidence, m.created_at,
        m.referenced_date, m.relative_date,
        greatest(
          similarity(m.key, p_query),
          similarity(m.value, p_query),
          word_similarity(p_query, m.key),
          word_similarity(p_query, m.value)
        ) as sim
      from memories m
      where m.project_id = p_project_id
        and (
          greatest(similarity(m.key, p_query), similarity(m.value, p_query)) > 0.15
          or word_similarity(p_query, m.value) > 0.4
          or word_similarity(p_query, m.key) > 0.4
        )
        and (p_type is null or m.type = p_type)
    ),
    trigram_results as (
      select *, rank() over (order by sim desc) as trigram_rank
      from trigram_scored
    ),
    vector_scored as (
      select m.id, m.project_id, m.key, m.value, m.type, m.source,
        m.file_paths, m.tags, m.confidence, m.created_at,
        m.referenced_date, m.relative_date,
        (1 - (m.embedding <=> p_embedding))::real as sim
      from memories m
      where m.project_id = p_project_id
        and p_embedding is not null
        and m.embedding is not null
        and (1 - (m.embedding <=> p_embedding)) > 0.3
        and (p_type is null or m.type = p_type)
    ),
    vector_results as (
      select *, rank() over (order by sim desc) as vector_rank
      from vector_scored
    ),
    fused as (
      select
        coalesce(t.id, v.id) as id,
        coalesce(t.project_id, v.project_id) as project_id,
        coalesce(t.key, v.key) as key,
        coalesce(t.value, v.value) as value,
        coalesce(t.type, v.type) as type,
        coalesce(t.source, v.source) as source,
        coalesce(t.file_paths, v.file_paths) as file_paths,
        coalesce(t.tags, v.tags) as tags,
        coalesce(t.confidence, v.confidence) as confidence,
        coalesce(t.created_at, v.created_at) as created_at,
        coalesce(t.referenced_date, v.referenced_date) as referenced_date,
        coalesce(t.relative_date, v.relative_date) as relative_date,
        (
          coalesce(1.0 / (60 + t.trigram_rank), 0)
          + coalesce(1.0 / (60 + v.vector_rank), 0)
        )::real as rrf_score,
        case
          when t.id is not null and v.id is not null then 'both'
          when t.id is not null then 'trigram'
          else 'semantic'
        end as match_type
      from trigram_results t
      full outer join vector_results v on t.id = v.id
    )
    -- Every output column must be table-qualified here: plpgsql's RETURNS
    -- TABLE out-params shadow same-named columns and raise 42702 otherwise.
    select f.id, f.project_id, f.key, f.value, f.type, f.source,
      f.file_paths, f.tags, f.confidence, f.created_at,
      f.referenced_date, f.relative_date,
      f.rrf_score as similarity, f.match_type
    from fused f
    order by f.rrf_score desc
    limit p_limit;
end;
$$ language plpgsql security definer stable set search_path = public, extensions;

-- ============================================================
-- Manual smoke-test steps (no automated SQL test harness in this repo —
-- confirmed via search, same convention as migrations 0060/0061).
--
-- Apply to the DEV Supabase project ONLY — never prod:
--
-- 1. Confirm the target is DEV, not prod, before applying:
--      supabase migration list --linked
--    (project ref must be ugogdqzhhnuzwgcaovty — NOT wezagdgpvwfywjoxztfs)
--
-- 2. Apply:
--      supabase db push
--
-- 3. Grep the blast radius fresh and confirm it still matches 0061's
--    documented 3 call sites before/after applying:
--      grep -rn ".rpc('hybrid_recall'" apps packages
--
-- 4. NULL-handling / FULL OUTER JOIN smoke test — confirm a row present in
--    only one leg still returns every non-leg-specific column correctly
--    (coalesce pulls from whichever leg matched):
--      select id, similarity, match_type from hybrid_recall(
--        '<project_id>'::uuid, '<a query with only a trigram-side match>',
--        null, null, 30
--      );
--    Expect: rows with match_type = 'trigram' have non-null key/value/
--    created_at etc. even though the vector leg contributed nothing.
--
-- 5. `match_type = 'both'` smoke test — a row scoring on both signals
--    (verify with a query + embedding pair known to match a memory on
--    both trigram and cosine similarity) should return match_type =
--    'both' and a similarity (rrf_score) higher than either single-leg
--    row for the same query, since it accumulates both legs' RRF terms.
--
-- 6. Confirm ordering changed versus a pre-migration snapshot (rank-based
--    fusion can reorder rows relative to the old raw-score jam even when
--    the same set of ids is returned).
--
-- 7. No harness rerun credit for this task alone — the LongMemEval harness
--    shells out to the CLI's `tages recall`, which does not call
--    hybrid_recall (see PLAN.md's "Critical correction to plan scope").
--    This migration's value is MCP-server-path (packages/server/src/sync/
--    supabase-sync.ts) and dashboard-path product correctness only.
-- ============================================================
