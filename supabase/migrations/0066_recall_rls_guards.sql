-- ============================================================
-- Tages — Recall RPC access guards (HIGH-severity RLS bypass)
--
-- All four recall RPCs are SECURITY DEFINER (so they run as the function
-- owner and bypass RLS on `memories` / `memory_chunks`) and filter ONLY on
-- the caller-supplied `p_project_id`. None of them checks `auth.uid()`.
-- Any authenticated user who learns or guesses a project UUID can therefore
-- read every memory in that project:
--
--   recall_memories        — live definition: 0061_word_similarity_recall_fix.sql:73-130
--   semantic_recall        — live definition: 0060_temporal_date_anchoring.sql:136-184
--   hybrid_recall          — live definition: 0062_hybrid_recall_rrf_fusion.sql:77-177
--   chunk_semantic_recall  — live definition: 0064_chunk_aware_recall.sql:56-129
--
-- This is the same class of hole migration 0051_team_rbac_hardening.sql (H3)
-- closed on `list_unresolved_conflicts` and `get_memory_authors`. This
-- migration applies 0051's guard, unchanged, to the four recall RPCs.
--
-- ------------------------------------------------------------
-- The guard (copied from 0051_team_rbac_hardening.sql:139-145, lowercased
-- to match the surrounding recall-migration style; the predicate itself is
-- character-for-character the same expression):
--
--   if not exists (
--     select 1 from projects p
--     where p.id = p_project_id
--       and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
--   ) then
--     return;
--   end if;
--
-- BOTH branches are load-bearing and neither may be dropped. Migration 0053
-- exists precisely because 0051 dropped the owner OR-branch from
-- `is_project_member` and locked project owners out of their own memories.
-- `is_project_member` (current definition: 0053:11-29) already excludes
-- 'pending' and 'revoked' team_members and already carries its own owner
-- fallback — the explicit `p.owner_id = auth.uid()` branch here is the
-- belt-and-suspenders half of 0051's pattern and is kept verbatim rather
-- than "simplified away".
--
-- Placement: plpgsql early return, BEFORE `return query`. An unauthorized
-- caller gets ZERO rows (not an exception) — same silent-empty semantics as
-- `list_unresolved_conflicts`, and the same shape the callers already
-- handle for a no-match query. No WHERE clause is bolted onto any CTE, so
-- an AUTHORIZED caller's row set, scores and ordering are bit-identical to
-- today's.
-- ------------------------------------------------------------
--
-- Everything else in all four functions is carried forward verbatim from
-- the live definitions cited above: signatures (parameter names, types,
-- defaults), RETURNS TABLE column lists, every threshold, every CTE, every
-- filter, every ORDER BY, and `security definer stable
-- set search_path = public, extensions`. A changed signature or column list
-- would silently break the PostgREST call sites
-- (packages/cli/src/commands/recall.ts:223,246,253,
-- packages/cli/src/commands/query.ts:25,
-- packages/server/src/sync/supabase-sync.ts:435,461,495,
-- apps/dashboard/src/components/command-palette.tsx:49,
-- apps/dashboard/src/components/memory-table.tsx:97).
--
-- `CREATE OR REPLACE` with no preceding `DROP FUNCTION`: the signature and
-- the RETURNS TABLE shape are unchanged, so replace-in-place is legal here
-- and — unlike DROP + CREATE, which the 0060/0061/0062/0064 shape-changing
-- migrations had to use — it preserves the functions' existing EXECUTE
-- privileges rather than silently resetting them to the defaults.
--
-- plpgsql out-parameter shadowing (the 42702 trap called out in
-- 0062:167-168 and 0064:107-109): the guard references only `p.id`,
-- `p.owner_id` (both alias-qualified) and the `p_project_id` parameter. It
-- introduces no new variable, and no unqualified reference to any returned
-- column name (`id`, `project_id`, `key`, `value`, `type`, `source`,
-- `created_at`, `updated_at`, `similarity`, `match_type`, `chunk_index`,
-- `chunk_text`, ...). The alias `p` collides with no out-parameter.
--
-- *** KNOWN BEHAVIOR CHANGE — service-role callers ***
-- A SECURITY DEFINER function's internal `auth.uid()` check is an ordinary
-- predicate, NOT RLS, so the service role does not bypass it: under
-- `TAGES_SERVICE_KEY` (the CI/headless RLS-bypass path in
-- packages/cli/src/auth/session.ts:15-18) `auth.uid()` is NULL, both
-- branches evaluate false, and all four RPCs return zero rows. Interactive
-- CLI and MCP-server recall are unaffected — both set a real user session
-- (packages/cli/src/auth/session.ts:26 and packages/server/src/index.ts:123)
-- so `auth.uid()` is the end user. This matches how 0051's two guarded RPCs
-- already behave; adding a `service_role` escape hatch here would deviate
-- from the sanctioned pattern, so it is deliberately NOT done in this
-- migration and is flagged for a separate decision.
--
-- *** TARGET *** Verify the linked project before applying:
--   supabase migration list --linked
-- Migrations 0062-0064 are DEV-only (ugogdqzhhnuzwgcaovty); prod
-- (wezagdgpvwfywjoxztfs) is still on 0060, where `hybrid_recall` and
-- `chunk_semantic_recall` do not exist in the form recreated below. Do not
-- push this to prod ahead of 0061-0064.
-- ============================================================

