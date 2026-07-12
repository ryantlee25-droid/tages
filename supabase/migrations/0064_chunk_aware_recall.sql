-- ============================================================
-- Tages — chunk_semantic_recall: chunk-level match + parent-doc rollup
-- with winning-chunk identity (Two-Stage Retrieval plan, Task 10,
-- PLAN.md lines 980-991)
--
-- New RPC, additive — does not replace or modify `semantic_recall`,
-- `hybrid_recall`, or `recall_memories`. Matches against
-- `memory_chunks.embedding` (migration 0063) instead of `memories.
-- embedding`, then rolls each matching chunk up to its parent memory,
-- returning the SINGLE best-matching chunk per memory (not an aggregate
-- score) alongside that memory's normal recall columns — directly
-- evidence-backed this plan's amendment by Supermemory's published
-- "search small, return big" mechanic: search over small/distilled
-- vectors, but preserve and return the specific matched unit's identity,
-- not just a blended score. This is the structural fix for the mean-pool
-- dilution behind the plan's 11/50 zero-hit LongMemEval questions.
--
-- Postgres correctness note (per this task's own pre-mortem in PLAN.md):
-- `DISTINCT ON (c.memory_id)` requires its leading `ORDER BY` to start
-- with `memory_id`, which is incompatible with the final result's
-- intended cross-memory `ORDER BY sim DESC`. A single flat query trying to
-- do both is not expressible — Postgres would reject `DISTINCT ON
-- (memory_id) ... ORDER BY sim DESC` outright (ORDER BY must match/extend
-- the DISTINCT ON columns). This migration therefore structures the query
-- as a CTE: `DISTINCT ON (c.memory_id) ORDER BY c.memory_id, sim DESC`
-- picks the winning chunk per memory INSIDE the CTE, and the outer query
-- wrapping it applies the real `ORDER BY sim DESC` / `LIMIT` across
-- different parent memories.
--
-- RETURNS TABLE shape: same as `semantic_recall`'s current live definition
-- (supabase/migrations/0060_temporal_date_anchoring.sql lines 136-164 —
-- id, project_id, key, value, type, source, agent_name, file_paths, tags,
-- confidence, conditions, phases, cross_system_refs, examples,
-- execution_flow, created_at, updated_at, referenced_date, relative_date,
-- similarity) PLUS two new columns: chunk_index, chunk_text — the winning
-- chunk's identity, per this amendment's upgraded (hard requirement, not
-- optional) chunk-return spec.
--
-- Filters: m.status = 'live' (matches semantic_recall's convention),
-- p_type filter (matches every other recall RPC's convention). Chunk rows
-- with a null embedding (write-path failure, per Task 9's fail-open
-- design) are excluded via `c.embedding is not null`.
--
-- Session-level search_path widened for the same reason as 0060/0061/0062:
-- pgvector's `vector` type lives in the `extensions` schema and this
-- function's signature references vector(1536).
--
-- *** DEV ONLY *** — applies to ugogdqzhhnuzwgcaovty only, per this plan's
-- Scope section. Do NOT apply to prod (wezagdgpvwfywjoxztfs).
-- ============================================================

set search_path = public, extensions;

drop function if exists chunk_semantic_recall(uuid, vector, text, int, real);

create or replace function chunk_semantic_recall(
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
  similarity real,
  chunk_index int,
  chunk_text text
) as $$
begin
  return query
    with matched_chunks as (
      select
        c.memory_id,
        c.chunk_index,
        c.chunk_text,
        (1 - (c.embedding <=> p_embedding))::real as sim
      from memory_chunks c
      join memories m on m.id = c.memory_id
      where c.project_id = p_project_id
        and c.embedding is not null
        and m.status = 'live'
        and (p_type is null or m.type = p_type)
        and (1 - (c.embedding <=> p_embedding)) > p_threshold
    ),
    winning_chunks as (
      -- One row per memory: its best-matching chunk. DISTINCT ON's
      -- leading ORDER BY column must be memory_id — the cross-memory
      -- ORDER BY sim DESC happens in the outer query below, not here.
      -- Columns table-qualified: plpgsql's RETURNS TABLE out-params
      -- (chunk_index, chunk_text) shadow same-named columns and raise
      -- 42702 if referenced unqualified.
      select distinct on (mc.memory_id)
        mc.memory_id, mc.chunk_index, mc.chunk_text, mc.sim
      from matched_chunks mc
      order by mc.memory_id, mc.sim desc
    )
    select
      m.id, m.project_id, m.key, m.value, m.type, m.source,
      m.agent_name, m.file_paths, m.tags, m.confidence,
      m.conditions, m.phases, m.cross_system_refs,
      m.examples, m.execution_flow,
      m.created_at, m.updated_at,
      m.referenced_date, m.relative_date,
      wc.sim as similarity,
      wc.chunk_index, wc.chunk_text
    from winning_chunks wc
    join memories m on m.id = wc.memory_id
    order by wc.sim desc
    limit p_limit;
end;
$$ language plpgsql security definer stable set search_path = public, extensions;

-- ============================================================
-- Manual smoke-test steps (no automated SQL test harness in this repo).
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
-- 3. Insert a long (15K-char) memory via Task 9's write path (so it gets
--    both a pooled embedding on `memories` and per-chunk rows on
--    `memory_chunks`), then confirm:
--      select id, similarity, chunk_index, chunk_text
--        from chunk_semantic_recall('<project_id>'::uuid, '<query embedding>'::vector, null, 5, 0.3);
--    Expect: the long memory is returned (with a specific, correct
--    chunk_index/chunk_text — the passage actually containing the
--    answer, not an arbitrary chunk from the same memory) for a short
--    natural-language query where `semantic_recall` (pooled-vector-only)
--    returns nothing for the same query/project.
--
-- 4. DISTINCT ON / cross-memory ORDER BY correctness check: with two or
--    more long memories in the same project each contributing multiple
--    matching chunks, confirm the result set has at most ONE row per
--    memory_id (winning_chunks' DISTINCT ON (memory_id) is doing its job)
--    and that those one-row-per-memory results are globally ordered by
--    similarity DESC across memories (the outer query's ORDER BY, not the
--    inner CTE's memory_id-first ordering).
--
-- 5. This task's own E2E credit is this manual SQL smoke test in
--    isolation — the LongMemEval harness delta is claimed jointly with
--    Task 11 (CLI/MCP-server wiring), not double-counted here.
-- ============================================================
