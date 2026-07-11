-- ============================================================
-- Tages — memory_chunks child table (Two-Stage Retrieval plan, Task 8,
-- PLAN.md lines 953-960)
--
-- Phase 2 (multi-vector chunk storage): a new child table holding one row
-- per fixed-size chunk of a memory's `value`, each with its own embedding,
-- to structurally fix the mean-pool dilution behind the 11/50 zero-hit
-- LongMemEval questions (long single-session haystacks where a single
-- pooled vector per memory dilutes past any usable similarity threshold).
-- Written to by Task 9 (packages/server/src/embeddings.ts /
-- packages/cli/src/lib/embedding.ts generateChunkEmbeddings + the
-- remember write paths), read by Task 10's chunk_semantic_recall RPC
-- (migration 0064).
--
-- HNSW index mirrors `memories.embedding`'s own index exactly, per
-- supabase/migrations/0008_pgvector.sql lines 12-15 (same operator class,
-- same m/ef_construction params) — no new indexing strategy invented here.
--
-- RLS: mirrors the memories table's CURRENT live policies, not the 0002
-- baseline. Diffed this session against every migration touching memories'
-- policies (0002_rls_policies.sql, 0031_rbac_write_policies.sql,
-- 0034_pricing_restructure.sql, 0045_tier_aware_memory_limits.sql,
-- 0054_draft_memory_phase_1.sql — the last three only replace memories'
-- INSERT policy's quota arithmetic, they don't change the RBAC guard or
-- touch SELECT/UPDATE/DELETE):
--   - SELECT: "Members can read project memories" (0002, untouched since)
--     — using is_project_member(auth.uid(), project_id).
--   - INSERT/UPDATE/DELETE: 0031 dropped 0002's member-level write
--     policies and replaced them with is_write_authorized(auth.uid(),
--     project_id) — owner or team_members.role in ('owner','admin') only.
--     0034/0045/0054 only ever replaced the INSERT policy's per-tier quota
--     count, the is_write_authorized(...) RBAC guard itself has been
--     unchanged since 0031. UPDATE/DELETE have been is_write_authorized-
--     gated, unmodified, since 0031.
-- memory_chunks policies below mirror this CURRENT (post-0031) state: read
-- is project-membership-gated, all writes are write-authorized-gated. The
-- per-tier memory-count quota logic (0034/0045/0054) is deliberately NOT
-- replicated here — chunk rows are a derived, auto-managed side effect of
-- writing a memory (Task 9's write path), not a separately quota-limited
-- entity a user creates directly; gating chunk writes on the same
-- is_write_authorized(...) RBAC check without also re-deriving a
-- chunk-count quota is not a silent reversion to the looser 0002 baseline
-- (0002 never had a write RBAC guard on memories at all — is_write_
-- authorized did not exist until 0031). This is stated explicitly per the
-- plan's pre-mortem on this exact bug class (feedback_rls_function_diff /
-- the owner-OR-branch-dropped incident referenced in project memory).
--
-- Session-level search_path widened for the same reason as 0060/0061:
-- pgvector's `vector` type lives in the `extensions` schema, and the DDL
-- below references vector(1536) in the CREATE TABLE statement.
--
-- *** DEV ONLY *** — applies to ugogdqzhhnuzwgcaovty only, per this plan's
-- Scope section. Do NOT apply to prod (wezagdgpvwfywjoxztfs).
-- ============================================================

set search_path = public, extensions;

create table memory_chunks (
  id          uuid primary key default gen_random_uuid(),
  memory_id   uuid not null references memories(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  chunk_index int not null,
  chunk_text  text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

create index memory_chunks_memory_id_idx on memory_chunks(memory_id);

-- HNSW index — mirrors memories_embedding_idx (0008_pgvector.sql:13-15)
-- exactly: same operator class, same m/ef_construction parameters.
create index memory_chunks_embedding_idx
  on memory_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table memory_chunks enable row level security;

-- -----------------------------------------------------------
-- memory_chunks RLS — mirrors memories' CURRENT (post-0031) policies.
-- Reuses the existing is_project_member (0002) and is_write_authorized
-- (0031) helper functions; no new helper defined here.
-- -----------------------------------------------------------
create policy "Members can read project memory chunks"
  on memory_chunks for select
  using (is_project_member(auth.uid(), project_id));

create policy "Write-authorized users can insert memory chunks"
  on memory_chunks for insert
  with check (is_write_authorized(auth.uid(), project_id));

create policy "Write-authorized users can update memory chunks"
  on memory_chunks for update
  using (is_write_authorized(auth.uid(), project_id));

create policy "Write-authorized users can delete memory chunks"
  on memory_chunks for delete
  using (is_write_authorized(auth.uid(), project_id));

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
-- 3. Confirm table/indexes/RLS via information_schema:
--      select column_name, data_type from information_schema.columns
--        where table_name = 'memory_chunks';
--      select indexname from pg_indexes where tablename = 'memory_chunks';
--      select polname, polcmd from pg_policies where tablename = 'memory_chunks';
--
-- 4. Real insert-as-authenticated-user smoke test: as a project owner,
--    insert a chunk row for an existing memory_id and confirm it succeeds;
--    as a user who is NOT a project member, confirm the same insert is
--    rejected by RLS (0 rows affected / permission error, not a silent
--    cross-tenant write); as a member with role 'member' (not owner/admin
--    in team_members), confirm insert/update/delete are all rejected but
--    select succeeds — this is the specific "owners locked out" /
--    "non-owners silently allowed to write" class of bug this table's RLS
--    mirror must NOT reproduce.
-- ============================================================