-- pgvector's `vector` type lives in the `extensions` schema and the
-- migration session's search_path does not include it by default, so the
-- CREATE FUNCTION statements below (three of the four reference
-- vector(1536) in their signatures) must widen search_path to resolve it at
-- DDL time. Same reason as 0060/0061/0062/0064.
set search_path = public, extensions;

-- ------------------------------------------------------------
-- 1. recall_memories — live definition from
--    0061_word_similarity_recall_fix.sql:73-130, reproduced verbatim with
--    only the access guard added before `return query`.
-- ------------------------------------------------------------
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
  -- Verify caller has access to the project
  if not exists (
    select 1 from projects p
    where p.id = p_project_id
      and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
  ) then
    return;
  end if;

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
-- 2. semantic_recall — live definition from
--    0060_temporal_date_anchoring.sql:136-184, reproduced verbatim with
--    only the access guard added before `return query`.
-- ------------------------------------------------------------
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
  -- Verify caller has access to the project
  if not exists (
    select 1 from projects p
    where p.id = p_project_id
      and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
  ) then
    return;
  end if;

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
$$ language plpgsql security definer stable set search_path = public, extensions;

-- ------------------------------------------------------------
-- 3. hybrid_recall — live definition from
--    0062_hybrid_recall_rrf_fusion.sql:77-177 (the RRF-fusion rewrite, NOT
--    the superseded 0061 UNION ALL / DISTINCT ON version), reproduced
--    verbatim with only the access guard added before `return query`.
--    The guard is a standalone early return: it is deliberately NOT bolted
--    onto trigram_scored/vector_scored as an extra WHERE branch, which
--    would change each leg's candidate set and therefore its RANK() and the
--    fused RRF scores.
-- ------------------------------------------------------------
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
  -- Verify caller has access to the project
  if not exists (
    select 1 from projects p
    where p.id = p_project_id
      and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
  ) then
    return;
  end if;

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

-- ------------------------------------------------------------
-- 4. chunk_semantic_recall — live definition from
--    0064_chunk_aware_recall.sql:56-129, reproduced verbatim with only the
--    access guard added before `return query`. Note this RPC reaches
--    `memory_chunks` (0063) as well as `memories`; the guard is on the
--    project, which covers both, since matched_chunks filters
--    `c.project_id = p_project_id`.
-- ------------------------------------------------------------
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
  -- Verify caller has access to the project
  if not exists (
    select 1 from projects p
    where p.id = p_project_id
      and (p.owner_id = auth.uid() or is_project_member(auth.uid(), p.id))
  ) then
    return;
  end if;

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
-- Manual smoke-test steps (no automated SQL test harness in this repo —
-- same convention as 0060/0061/0062/0064).
--
-- Apply to the DEV Supabase project ONLY — never prod:
--
-- 0. Confirm the target is DEV before applying:
--      supabase migration list --linked
--    (project ref must be ugogdqzhhnuzwgcaovty — NOT wezagdgpvwfywjoxztfs)
--    Then:  supabase db push
--
-- 1. Confirm no signature drifted. All four must come back with the exact
--    argument list and RETURNS TABLE column list they had before:
--      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--             pg_get_function_result(p.oid) as result,
--             p.prosecdef, p.provolatile, p.proconfig
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('recall_memories','semantic_recall',
--                          'hybrid_recall','chunk_semantic_recall');
--    Expect per row: prosecdef = t (security definer), provolatile = 's'
--    (stable), proconfig = {"search_path=public, extensions"}.
--
-- 2. Confirm EXECUTE privileges survived the replace (CREATE OR REPLACE
--    preserves them; this is the check that proves it):
--      select proname, proacl from pg_proc
--      where proname in ('recall_memories','semantic_recall',
--                        'hybrid_recall','chunk_semantic_recall');
--
-- ------------------------------------------------------------
-- 3. The a/b/c authorization matrix — run all THREE roles against ALL FOUR
--    RPCs (12 cells). Each RPC is invoked exactly as its caller invokes it,
--    through PostgREST as the given user (not as postgres/service_role —
--    a service-role session has auth.uid() = NULL and is expected to
--    return zero rows, see the header's known-behavior-change note).
--
--    Fixtures needed:
--      PROJ   — a project UUID that has >= 1 live memory and (for
--               chunk_semantic_recall) >= 1 row in memory_chunks
--      OWNER  — the auth.users row where projects.owner_id = OWNER
--      MEMBER — a team_members row (PROJ, MEMBER, status = 'active')
--      OUTSID — an authenticated user who is NOT the owner and has NO
--               team_members row for PROJ (or only a 'pending'/'revoked'
--               one — both must fail)
--      EMB    — a 1536-dim query embedding known to match in PROJ
--      Q      — a query string known to match in PROJ
--
--    Capture the BASELINE first, before applying this migration, for each
--    of the four calls below as OWNER: save the full ordered result set
--    (ids, similarity, and match_type / chunk_index where present).
--
--    (a) OWNER — results must be UNCHANGED vs baseline (same rows, same
--        similarity values, same order):
--          select id, similarity from recall_memories(PROJ, Q, null, 30);
--          select id, similarity from semantic_recall(PROJ, EMB, null, 30, 0.3);
--          select id, similarity, match_type from hybrid_recall(PROJ, Q, EMB, null, 30);
--          select id, similarity, chunk_index, chunk_text
--            from chunk_semantic_recall(PROJ, EMB, null, 30, 0.3);
--        Expect: byte-identical to baseline for all four. Any drift in row
--        set, score or ordering means the guard leaked into the query body
--        — reject.
--
--    (b) MEMBER (status = 'active') — same four calls, same expectation:
--        identical row set / scores / ordering to (a). This is the branch
--        migration 0053 had to restore after 0051 broke it; a MEMBER pass
--        with an OWNER fail (or vice versa) means one OR-branch was
--        dropped.
--
--    (c) OUTSID — same four calls:
--        Expect: ZERO rows from all four, for the same PROJ/Q/EMB that
--        returned data in (a) and (b). No exception is raised — an empty
--        result is the intended contract. Before this migration the same
--        four calls as OUTSID returned the full (a) row set; that delta IS
--        the vulnerability being closed, so run (c) once BEFORE applying to
--        confirm the leak reproduces, and again after to confirm it closed.
--
--    (c') OUTSID variants that must ALSO return zero rows — these prove the
--         guard inherits is_project_member's status filter (0051 item a):
--           - a team_members row for PROJ with status = 'pending'
--           - a team_members row for PROJ with status = 'revoked'
--
-- 4. Regression sweep on the callers, as OWNER, after applying:
--      tages recall "<Q>"                      (CLI: recall_memories +
--                                               semantic_recall +
--                                               chunk_semantic_recall)
--      MCP `recall` tool against PROJ          (server: recall_memories,
--                                               hybrid_recall,
--                                               chunk_semantic_recall)
--      dashboard command palette + memory table (recall_memories)
--    Expect: same results as before the migration, no 42702 ("column
--    reference is ambiguous") and no 42883 ("function does not exist" —
--    which would mean a signature drifted).
-- ============================================================
