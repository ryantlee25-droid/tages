# Plan: Tages 12–18 Month Differentiation Execution
_Created: 2026-04-19 | Type: New Feature + Migration_

---

## Executive Summary

- **What this delivers:** Four shipped, launch-worthy bets — Memory Governance SKU (provenance + drift + cross-agent audit), AGENTS.md-native CLI (write/audit/diff/federate), dual reproducible benchmarks (LongMemEval + coding-specific), and cross-tool plugin parity (Cursor, Codex, Gemini alongside existing Claude Code).
- **Pre-launch hygiene gates everything.** The "9.1/10 vs 2.8/10" README claim, stale counts, unpublished npm packages, and worktree debris must be cleared before any positioning work goes public. All of Phase 0.
- **Bet D (plugin parity) is config-file work, not engineering.** Per deep-research-execution Q13–16: Cursor + Codex + Gemini install are JSON/TOML snippets. Estimated under 1 week. Ship early, ship cheap.
- **Bet B (AGENTS.md) has the largest genuine whitespace.** Per deep-research-execution Q5–8: no linters, validators, or generators for AGENTS.md exist. First-mover opportunity.
- **Bet A is narrowed.** Mem0 is SOC 2 Type I + HIPAA + "audit-ready logs." Tages differentiates on memory-specific governance (field-level provenance, cross-agent consistency, drift detection) — not generic enterprise audit. Per deep-research-execution Finding 1.
- **Bet C partners before rebuilding.** Stompy (MIT, MCP-based, paused post-Phase 3) is the fork/partner target. Adding Tages as a condition is config + prompts work. Per deep-research-execution Q10.
- **What is explicitly cut:** personal/single-user memory marketing, temporal knowledge graphs, multi-modal memory, general-agent memory. Per positioning.md §4.

---

## Phase 0 — Pre-Launch Hygiene
_Gate: must complete before any Phase 1 public surface goes live_

### P0.1 — Strip "9.1/10 vs 2.8/10" README benchmark claim
- **Files:** `README.md` (lines containing "9.1/10 vs 2.8/10")
- **Replace with:** a forward-pointing sentence: "Reproducible LongMemEval and coding-memory benchmark results published at `/eval/`."
- **Owner:** Ryan
- **Verify:** `grep "9.1/10" README.md` returns no output
- **Effort:** 30 minutes
- **Ref:** positioning.md §9 item 1; trend-scan §6

### P0.2 — Update README stat counts
- **Files:** `README.md`
- **Update:** 56 MCP tools (was correct), 53 CLI commands (not 52), 618 tests (not 521)
- **Owner:** Ryan
- **Verify:** `pnpm test --reporter=verbose 2>&1 | tail -3` shows ≥618 passing; `ls packages/cli/src/commands/*.ts | wc -l` matches
- **Effort:** 30 minutes
- **Ref:** positioning.md §9 item 2

### P0.3 — Tag and publish v0.2.1 / v0.1.1 to npm
- **Files:** `.github/workflows/ci.yml` (add publish job), `packages/cli/package.json`, `packages/server/package.json`, `packages/shared/package.json`
- **Work:** Add an `on: push: tags: ['v*']` publish job to `ci.yml` that runs `pnpm --filter @tages/cli publish --no-git-checks`, same for server and shared. Add `NPM_TOKEN` secret.
- **Owner:** Ryan
- **Verify:** `npm view @tages/cli version` returns `0.2.1`; `npm view @tages/server version` returns `0.1.1`
- **Effort:** 2 hours
- **Ref:** positioning.md §9 item 3; competitive-analysis.md §6 "credibility red flag"

### P0.4 — Worktree and untracked file cleanup
- **Files:** `.claude/worktrees/` (delete stale directories), all 12 untracked files (review + either delete or commit)
- **Owner:** Ryan
- **Verify:** `git status` shows clean working tree; `git worktree list` shows only main
- **Effort:** 30 minutes
- **Ref:** positioning.md §9 item 4

---

## Phase 1 — Credibility Foundation
_Target: 2026-05-04 (~2 weeks from today)_

### 1.1 — LongMemEval harness at `/eval/longmemeval/`
- **Files created:**
  - `eval/longmemeval/README.md` — methodology, judge config, reproduction steps
  - `eval/longmemeval/run.ts` — harness script (LongMemEval oracle split, GPT-4o judge, RetainDB methodology per deep-research-execution Q9)
  - `eval/longmemeval/results/tages-run-001.json` — first Tages run output
  - `eval/longmemeval/notebook.ipynb` — published results notebook
- **Methodology:** RetainDB pattern exactly — turn-by-turn extraction, 3-turn context window, GPT-4o judge at temp=0, exact prompts in appendix. Per deep-research-execution Q9.
- **Target accuracy:** ≥80% overall LongMemEval_s (Supermemory baseline is 81.6% on GPT-4o, RetainDB is 79%). If first run lands below 70%, surface immediately — this is a flip signal per trend-scan §"What Would Flip the Call."
- **Owner:** Ryan + Claude Code
- **Verify:** `npx ts-node eval/longmemeval/run.ts --dry-run` completes without error; `eval/longmemeval/results/tages-run-001.json` contains `overall_accuracy` field ≥0.80
- **Effort:** M (1 day) — depends on LongMemEval dataset availability
- **Pre-mortem:** Will take longer if LongMemEval oracle dataset requires academic license or if Tages retrieval stack underperforms. Mitigation: run calibration with 50-question subset first.
- **Ref:** trend-scan §6; deep-research-execution Q9; positioning.md §3 Bet C

### 1.2 — Stompy outreach issue
- **Action:** Open a GitHub issue on `github.com/banton/stompy-benchmark` asking about adding a Tages MCP condition (new `.mcp.json` + `tages-condition/` prompts directory). Per deep-research-execution Finding 3.
- **Files:** None in repo — external action
- **Owner:** Ryan
- **Verify:** GitHub issue URL documented in `docs/benchmark-partnerships.md`
- **Effort:** 1 hour
- **Ref:** deep-research-execution Q10, Finding 3; positioning.md §3 Bet C

### 1.3 — "Tages Security & Governance" page (draft)
- **Files created:**
  - `apps/dashboard/src/app/(marketing)/governance/page.tsx` — trust-center-style page
- **Content:** Memory audit log schema (every field defined), retention policy (default + configurable range), export formats (JSON + CSV), erasure procedure, encryption posture (AES-256-GCM opt-in), RBAC model, provenance model (agent session + user + timestamp per memory write). Per deep-research-execution Q1.
- **This is a draft** (internal review only until Phase 2 public launch). Publish URL behind no-index until Phase 2.
- **Owner:** Ryan (content); Claude Code (page scaffold)
- **Verify:** `curl http://localhost:3000/governance` returns 200; page renders all schema fields
- **Effort:** M (1 day)
- **Ref:** deep-research-execution Q1, Q3; positioning.md §3 Bet A

---

## Phase 2 — Distribution + Positioning Goes Public
_Target: 2026-05-20 (~30 days from today)_

### 2.1 — @tages/cursor-plugin
- **Files created:**
  - `packages/cursor-plugin/package.json`
  - `packages/cursor-plugin/index.ts` — emits `.cursor/mcp.json` snippet to stdout
  - `packages/cursor-plugin/README.md` — includes "Add to Cursor" deep-link (`cursor://`) and cursor.directory submission instructions
  - `docs/cursor-setup.md` — updated with plugin install one-liner (this file already exists; update it)
- **What it does:** Generates the `.cursor/mcp.json` config block pointing at `@tages/server` via stdio. Identical config shape as Claude Code plugin per deep-research-execution Q13. Also submit entry to cursor.directory.
- **Owner:** Ryan + Claude Code
- **Verify:** `npx @tages/cursor-plugin` writes valid `.cursor/mcp.json`; Cursor loads Tages tools after restart
- **Effort:** S (2–3 hours)
- **Ref:** deep-research-execution Q13; positioning.md §3 Bet D

### 2.2 — `tages agents-md write` and `tages agents-md audit`
- **Files created:**
  - `packages/cli/src/commands/agents-md.ts` — commander subcommand group with `write`, `audit`, `diff`, `federate` sub-subcommands (wire `write` and `audit` in Phase 2; `diff` and `federate` in Phase 3)
  - `packages/cli/src/__tests__/agents-md.test.ts`
  - `packages/server/src/agents-md/` — server-side generation logic (query memory store, project to 6 canonical sections per deep-research-execution Q5)
  - `packages/server/src/agents-md/__tests__/`
- **`tages agents-md write`:** Reads Tages memory for the current project, maps to 6 canonical AGENTS.md sections (Commands, Testing, Project structure, Code style, Git workflow, Boundaries), emits AGENTS.md with three-tier Always/Ask/Never boundaries section. Per deep-research-execution Q5.
- **`tages agents-md audit`:** Reads committed AGENTS.md, runs anti-pattern linter (vagueness detector, missing-commands check, missing-boundaries check, missing-tech-stack-versions check). Per deep-research-execution Q5.
- **Owner:** Ryan + Claude Code
- **Verify:** `tages agents-md write --dry-run` emits valid Markdown with all 6 sections; `tages agents-md audit` exits 1 on a deliberately vague AGENTS.md fixture; `pnpm --filter @tages/cli test -- agents-md` passes
- **Effort:** L (2 days) — first new CLI command group; requires server-side generation logic
- **Pre-mortem:** Will take longer if memory-to-section mapping requires LLM calls (adds latency + cost). Mitigation: make LLM call optional (structured-memory-only path for `write`, regex-only linting for `audit`).
- **Ref:** deep-research-execution Q5–Q6; positioning.md §3 Bet B; trend-scan §3

### 2.3 — "Memory Governance for Coding Teams" positioning page (public)
- **Files created/modified:**
  - `apps/dashboard/src/app/(marketing)/governance/page.tsx` — remove no-index; expand with full positioning content, comparison matrix from positioning.md §5
  - `apps/dashboard/src/app/(marketing)/page.tsx` — add governance link to homepage nav
- **Owner:** Ryan
- **Verify:** `curl https://tages.ai/governance` returns 200; page is indexed (no `noindex` meta)
- **Effort:** S (2–3 hours, most content written in Phase 1)
- **Ref:** positioning.md §3 Bet A; positioning.md §6 messaging ladder

### 2.4 — Stompy Tages-condition PR (or adapter contribution)
- **Files created:**
  - `eval/stompy/tages-condition/mcp.json` — Tages MCP server config for Stompy harness
  - `eval/stompy/tages-condition/prompts/` — Tages-specific system prompt modifications per Stompy Phase 3 architecture
  - `eval/stompy/README.md` — documents how to run Stompy with the Tages condition
- **Action:** Open PR on `banton/stompy-benchmark` with Tages adapter. If maintainer unresponsive to Phase 1 issue, fork at `tages/stompy-benchmark` instead.
- **Owner:** Ryan + Claude Code
- **Verify:** `cd eval/stompy && npm run benchmark -- --condition tages` completes one moderate-complexity task run
- **Effort:** M (1 day, contingent on Stompy harness being runnable locally)
- **Pre-mortem:** Stompy is paused; maintainer may be unresponsive or codebase bitrotted. Mitigation: fork at Phase 2 if no response to Phase 1 issue within 14 days.
- **Ref:** deep-research-execution Q10, Finding 3

### 2.5 — Provenance model documentation
- **Files created:**
  - `docs/provenance-model.md` — formal specification: every memory write records `agent_id`, `session_id`, `user_id`, `tool_name`, `timestamp`, `source_context` (file/PR/ticket reference). Per deep-research-execution Finding 2.
  - `supabase/migrations/0057_provenance_fields.sql` — migration to add `agent_id TEXT`, `session_id TEXT`, `source_context JSONB` columns to `memories` table if not already present; RLS policy update
  - `packages/shared/src/types.ts` — add `ProvenanceFields` interface
- **Owner:** Ryan + Claude Code
- **Verify:** `pnpm typecheck` passes; `supabase migration up` succeeds; `tages recall --show-provenance` outputs provenance fields per memory; `pnpm --filter @tages/server test -- provenance` passes
- **Effort:** M (1 day)
- **Ref:** deep-research-execution Finding 2, Q1; positioning.md §3 Bet A

---

## Phase 3 — Feature Completeness
_Target: 2026-06-19 (~60 days from today)_

### 3.1 — @tages/codex-plugin and @tages/gemini-plugin
- **Files created:**
  - `packages/codex-plugin/package.json`
  - `packages/codex-plugin/index.ts` — emits `codex mcp add tages -- npx -y @tages/server` one-liner and TOML config block
  - `packages/codex-plugin/README.md`
  - `packages/gemini-plugin/package.json`
  - `packages/gemini-plugin/index.ts` — emits `.gemini/settings.json` `mcpServers` block
  - `packages/gemini-plugin/README.md`
  - `docs/codex-setup.md` — update existing file with plugin install
  - `docs/gemini-setup.md` — update existing file with plugin install
- **Owner:** Ryan + Claude Code
- **Verify:** `npx @tages/codex-plugin` outputs valid TOML config; `npx @tages/gemini-plugin` outputs valid JSON; `codex mcp add tages -- npx -y @tages/server` installs Tages tools in Codex; Gemini CLI loads Tages tools after config update
- **Effort:** S (2–3 hours combined, per deep-research-execution Q14–Q16)
- **Ref:** deep-research-execution Q14, Q15, Q16; positioning.md §3 Bet D

### 3.2 — `tages agents-md diff` and `tages agents-md federate`
- **Files modified:**
  - `packages/cli/src/commands/agents-md.ts` — add `diff` and `federate` subcommands
  - `packages/server/src/agents-md/` — add diff logic (memory-state vs committed AGENTS.md); add federated section-ownership logic
  - `packages/cli/src/__tests__/agents-md.test.ts` — extend test coverage
- **`tages agents-md diff`:** Compares current Tages memory state against committed `AGENTS.md`. Shows which sections are stale or missing. Per deep-research-execution Q8.
- **`tages agents-md federate`:** Assigns section ownership (team → section mapping stored in `.tages/agents-md-owners.json`). On `tages agents-md write`, only the owning team's memories feed each section. Per deep-research-execution Q8.
- **Owner:** Ryan + Claude Code
- **Verify:** `tages agents-md diff` exits 1 when a fixture memory contradicts the committed AGENTS.md; `tages agents-md federate --section "Security" --team security` updates `.tages/agents-md-owners.json`; `pnpm --filter @tages/cli test -- agents-md` passes all new cases
- **Effort:** M (1 day)
- **Ref:** deep-research-execution Q8; positioning.md §3 Bet B

### 3.3 — `tages drift` command
- **Files created:**
  - `packages/cli/src/commands/drift.ts`
  - `packages/server/src/drift/` — ASI-style metric computation (per deep-research-execution Q12: semantic drift, coordination drift, behavioral drift adapted for multi-agent coding team)
  - `packages/server/src/drift/__tests__/`
  - `packages/cli/src/__tests__/drift.test.ts`
- **What it does:** Given a project with 2+ developers' agent sessions, compute and report the Agent Stability Index metrics: which memory keys are diverging across agents, which have been written by conflicting sessions, which have not been propagated across federation. Outputs JSON + human-readable summary.
- **Owner:** Ryan + Claude Code (ML advisor review recommended for ASI metric weights)
- **Verify:** `tages drift --project <slug>` runs against a fixture project with seeded conflicting memories and outputs a `drift_score` field; `pnpm --filter @tages/server test -- drift` passes; `pnpm --filter @tages/cli test -- drift` passes
- **Effort:** L (2 days — novel metric implementation, no prior art in Tages codebase)
- **Pre-mortem:** ASI metric weights are research-grade (arxiv:2601.04170); productizing them will require calibration against real multi-agent sessions. Risk: metrics are noisy on small teams. Mitigation: ship with explicit "pilot / experimental" label; gather feedback from Phase 4 design partners.
- **Ref:** deep-research-execution Q12, Finding 7; positioning.md §3 Bet A

### 3.4 — Coding-memory benchmark open-sourced at `/eval/coding-memory/`
- **Files created:**
  - `eval/coding-memory/README.md` — methodology, fixture description, judge config, reproduction steps
  - `eval/coding-memory/harness.ts` — benchmark runner (given repo fixture with historical decisions, measure typed-recall precision: "what is the convention for API error responses", "which anti-pattern was flagged in PR 312")
  - `eval/coding-memory/fixtures/` — curated repo fixture (subset or derivative of Stompy's 4,895-LoC FastAPI codebase or a new Tages-native fixture)
  - `eval/coding-memory/results/tages-run-001.json`
  - `eval/coding-memory/notebook.ipynb`
- **Metrics:** cost per task, turns per task, quality score (LLM judge), typed-recall precision by memory type. Per deep-research-execution Q10 Finding 4 ("cost + turns + quality at fixed task complexity").
- **Owner:** Ryan + Claude Code (contingent on Stompy adapter success in Phase 2)
- **Verify:** `npx ts-node eval/coding-memory/harness.ts --dry-run` completes; results notebook is runnable end-to-end; `eval/coding-memory/results/tages-run-001.json` contains `cost_savings_pct` and `quality_score` fields
- **Effort:** L (2 days — fixture curation is the long pole)
- **Pre-mortem:** If Stompy fork is not clean enough to adapt, must build fixture from scratch. Mitigation: start fixture curation in parallel with Phase 2 Stompy work.
- **Ref:** deep-research-execution Q10, Finding 3–4; positioning.md §3 Bet C

### 3.5 — Third-party SECURITY.md review commissioned
- **Action:** Engage a security auditor or trusted peer reviewer to review `SECURITY.md`, the `/governance` page content, and the audit log schema for accuracy and completeness.
- **Files modified post-review:**
  - `SECURITY.md`
  - `apps/dashboard/src/app/(marketing)/governance/page.tsx`
- **Owner:** Ryan (procurement); external auditor/reviewer
- **Verify:** Reviewer sign-off documented in `docs/security-review-2026-06.md`; no open critical findings
- **Effort:** M (1 day Ryan time; 1–2 weeks calendar time)
- **Ref:** competitive-analysis.md §10 "Fix: Security story"; positioning.md §3 Bet A; trend-scan §5

---

## Phase 4 — Enterprise Layer
_Target: 2026-07-19 (~90 days from today)_

### 4.1 — Stacklok ToolHive compat guide
- **Files created:**
  - `docs/toolhive-compat.md` — step-by-step guide for running Tages behind ToolHive vMCP: which tool names to allowlist, how Tages's RBAC interacts with ToolHive's K8s RBAC, OTel passthrough configuration
- **Prerequisite spike:** Run Tages behind ToolHive locally for 1 day to confirm compatibility (deep-research-execution validation item 6).
- **Owner:** Ryan + Claude Code
- **Verify:** A Tages MCP session running behind `thv run` successfully executes `tages_recall` and `tages_remember` tools; guide reviewed by at least one ToolHive community member
- **Effort:** M (1 day: spike + doc)
- **Ref:** deep-research-execution Q4, Finding 6; trend-scan §5

### 4.2 — Memory Governance SKU live in Stripe + dashboard
- **Files modified:**
  - `supabase/migrations/0058_governance_tier.sql` — add `governance` plan tier; update RLS + tier-gate logic
  - `apps/dashboard/src/app/app/upgrade/page.tsx` — add Governance tier card ($39–$69/seat/mo per deep-research-execution Q2)
  - `apps/dashboard/src/app/(marketing)/pricing/page.tsx` — add Governance tier
  - `apps/dashboard/src/lib/stripe.ts` — add Governance price IDs
  - `packages/shared/src/types.ts` — add `'governance'` to plan tier enum
- **Gating:** `tages drift`, audit log export (JSON + CSV), provenance fields in recall output, cross-agent consistency report. Features available on Team plan become unrestricted; Governance adds drift + export.
- **Owner:** Ryan + Claude Code
- **Verify:** `stripe products list` shows Governance product; dashboard upgrade flow completes Stripe checkout; `tages drift` returns 402 on a Team-plan project; `pnpm --filter dashboard test -- governance` passes
- **Effort:** L (2 days — Stripe + RLS + UI surface)
- **Pre-mortem:** Tier gating logic requires RLS policy updates across memory and audit tables. Risk: policy error locks out existing users. Mitigation: deploy behind a feature flag; test with a staging project before prod migration.
- **Ref:** deep-research-execution Q2, Q10; positioning.md §3 Bet A

### 4.3 — First 3–5 design-partner teams onboarded on federation
- **Action:** Recruit 3–5 teams (Claude Code + Cursor shops, 5–20 devs). Give them Governance tier access. Run `tages drift` weekly. Collect structured feedback on federation breakage + drift metric utility.
- **Files created:**
  - `docs/design-partner-playbook.md` — onboarding guide, feedback template, weekly check-in format
- **Owner:** Ryan (GTM; this is not a code task)
- **Verify:** 3 teams with ≥2 active federation members in dashboard; at least 1 `tages drift` report reviewed with the team
- **Effort:** Ongoing (recruiting starts Phase 3; onboarding completes Phase 4)
- **Ref:** competitive-analysis.md §8 Axis 2 validation; deep-research-execution Q7

### 4.4 — SOC 2 Type I gap analysis started
- **Action:** Engage a SOC 2 readiness assessor. Provide them the audit log schema doc (from 1.3), provenance model doc (from 2.5), and SECURITY.md. Goal: gap report within Phase 4 window; full Type I audit on roadmap for Q4 2026 / Q1 2027.
- **Files created:**
  - `docs/soc2-gap-analysis-2026-07.md` — redacted summary of findings and remediation backlog
- **Owner:** Ryan (procurement); compliance assessor
- **Verify:** Gap analysis report delivered; at least one finding prioritized and tracked in GitHub issues
- **Effort:** M (2 days Ryan time; 3–4 weeks calendar time)
- **Ref:** deep-research-execution Q1, Q3; competitive-analysis.md §6.2 "Enterprise readiness"

---

## Dependencies & Sequencing

```
P0.1 → P0.2 → P0.3 → P0.4
                        ↓
                     Phase 1
              1.1 (LongMemEval)
              1.2 (Stompy outreach)
              1.3 (Governance page draft)
                        ↓
                     Phase 2
         2.1 (cursor-plugin) — no upstream dep beyond P0
         2.2 (agents-md write+audit) — no upstream dep beyond P0
         2.3 (governance page live) — depends on 1.3
         2.4 (Stompy PR) — depends on 1.2
         2.5 (provenance model) — no upstream dep beyond P0
                        ↓
                     Phase 3
         3.1 (codex + gemini plugins) — no dep beyond 2.1 pattern
         3.2 (agents-md diff+federate) — depends on 2.2
         3.3 (tages drift) — depends on 2.5 (provenance fields in DB)
         3.4 (coding-memory benchmark) — depends on 2.4 (Stompy)
         3.5 (security review) — depends on 1.3 + 2.5 content
                        ↓
                     Phase 4
         4.1 (ToolHive compat) — depends on 3.3 (OTel confirms)
         4.2 (Governance SKU) — depends on 3.3 + 2.5 + 3.5
         4.3 (design partners) — depends on 4.2 (tier gating live)
         4.4 (SOC 2 gap) — depends on 3.5 (third-party review done)
```

**Critical path:** P0 → 1.3 → 2.5 → 3.3 → 4.2. Everything else is parallelizable within its phase.

**Parallelizable within Phase 2:** 2.1, 2.2, 2.4, and 2.5 have no inter-dependencies. Run concurrently.

**File conflict check (Phase 2):**

| Task | Creates | Modifies |
|---|---|---|
| 2.1 | `packages/cursor-plugin/*` | `docs/cursor-setup.md` |
| 2.2 | `packages/cli/src/commands/agents-md.ts`, `packages/server/src/agents-md/*` | — |
| 2.3 | — | `apps/dashboard/src/app/(marketing)/governance/page.tsx` |
| 2.4 | `eval/stompy/*` | — |
| 2.5 | `supabase/migrations/0057_*.sql`, `packages/shared/src/types.ts` | — |

`packages/shared/src/types.ts` is shared infrastructure. Note: 2.5 modifies it; if any other Phase 2 task also needs a type addition, sequence behind 2.5 or coordinate.

---

## Validation Plan

Per deep-research-execution Validation Plan (10 items), updated with sequencing:

| # | Claim | Phase | Status | Validation |
|---|---|---|---|---|
| 1 | Mem0 audit log specifics are weaker than Tages provenance | Phase 1 | Unverified (Trust Center returned 429) | Manual fetch of trust.mem0.ai or support request — Ryan, 14 days |
| 2 | Stompy maintainer accepts Tages-condition PR | Phase 1→2 | Inferred | Phase 1.2: open GitHub issue; Phase 2.4: PR or fork |
| 3 | Tages ≥80% on LongMemEval_s | Phase 1 | Inferred | Phase 1.1: run harness, fail fast if <70% |
| 4 | Cursor Rules/AGENTS.md/Memories precedence | Phase 2 | Unverified | Ask on forum.cursor.com before shipping 2.2 |
| 5 | Claude Code org-skill provisioning is a competitor | Phase 2 | Inferred | Talk to one Claude Code Team admin before launching 2.3 messaging |
| 6 | Stacklok ToolHive integration is technically compatible | Phase 4 | Inferred | Phase 4.1 spike confirms; if incompatible, document workarounds |
| 7 | Governance SKU at $39–$69/seat/mo defensible | Phase 4 | Inferred | 3 pricing conversations with design partners before Phase 4.2 |
| 8 | Zep SOC 2 Type II is current in 2026 | Reference | Domain review needed | PM coach — request attestation letter from Zep sales |
| 9 | AGENTS.md coexistence story not already claimed | Ongoing | Unverified | Weekly monitor of agentsmd/agents.md repo + AAIF posts |
| 10 | LongMemEval + Stompy dual-publication sufficient for HN launch | Phase 3 | Inferred | Pre-launch review sprint with 3 trusted devs before HN post |

---

## What We Are Explicitly Not Doing

Per positioning.md §4:

- **Personal / single-user memory for a solo developer.** Mem0 OpenMemory and Claude Code auto-memory own this. Tages does not market there.
- **Temporal knowledge graphs with validity windows.** Zep / Graphiti own that architecture. Tages stays on trigram + pgvector + decay.
- **Multi-modal memory (images, audio, video).** Supermemory leads. Coding teams do not pay for this as a day-one requirement. Re-evaluate if a paying customer explicitly requests it.
- **General-agent memory (CRM, sales, support, AI-employee).** Mem0, Zep, Letta, Interloom, Reload will win that category. Tages is coding-specific, period.

---

## Flip Signals

Per positioning.md §10 and trend-scan §"What Would Flip the Call":

1. **Anthropic ships a cross-machine, per-user-attributed CLAUDE.md service** with audit logs and RBAC at content level. Monitor: Claude Code changelog monthly. If this ships, the team-memory governance pitch collapses. Immediate response: narrow to AGENTS.md tooling (Bet B) as primary bet.

2. **Mem0 ships a Team SKU** with shared memory graph, federation, and RBAC across developers. Monitor: mem0.ai/enterprise and blog. If this ships, differentiation requires accelerating the Governance SKU + provenance model to market before Mem0 iterates.

3. **Tages LongMemEval run lands below 70% overall accuracy.** This puts Tages visibly below Supermemory (81.6%) and RetainDB (79%). Forces either a retrieval-stack engineering sprint before any benchmark publication, or a narrower positioning that does not lead with accuracy claims.

4. **A competitor (Hmem, MemPalace, or a funded entrant) ships `agents-md write` before Phase 2.** Bet B's first-mover advantage evaporates. Accelerate 2.2 ahead of schedule; consider shipping a minimal `write` in Phase 1 if competitive signal emerges.

---

# Plan: Tier-1 Retrieval-Quality Fixes (Embedding Chunking + Temporal Anchoring)
_Created: 2026-07-09 | Type: Bug Fix + New Feature | Base branch: `main`_

Note on scope relative to the plan above: the earlier "Phase 0-4 Differentiation Execution" plan is a GTM/positioning roadmap from 2026-04-19 and is largely already superseded by shipped work (migrations 0057/0058 referenced there as "to create" are already merged on `main` as of this writing; current tip is 0059). It also states Tages "stays on trigram + pgvector + decay" and explicitly cuts "temporal knowledge graphs" — that statement is about *not* building a Zep/Graphiti-style knowledge-graph architecture for marketing positioning; it does not conflict with this plan's Task C, which adds two nullable date columns and recall-ordering logic, not a graph.

## Goal
Fix the confirmed long-input embedding silent-failure bug, ship a coherent token-aware chunking strategy for memory embeddings, and add 3-date temporal anchoring to recall — so long memories are always searchable and temporal-reasoning queries (Tages' 23–54% weak spot across every eval run) improve.

## Background
A LongMemEval-driven investigation (this session, confirmed empirically) found that `generateEmbedding()` in both `packages/cli/src/lib/embedding.ts` and `packages/server/src/embeddings.ts` POSTs the full memory text to OpenAI with no length guard. Text over ~8192 tokens gets HTTP 400, which the code silently converts to `return null` inside the fire-and-forget write path (`packages/server/src/tools/remember.ts`), so the memory is stored with **no embedding** and becomes invisible to semantic search — no error, no log, no signal to the user. Separately, the eval proved ingest chunk granularity dominates retrieval quality (per-turn 48%, whole-doc 10% — largely *because* of this bug, 4k-char chunks 78%), and temporal-reasoning accuracy never moved above ~54% regardless of embedder, motivating Mastra's 3-date anchoring approach (95.5% on their temporal-reasoning suite).

## Scope

**In scope:**
- `packages/cli/src/lib/embedding.ts`, `packages/server/src/embeddings.ts` — chunking, pooling, error handling
- `packages/server/src/tools/remember.ts`, `packages/cli/src/commands/remember.ts` — write-path integration
- `packages/server/src/tools/recall.ts`, `packages/cli/src/commands/recall.ts`, `packages/server/src/search/ranker.ts` — read-path integration
- `supabase/migrations/0060_*.sql` — new migration (schema is currently at 0059 on `main`)
- `packages/server/src/cache/sqlite.ts`, `packages/server/src/sync/supabase-sync.ts`, `packages/shared/src/types.ts` — schema mirrors
- `packages/server/scripts/backfill-embeddings.ts` — regression coverage only (no logic change expected)

**Out of scope:**
- `apps/dashboard` — no UI work for chunking or date display (not in the task's named scope)
- `eval/` (LongMemEval harness) — this plan is product-code only, per instructions
- CLI `remember` command's total lack of embedding generation (`packages/cli/src/commands/remember.ts` writes via `openCliSync`/`SupabaseSync.flush()` and never calls `generateEmbedding` at all — confirmed during Step 1 grep). This is a real, separate gap but is **not** the confirmed bug this plan targets. Flagged as a follow-on ticket, not fixed here.
- Multi-row (child-table) chunk storage — considered and explicitly rejected for Tier-1 in favor of pooling (see Task A/B rationale). Left as a documented Tier-2 follow-on.
- LLM-assisted date extraction for Task C — regex/rule-based only in this plan; LLM-assisted extraction flagged as Tier-2 follow-on.
- Full-production embedding backfill (existing `backfill-embeddings.ts` is explicitly scoped to one project at a time per its own header comment; not widened here).

**Ambiguities resolved:**
- Pooling vs multi-row storage for chunked embeddings → **pooling** (average + L2-renormalize into the existing single `memories.embedding` column). Justification: `generateEmbedding()`'s return signature (`number[] | null`) stays identical, so every call site (`scheduleEmbeddingSync` in `remember.ts`, `recall.ts` ×2, `backfill-embeddings.ts`) needs zero changes. Multi-row storage would require a new child table, new RPC joins, SQLite cache schema changes, and ranker aggregation logic — a much larger, higher-risk change for a Tier-1 ship. Only the tail of memories (value cap is 100,000 chars ≈ ~25K tokens ≈ 3-4x the 8192-token limit, per `packages/server/src/schemas.ts:28`) are ever affected, so precision loss from pooling is bounded.
- Where the write-time date extraction runs → inline/synchronous (not fire-and-forget like embeddings), because regex-based extraction is local/cheap with no network call, unlike embedding generation.
- Observation date → reuses the existing `memories.created_at` column; no new column needed for that leg of the 3-date model.

## Type Dependencies
- `Memory` interface in `packages/shared/src/types.ts:39` — Task C adds `referencedDate?: string` and `relativeDate?: string`. Consumed by `packages/server/src/tools/recall.ts`, `packages/server/src/tools/remember.ts`, `packages/server/src/search/ranker.ts`, `packages/server/src/sync/supabase-sync.ts` (`dbRowToMemory`/row mapper), `packages/server/src/cache/sqlite.ts` (`rowToMemory`), `packages/cli/src/commands/recall.ts`.
- `GenerateEmbeddingOptions` in `packages/cli/src/lib/embedding.ts:46` — unchanged signature; Task A only changes internal implementation.

## Technical Approach

**Task A (fix the bug):** Add a new chunker module per package (`packages/server/src/chunking.ts`, `packages/cli/src/lib/chunking.ts` — duplicated by design, matching the existing hand-synced pattern documented in `embedding.ts`'s header comment). `generateEmbedding()` estimates token count with a conservative char-based heuristic (reusing the ratio already used by `packages/server/src/search/token-budget.ts:4`'s `estimateTokens`, but with a safety margin below the real 8192-token OpenAI limit since char/4 is an approximation). Text under the threshold takes the existing single-call path unchanged. Text over threshold is split into overlapping chunks, each chunk embedded via the existing HTTP call, and the resulting per-chunk vectors are averaged + L2-renormalized into one 1536-dim vector — same shape `normalizeTo1536` already expects. All non-OK HTTP responses now read and log the body before returning null; 429s get retried with backoff (respecting `Retry-After` if present) before giving up.

**Task B (chunking strategy):** Depends on Task A's chunker files. Tunes the chunk-size/overlap constants in `chunking.ts` from "whatever avoids a 400" (large, API-limit-driven) to the eval-validated sweet spot (~4k chars per chunk, ~15% overlap, matching the harness's 78%-accuracy chunk granularity finding). No storage-layer changes — pooling from Task A already means recall needs no chunk-aggregation logic, since there's still exactly one embedding per memory row.

**Task C (temporal anchoring):** New migration 0060 adds `referenced_date` and `relative_date` timestamptz columns to `memories` (nullable, no backfill for historical rows — same convention as migration 0057). A new rule-based date-extraction utility (duplicated per-package like the embedding/chunking modules) parses memory key+value text for absolute dates and relative expressions, resolving relative expressions against `created_at` as the anchor. Extraction runs inline at write time in both `remember.ts` (server) and `remember.ts` (CLI). Recall gets a lightweight temporal-query classifier; when a query looks temporal, results are reordered by proximity to (or recency of) `referenced_date` → `relative_date` → `created_at`, in that fallback order, layered on top of (not replacing) existing relevance scoring in `ranker.ts`. The three dates are also surfaced in `recall.ts`'s per-passage text output (currently only `updatedAt` is cited via `formatCiteDate`) so the anchoring is actually usable by the model answering the question, not just stored.

## Bug Summary (Task A)
- **Symptom**: A memory whose value exceeds ~8192 tokens is stored with `embedding IS NULL` and silently drops out of semantic recall — no error surfaced anywhere.
- **Suspected cause**: `packages/cli/src/lib/embedding.ts:51-95` and `packages/server/src/embeddings.ts:12-63` — the OpenAI `fetch` call's response is only handled `if (res.ok)`; a 400 (or any non-OK status) falls through every branch to the final `return null` with the error body never read. The fire-and-forget caller, `scheduleEmbeddingSync()` in `packages/server/src/tools/remember.ts:159-176`, does `if (!embedding) return` — no logging, no retry, no user-visible signal.
- **Reproduction**: `generateEmbedding('word'.repeat(12000))` (with `TAGES_OPENAI_EMBED=1` and `OPENAI_API_KEY` set, Ollama unavailable) → OpenAI 400 ("maximum context length is 8192 tokens") → function returns `null`. Confirmed this session; short input under the same conditions returns a 200 and a vector.

## Tasks

- [ ] **Task A: Chunk + pool long-input embeddings, stop swallowing HTTP errors** — Add token-aware chunking with mean-pooling to `generateEmbedding()` in both packages; read and log all non-OK HTTP response bodies; retry 429 with backoff.
  - Files:
    - Create `packages/server/src/chunking.ts` — `estimateTokenCount(text)`, `chunkText(text, opts)` returning overlapping chunks under a token ceiling.
    - Create `packages/cli/src/lib/chunking.ts` — duplicated CLI copy (same pattern as `embedding.ts`'s existing header-documented duplication).
    - Modify `packages/server/src/embeddings.ts` — call `chunkText`, embed each chunk, mean-pool + `normalizeTo1536`; read/log error bodies; add 429 retry-with-backoff.
    - Modify `packages/cli/src/lib/embedding.ts` — same, using the CLI's `chunking.ts` copy.
  - Tests:
    - `packages/server/src/__tests__/embeddings.test.ts` — add cases: text over threshold triggers multiple chunk calls; pooled result is 1536-dim and unit-length; a 400 response is logged (spy `console.error`) rather than silently swallowed; a 429 followed by a 200 succeeds via retry; short text still takes the single-call path unchanged (no regression).
    - `packages/cli/src/__tests__/embedding.test.ts` — mirror the above for the CLI copy.
    - `packages/server/src/__tests__/remember-embedding.test.ts` — regression test with `'word'.repeat(12000)` as the memory value: `cache.setEmbedding` is called with a real vector (not skipped) via `scheduleEmbeddingSync`.
    - `packages/server/scripts/backfill-embeddings.test.ts` — add a case for a previously-un-embeddable long memory now succeeding via the fixed `generateEmbedding`.
  - Depends on: nothing
  - Effort: M (algorithmic change across 2 duplicated files + 4 test files; no schema/RPC change; base M, no multiplier — not auth/security code, not a DB migration, parallelizable against C)
  - Pre-mortem: If this takes 3x longer, it will be because the mean-pooling math (accumulating N unit vectors, renormalizing) has a subtle bug that produces a technically-valid-but-semantically-degenerate vector (e.g. near-zero after cancellation on adversarial chunk content) that only shows up as a silent recall-quality regression, not a test failure — mitigate by asserting pooled-vector cosine similarity to each individual chunk's vector is positive and reasonably high in tests, not just checking dimensionality/unit-length.
  - Notes: `generateEmbedding()`'s exported signature (`Promise<number[] | null>`) does not change — every existing caller (`scheduleEmbeddingSync` in `remember.ts`, `recall.ts` in both packages, `backfill-embeddings.ts`) needs zero code changes. Reuse the char-based token-estimate ratio already established in `packages/server/src/search/token-budget.ts:4` (`estimateTokens`) as the starting heuristic, with an explicit safety margin below 8192 since char/4 is approximate.

- [ ] **Task B: Tune chunk size/overlap to the eval-validated granularity** — Reuse Task A's chunker; change chunk-size constants from "just under the API limit" to the eval's proven ~4k-char sweet spot, and document the pooling-over-multi-row decision in the module header.
  - Files:
    - Modify `packages/server/src/chunking.ts` — tune `CHUNK_TARGET_CHARS`/overlap constants, add header comment documenting the pooling decision and the deferred multi-row alternative.
    - Modify `packages/cli/src/lib/chunking.ts` — same.
  - Tests:
    - Create `packages/server/src/__tests__/chunking.test.ts` — chunk boundaries match expected ~4k-char/overlap granularity on a representative long document; overlap actually preserves shared text across adjacent chunk boundaries; single-chunk (short text) path returns exactly one chunk equal to the input.
    - Create `packages/cli/src/__tests__/chunking.test.ts` — mirror for CLI copy.
  - Depends on: Task A (same files — sequential, not parallel; both own `chunking.ts` in each package)
  - Effort: S (tuning constants + tests, no new call sites, no schema change)
  - Notes: No recall-side aggregation logic is needed under the pooling design — this is purely a chunker-tuning task. If Ryan wants multi-row precision instead (see Open Questions), this task's scope changes materially and should be re-estimated, not extended in place.

- [ ] **Task C: 3-date temporal anchoring (schema + extraction + recall ordering)** — Add `referenced_date`/`relative_date` columns, a rule-based extractor, a temporal-query classifier, and date-aware reordering in recall.
  - Files:
    - Create `supabase/migrations/0060_temporal_date_anchoring.sql` — `ALTER TABLE memories ADD COLUMN referenced_date timestamptz, ADD COLUMN relative_date timestamptz`; supporting index(es); `CREATE OR REPLACE FUNCTION hybrid_recall(...)` and `semantic_recall(...)` (current definitions in `supabase/migrations/0012_fix_hybrid_thresholds.sql` and `0008_pgvector.sql`/`0013`/`0014` lineage) to additionally `SELECT`/return `m.referenced_date, m.relative_date`.
    - Modify `packages/shared/src/types.ts` — add `referencedDate?: string`, `relativeDate?: string` to `Memory` (after `verifiedAt` field, `types.ts:57`).
    - Create `packages/server/src/temporal/date-extraction.ts` — `extractDates(text, anchorDate): { referencedDate?: string; relativeDate?: string }`, regex-based (absolute: ISO 8601, `Month D, YYYY`, `MM/DD/YYYY`; relative: `N days/weeks/months ago`, `last/next <weekday>`, `yesterday`, `tomorrow`), resolves relative expressions against `anchorDate`.
    - Create `packages/cli/src/lib/date-extraction.ts` — duplicated CLI copy.
    - Create `packages/server/src/search/temporal-query.ts` — `isTemporalQuery(query): boolean` classifier (regex/keyword: "when", "what date", "before", "after", "last time", weekday/month names, "ago"); `extractTargetDate(query, anchor)` for queries that themselves reference a date.
    - Create `packages/cli/src/lib/temporal-sort.ts` — small standalone reorder helper for the CLI's direct-RPC recall path (mirrors the reorder logic in `ranker.ts` without pulling in the full server ranker).
    - Modify `packages/server/src/tools/remember.ts` — call `extractDates(key + ' ' + plaintextForIndex, now)` inline (not fire-and-forget) before `cache.upsertMemory`; populate `memory.referencedDate`/`memory.relativeDate`.
    - Modify `packages/cli/src/commands/remember.ts` — same inline call using the CLI's date-extraction copy.
    - Modify `packages/server/src/cache/sqlite.ts` — add `referenced_date`/`relative_date` columns to the `CREATE TABLE IF NOT EXISTS memories` DDL (`sqlite.ts:40-56`) and the migration-array pattern used for the existing `embedding` column addition (`sqlite.ts:126`); update the upsert `INSERT INTO memories (...)` column list (`sqlite.ts:211`) and `rowToMemory` mapper.
    - Modify `packages/server/src/sync/supabase-sync.ts` — `dbRowToMemory` (read mapper, near line 502) and the row-serialization function (near line 531-535) to map `referencedDate`/`relativeDate` to/from `referenced_date`/`relative_date`; `remoteHybridRecall` (`supabase-sync.ts:322-347`) already passes through whatever `hybrid_recall` returns via `dbRowToMemory`, so it picks up the new columns once the mapper and RPC are updated.
    - Modify `packages/server/src/search/ranker.ts` — accept a `query` + temporal-mode flag; when `isTemporalQuery(query)` is true, apply a reorder pass by `referencedDate ?? relativeDate ?? createdAt` proximity/recency on top of the existing composite score, before the final dedup/sort in `rankResults` (`ranker.ts:63-93`).
    - Modify `packages/server/src/tools/recall.ts` — pass `args.query` into the new ranker temporal mode (both the local-cache `rankResults` call and the remote-hybrid path); extend `formatMemoryBody` (`recall.ts` ~line 118-131) to include referenced/relative date alongside the existing `updatedAt`-derived `formatCiteDate` output, so the answering model actually sees the anchoring dates.
    - Modify `packages/cli/src/commands/recall.ts` — select the two new columns in the Supabase query/RPC call and apply `temporal-sort.ts`'s reorder when the query is temporal.
  - Tests:
    - Create `packages/server/src/__tests__/date-extraction.test.ts` — absolute-date parsing (ISO, `Month D, YYYY`, `MM/DD/YYYY`), relative-expression resolution against a fixed anchor (`"3 days ago"`, `"last Tuesday"`, `"yesterday"`), no-match returns `{}` (not throw) on text with no dates.
    - Create `packages/cli/src/__tests__/date-extraction.test.ts` — parity tests for the CLI copy.
    - Create `packages/server/src/__tests__/temporal-query.test.ts` — classifier true/false cases (temporal: "when did I last deploy", "what happened before the migration"; non-temporal: "what's our auth pattern").
    - Modify `packages/server/src/__tests__/ranker.test.ts` — add temporal-mode reorder cases: given equal relevance scores, the memory with the more-recent/matching `referencedDate` sorts first; non-temporal queries are unaffected (regression).
    - Manual/smoke: apply migration 0060 against a local Supabase instance, confirm `hybrid_recall`/`semantic_recall` return the two new columns and existing recall paths still function (no automated SQL test harness exists in this repo — confirmed via Step 1 search — so this is the established verification convention here).
  - Depends on: nothing (fully parallel-safe against Task A; different files, different subsystem)
  - Effort: L (schema migration + RPC redefinition + new extraction/classification modules across both packages + ranker/recall integration + cache/sync mirror updates)
    - Multiplier applied: 1.5x for database migration (irreversibility/coordination — new columns + RPC signature changes touch every recall path). Base would be M for the code volume alone; migration risk pushes it to L.
  - Pre-mortem: If this takes 3x longer, it will be because the RPC redefinition (`hybrid_recall`/`semantic_recall`) silently breaks an existing caller's expected return shape — Postgres `CREATE OR REPLACE FUNCTION` with a changed `RETURNS TABLE` signature can require `DROP FUNCTION` first in some Postgres versions, and any missed caller (dashboard, backfill script, other RPC consumers not surfaced in this session's grep) would fail at the DB layer, not in TypeScript. Mitigate by grepping all `.rpc('hybrid_recall'` and `.rpc('semantic_recall'` call sites across the full repo (not just packages/server and packages/cli) before writing the migration, and testing the migration against a scratch Supabase project before applying to dev/prod.
  - Notes: This is the largest task and is scoped to ship independently of A/B — it touches an entirely different column set (`referenced_date`/`relative_date` vs `embedding`) and a different code path (`ranker.ts`/date extraction vs `embeddings.ts`/chunking). No file overlap with Task A or B.

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| A | `packages/server/src/chunking.ts`, `packages/cli/src/lib/chunking.ts` | `packages/server/src/embeddings.ts`, `packages/cli/src/lib/embedding.ts`, `packages/server/src/__tests__/embeddings.test.ts`, `packages/cli/src/__tests__/embedding.test.ts`, `packages/server/src/__tests__/remember-embedding.test.ts`, `packages/server/scripts/backfill-embeddings.test.ts` |
| B | `packages/server/src/__tests__/chunking.test.ts`, `packages/cli/src/__tests__/chunking.test.ts` | `packages/server/src/chunking.ts`, `packages/cli/src/lib/chunking.ts` (same files A created — sequential dependency, not parallel) |
| C | `supabase/migrations/0060_temporal_date_anchoring.sql`, `packages/server/src/temporal/date-extraction.ts`, `packages/cli/src/lib/date-extraction.ts`, `packages/server/src/search/temporal-query.ts`, `packages/cli/src/lib/temporal-sort.ts`, `packages/server/src/__tests__/date-extraction.test.ts`, `packages/cli/src/__tests__/date-extraction.test.ts`, `packages/server/src/__tests__/temporal-query.test.ts` | `packages/shared/src/types.ts`, `packages/server/src/tools/remember.ts`, `packages/cli/src/commands/remember.ts`, `packages/server/src/cache/sqlite.ts`, `packages/server/src/sync/supabase-sync.ts`, `packages/server/src/search/ranker.ts`, `packages/server/src/tools/recall.ts`, `packages/cli/src/commands/recall.ts`, `packages/server/src/__tests__/ranker.test.ts` |

**Zero file overlaps between A/B and C** — A and C can run fully in parallel. B must run after A completes (same two `chunking.ts` files).

## Open Questions
- [ ] **Pooling vs multi-row chunk storage** — Blocks: nothing (default is pooling, already reflected in Task A/B above). If Ryan wants per-chunk retrieval precision matching the eval's 78% multi-row-granularity finding more closely, Task B's scope grows into a new child table + RPC + ranker aggregation (re-estimate as its own L/XL task). Default if unresolved: ship pooling (Task A/B as written).
- [ ] **Backfill existing long memories after Task A ships** — `packages/server/scripts/backfill-embeddings.ts` is already scoped to one project at a time (per its own header comment, RQ8 in `PLAN-MEMORY-FIXES.md`). Should it be run against production project(s) once Task A merges, to pick up memories that previously silently failed? Blocks: nothing (backfill script already exists and works once `generateEmbedding` is fixed). Default if unresolved: don't run it automatically; leave as a manual follow-up per project, consistent with the script's existing single-project-scope design.
- [ ] **Date-parsing dependency** — Hand-rolled regex extractor (as scoped in Task C) vs adding a library (e.g. `chrono-node`) for broader relative-date coverage. Blocks: nothing (Task C ships with regex as written). Default if unresolved: regex-only for Tier-1, consistent with Tages' existing no-new-runtime-deps pattern for the embedding/chunking modules; flag broader NLP-based extraction as a Tier-2 follow-on if regex coverage proves too narrow in practice.
- [ ] **CLI `remember` command never generates embeddings at all** (separate pre-existing gap, confirmed in Step 1, not part of the named bug) — Blocks: nothing in this plan. Should this be a Tier-2 ticket? Default if unresolved: yes, file separately; not fixed here.

## Definition of Done
- [ ] Code written and self-reviewed
- [ ] Tests written or updated for changed logic (see per-task Tests: entries)
- [ ] `pnpm --filter server test` and `pnpm --filter cli test` pass; `pnpm typecheck` passes
- [ ] Migration 0060 applied cleanly against a scratch/dev Supabase instance; `hybrid_recall`/`semantic_recall` RPC callers outside `packages/server`/`packages/cli` (if any) re-verified before merging
- [ ] Quality gates pass (code review, tests, security review)
- [ ] PR opened with coverage gaps noted in description (multi-row storage and LLM-assisted date extraction explicitly flagged as deferred, not silent gaps)


---

# Plan: Memory Retrieval Precision/Recall — Reader-First (Post-Tier-1 LongMemEval Findings)
_Created: 2026-07-10 | Type: Bug Fix + New Feature | Base branch: `main`_

Note on scope relative to the plan above ("Tier-1 Retrieval-Quality Fixes"): that plan shipped and merged (`c01ab62`, PR #67) — chunking/pooling fix, chunk-size tuning to ~4k chars/15% overlap, and 3-date temporal anchoring (migration 0060, `referenced_date`/`relative_date` columns + server-side `formatMemoryBody` surfacing) are all live on `main`. This plan is the direct follow-up: this session ran the LongMemEval harness end-to-end against that shipped code (`tages-cli` backend, OpenAI `text-embedding-3-small`, n=50, seed=42) and used the actual failure data — not assumptions — to find the next levers. Two of this plan's findings are new discoveries from reading that raw output, not carried over from the prior plan: (1) the harness's synthetic reader is never given the question's own reference date, and (2) the Tier-1 chunking fix's mean-pooling tradeoff (explicitly flagged as a risk in that plan) is empirically causing complete retrieval misses on long single-session memories.

## Goal
Move LongMemEval overall accuracy and recall@k above the measured baseline (54% / 78%) by fixing the two concrete, evidence-backed root causes found this session — the reader's missing temporal anchor and long-document retrieval dilution — ahead of the more speculative candidate levers (reranking, hybrid-weight tuning), and close the CLI/server date-surfacing parity gap for real product users.

## Baseline (measured this session — source of truth for every task's "did it work")

Run: `tages-tages-cli-n50-seed42-2026-07-10T04-04-16-198Z`, `eval/longmemeval/results/tages-t2-50q-20260709.json`, backend `tages-cli`, embedder OpenAI `text-embedding-3-small` (`TAGES_OPENAI_EMBED=1`), n=50, seed=42, dataset `longmemeval_oracle` (cleaned split).

| Metric | Overall | temporal-reasoning | multi-session | knowledge-update | single-session-user | single-session-assistant | single-session-preference |
|---|---|---|---|---|---|---|---|
| `overall_accuracy` | **54.0%** | 23.1% | 69.2% | 62.5% | 42.9% | 100% | 33.3% |
| `recall_at_k` | **78.0%** | 84.6% | 69.2% | 100% | 42.9% | 100% | 66.7% |

Additional facts derived from the raw `details[]` array in that JSON this session (not in the summary numbers — found by reading actual failing rows, the same technique that caught the embedding/temporal bugs this session):

- **11 of 50 questions (22%) got `recalled_memory_count == 0`** — `tages recall` returned literally nothing, not "the wrong thing." Spans temporal-reasoning (2), multi-session (4, 2 of which are `_abs` abstention questions scored "correct" only because declining on zero evidence is the right abstention behavior — a metric artifact, not a real win), single-session-user (4), single-session-preference (1).
- Every zero-hit question's haystack is dominated by **one very long single session (13,348–18,219 chars)** — 3.3–4.6x the Tier-1 plan's 4,000-char chunk target, meaning that memory's embedding is a mean-pool of 4-5 chunk vectors, and its trigram `similarity()` score is diluted by sheer length. Confirmed by direct measurement against `data/longmemeval_oracle.json` this session.
- Direct evidence of reader-side date-arithmetic failure: question `gpt4_e072b769` (temporal-reasoning), gold memory retrieved (`recalled_gold_hit: true`), ground truth "3 weeks ago," model answered "28 weeks ago" — a clean arithmetic error, not a retrieval miss. Of the 13 wrong temporal-reasoning answers, 8 had a gold hit (reader-bound) vs 2 with `recalled_memory_count: 0` (retrieval-bound) and the remainder ambiguous.
- `single-session-user`'s `recall_at_k` (42.9%) equals its `overall_accuracy` (42.9%) — this type is **retrieval-bound**, not reader-bound: accuracy cannot exceed what's retrieved, and it isn't.

## Scope

**In scope:**
- `eval/longmemeval/src/{types,answer,prompts,run}.ts` — the synthetic reader is missing the dataset's own `question_date` field (present in the data, typed in `types.ts:20`, silently dropped between `run.ts` and `answer.ts`)
- `supabase/migrations/0061_*.sql` — new migration (next available number; schema tip is 0060 on `main`)
- `packages/cli/src/commands/recall.ts` — CLI/server date-surfacing parity gap + dedup/threshold pass
- `packages/server/src/search`, `packages/server/src/tools/recall.ts` — read-only reference for parity (no changes needed; server side already surfaces dates per Tier-1)

**Out of scope (evaluated, cut, with reasoning):**
- **Multi-row/child-table chunk storage** (the "real" fix for vector-pooling dilution on long documents) — the Tier-1 plan already deferred this as a bigger, schema/RPC/ranker-aggregation change; this session's zero-hit evidence makes the case stronger, but it's still an L/XL redesign. Task 2 below ships a cheaper trigram-side mitigation now; multi-row storage stays a flagged Tier-2 follow-on if Task 2's cheaper fix proves insufficient on rerun.
- **`packages/server/src/search/ranker.ts` weight/threshold tuning** — verified this session: the CLI's Supabase-backed recall path (which the LongMemEval harness exercises via `tages recall`) never imports `ranker.ts` at all; `ranker.ts` is exclusively the MCP server tool's local-SQLite-cache path (`packages/server/src/tools/recall.ts`). Tuning it would be real product value for MCP-tool users but is **not measurable by this harness** — cut from this plan; flagged as a separate follow-on that would need a new harness backend calling the MCP tool directly.
- **HyDE / multi-query expansion** — cut. Task 2's `word_similarity()` fix targets the exact same failure mode (short query vs. long target dilution) far more cheaply, with no added LLM call latency/cost. Revisit only if Task 2's rerun doesn't recover the zero-hit questions.
- **A true cross-encoder or LLM-judge reranker** — evaluated per the brief's candidate list, included as Task 5 but demoted to lowest priority and scoped as a cheap heuristic (dedup + trim), not a new model/LLM call. Reasoning: `multi-session` and `knowledge-update`'s `recall_at_k` already ≈ `overall_accuracy` (retrieval-bound, reranking can't help), and `temporal-reasoning`'s gap is an arithmetic failure a reranker can't fix either. The one type where reranking could plausibly help (`single-session-preference`, recall@k 67% vs. accuracy 33%) is a 3-of-50-question stratum — low statistical power to prove or disprove impact.
- `apps/dashboard` — Task 2's migration changes only the internal `WHERE`/scoring expression inside `recall_memories`/`hybrid_recall`; `RETURNS TABLE` shape is unchanged, so dashboard's two `recall_memories` callers (`command-palette.tsx`, `memory-table.tsx`) are unaffected. No dashboard code changes needed, but they're on the migration's blast-radius grep list (see Task 2's pre-mortem).
- Production migration application — **DEV ONLY**. Per Ryan's explicit instruction, migration 0061 is applied to a scratch/DEV Supabase project (`longmemeval-sandbox` or equivalent) for this entire effort. Never apply to prod (`wezagdgpvwfywjoxztfs`) as part of this plan.

**Ambiguities resolved:**
- `word_similarity()` threshold for the new trigram-dilution fix → default **0.4** (conservative; pg_trgm's own `<%` operator default GUC is 0.6, but that operator is tuned for exact-word search UIs, not this asymmetric long-document case — 0.4 is a starting point, not a hard commitment; Task 2's own calibration rerun is the tuning signal).
- `question_date` passed to the reader **as-is** (the dataset's raw string, e.g. `"2023/04/10 (Mon) 23:07"`), not reformatted to ISO — lowest-risk change, GPT-4o parses this format natively; reformatting is unnecessary surface area.
- Task 5 (rerank) implementation → a **heuristic** pass (session-id dedup + rank-preserving trim), not a new LLM call or ML model — matches the low-confidence-of-impact finding above; a real reranker is not justified by current evidence.
- `TAGES_EVAL_PROJECT` → `longmemeval-sandbox`, assumed provisioned on the DEV Supabase instance (per project memory, `ugogdqzhhnuzwgcaovty`). Verified before Task 2's migration is applied (see Open Questions).

## Critical infra fact — READ BEFORE RUNNING ANY E2E VALIDATION

Verified this session: `which tages` → `/Users/ryan/.npm-global/bin/tages` → symlinked (`npm link`) to `/Users/ryan/.npm-global/lib/node_modules/@tages/cli` → symlinked to **this repo's `packages/cli`**, and the package's `bin` entry points at `./dist/packages/cli/src/index.js` (compiled output, not `src/`). The eval harness's `tages-cli` backend shells out to this binary via `execFileSync('tages', ...)` (`eval/longmemeval/src/memory.ts:178,197,214`).

**Editing `packages/cli/src/commands/recall.ts` (or any CLI source) has ZERO effect on any eval harness rerun until `pnpm --filter @tages/cli build` regenerates `dist/`.** This is exactly the class of bug the coordinator flagged from this session's earlier failures (changes that pass unit tests against `src/` but are invisible to the real binary). Every task below that touches CLI source states this explicitly as a required pre-rerun step — do not skip it, and do not trust a "no change" harness result without first confirming the rebuild happened (`ls -la dist/packages/cli/src/commands/recall.js` timestamp newer than the source edit).

## Type Dependencies
No new shared types. `LongMemEvalQuestion.question_date` (`eval/longmemeval/src/types.ts:20`) already exists and is populated in the real dataset (verified: `data/longmemeval_oracle.json`, e.g. `"2023/04/10 (Mon) 23:07"`) — Task 1 is purely wiring an existing field through, not adding one. `Memory.referencedDate`/`relativeDate` (`packages/shared/src/types.ts`, added by migration 0060 / Tier-1) are consumed read-only by Task 3 — no schema change.

## End-to-End Validation Gate (hard gate — applies to every task below)

No task in this plan is "done" on green unit tests + code review alone. Every task must clear this gate before being marked complete, matching this session's own recurring failure mode (1089 passing unit tests + clean White review, but the temporal reorder discarded relevance, embeddings were never generated, and a migration would have broken prod — all invisible to unit tests + review).

**Standard rerun procedure** (same command for every task, only the comparison target changes):

```bash
# 0. MANDATORY if the task touched packages/cli/src/** — rebuild, or the rerun tests stale dist:
pnpm --filter @tages/cli build

# 1. Rerun the 50q calibration sample, same seed as baseline, DEV project only:
cd eval/longmemeval
TAGES_OPENAI_EMBED=1 TAGES_EVAL_PROJECT=longmemeval-sandbox \
  pnpm run -- --n 50 --seed 42 --backend tages-cli \
  --output results/tages-<task-id>-$(date +%Y%m%d-%H%M).json

# 2. Diff against baseline (results/tages-t2-50q-20260709.json) on:
#    overall_accuracy, accuracy_by_type[<task's target type(s)>], recall_at_k,
#    recall_at_k_by_type[<task's target type(s)>]
```

**Pass/fail rule:** a task's target metric must move in the expected direction versus baseline. No movement or a regression means the task **failed**, regardless of unit test / code review status — fix or revert, don't ship. Non-target metrics must not regress by more than noise (this is a 50-question sample; a ±1 question swing in a type with n≈3-7 is noise, a swing in `overall_accuracy` or a type with n≈13 is not).

**Beyond the aggregate number — read the raw rows.** For every task, before declaring success, open the new results JSON's `details[]` array and manually read 2-3 of the previously-wrong rows this task targeted (question ids are named per-task below). Confirm the *mechanism* changed (e.g. Task 1: does `model_answer` for `gpt4_e072b769` now show correct arithmetic, not just "did the aggregate percentage go up"). This is the exact technique that surfaced every real finding in this plan — a moved percentage with an unchanged failure mechanism is not trustworthy.

**Product-behavior smoke checklist** (classes of bugs unit tests structurally cannot catch — run once, at the end, on the combined diff, not per-task):
- [ ] **Dist freshness**: `packages/cli/dist/packages/cli/src/commands/recall.js` (and any other touched compiled file) has a mtime newer than the last source commit in this plan, confirming the build in the gate procedure above actually ran and wasn't skipped.
- [ ] **Real CLI round-trip, not mocked**: `tages remember` a memory containing an explicit date into a real (DEV) project, then `tages recall` it and visually inspect the printed terminal output — not a test assertion — for the expected new content (Task 3: a `Dates:` line; Task 2/4: the memory is found at all for a long-value case).
- [ ] **DB round-trip against DEV, not a mock client**: after migration 0061 is applied, run the RPC directly via `psql`/Supabase SQL editor against a real long-value row and confirm the returned `similarity` reflects the new scoring — not just that the migration file applies without a Postgres error.
- [ ] **Async/process-lifecycle**: confirm `tages remember`'s embedding write (already fixed pre-Tier-1 to be synchronous/awaited before CLI exit) is untouched by this plan's changes — no task here should reintroduce a fire-and-forget race on the write path.
- [ ] **Cross-package/global-bin consistency**: `which tages` still resolves through the same symlink chain verified above; no task accidentally shadows it with a second global install.
- [ ] **Migration reversibility check**: confirm migration 0061 was applied to `longmemeval-sandbox` (DEV) only — `supabase migration list --linked` against the DEV project shows 0061 applied; the same command against prod (if ever run, which it should not be for this plan) must NOT show 0061.

## Tasks

Ranked by expected impact. Per the user's requested default order (reader → reranking → recall), Task 2 (recall/long-document fix) is promoted ahead of reranking based on this session's own evidence — 22% of all 50 questions returned zero memories, a larger and more concrete failure mode than anything reranking could plausibly address given the retrieval-bound-vs-reader-bound split found above. This deviation is intentional and evidence-based, not an oversight.

---

- [ ] **Task 1 — READER: thread `question_date` into the LongMemEval synthetic reader as its temporal anchor**
  - **Why #1**: Directly explains a confirmed, read-off-the-raw-output arithmetic failure (`gpt4_e072b769`: gold memory retrieved, ground truth "3 weeks ago," answered "28 weeks ago"). `prompts.ts`'s existing `DATE_ARITHMETIC_INSTRUCTIONS` (line 20) already tells the model to use "the question's reference date if one is provided" — it is never provided. Cheapest fix in this plan (no schema, no migration, no product code).
  - Files:
    - Modify `eval/longmemeval/src/prompts.ts` — `buildAnswerUserPrompt(question, memories)` → `buildAnswerUserPrompt(question, memories, referenceDate?)`; when `referenceDate` is present, prepend a line (e.g. `Reference date (treat as "today" for any relative-date computation): ${referenceDate}`) before the `Question:` line.
    - Modify `eval/longmemeval/src/answer.ts` — `generateAnswer(question, memories, questionType)` → `generateAnswer(question, memories, questionType, referenceDate?)`, passed through to `buildAnswerUserPrompt`.
    - Modify `eval/longmemeval/src/run.ts` — line 151 call site: `generateAnswer(q.question, memories, q.question_type, q.question_date)`.
  - Tests:
    - Modify `eval/longmemeval/src/prompts.test.ts` — `buildAnswerUserPrompt` includes the reference-date line when a date is passed, and omits it entirely (byte-identical to current output) when omitted — regression guard for non-temporal call sites.
    - Modify `eval/longmemeval/src/answer.test.ts` — `generateAnswer` forwards a passed `referenceDate` into the user-prompt content sent to the mocked OpenAI client.
  - E2E Validation: Standard rerun procedure above (no build step needed — this is eval-harness TypeScript run via `tsx`, not compiled CLI dist). Target metric: `accuracy_by_type['temporal-reasoning']` (baseline 23.1%) must increase; `recall_at_k_by_type['temporal-reasoning']` (baseline 84.6%) must NOT regress (this task only changes the reader, not retrieval — a drop here would indicate a bug, e.g. the date line pushing memory content out of context). Read the raw `details[]` rows for `gpt4_e072b769` and `gpt4_468eb063` specifically post-rerun and confirm the model's arithmetic is now correct (or, for `gpt4_468eb063`, correctly recognizes it has no evidence — that one is a Task 2 zero-hit case, not fixable here).
  - Depends on: nothing
  - Effort: S
  - Notes: This is eval-harness-only code (the file headers explicitly document "EVAL-ONLY... has no effect on the shipped `recall`/`remember` MCP tools or CLI" — Tages ships no LLM reader of its own; the real "reader" for a live product user is whatever agent, e.g. Claude Code, is calling the `recall` tool). This task's value is diagnostic/benchmark-integrity plus proof that Tages' retrieved memories, given adequate reasoning support, can support much higher temporal accuracy — informs whether the product-level "surface dates to the calling agent" work (Task 3) is worth doing (it demonstrably is, per this task's expected result).

---

- [ ] **Task 2 — RECALL: fix long-document trigram/vector dilution via `word_similarity()`, propagate the existing ILIKE-fallback fix to `hybrid_recall`**
  - **Why #2 (promoted ahead of reranking)**: 22% of all 50 questions (11/50) got zero memories back, concentrated on single-session haystacks of 13-18K chars — 3-4x the chunking task's 4K-char target. Migration `0039_recall_ilike_fallback.sql` already diagnosed and partially fixed this exact class of bug ("`pg_trgm similarity()` dilutes scores on long values") for `recall_memories`, but that fix (`ilike '%' || p_query || '%'`) only works when the query is a short literal substring — LongMemEval (and any agent) passes full natural-language sentences as the query, which essentially never appears verbatim inside a transcript. `hybrid_recall` (added after 0039, in migration 0012/0060's lineage) never got even that fix. `pg_trgm`'s `word_similarity(query, target)` is the correct primitive here — it measures the best match between the query and any word-bounded substring of the target, which is exactly this asymmetric-length case, unlike `similarity()`.
  - Files:
    - Create `supabase/migrations/0061_word_similarity_recall_fix.sql`:
      - `recall_memories(uuid, text, text, int)`: reproduce the current definition (`0039_recall_ilike_fallback.sql`) verbatim, widening the score expression from `greatest(similarity(m.key,p_query), similarity(m.value,p_query))` to additionally include `word_similarity(p_query, m.key)` and `word_similarity(p_query, m.value)` in the `greatest(...)`, and widening the `WHERE` filter's OR-chain to include `word_similarity(p_query, m.value) > 0.4 OR word_similarity(p_query, m.key) > 0.4` alongside the existing `> 0.15` similarity check and ILIKE fallback (all three stay — this adds a fourth OR-branch, doesn't replace any).
      - `hybrid_recall(uuid, text, vector, text, int)`: reproduce the current definition (`0060_temporal_date_anchoring.sql`, which already carries `referenced_date`/`relative_date` — preserve those columns and every other clause verbatim per this file's own "diff against the current definition, don't drop a clause" convention) with the same `word_similarity` widening applied only to the `trigram_results` CTE's `sim` computation and `WHERE` filter. The `vector_results` CTE (embedding leg) is untouched — `word_similarity` doesn't apply there; the embedding-pooling dilution is the deferred multi-row-storage problem, out of scope here (see Scope).
    - No application code changes — both RPCs' `RETURNS TABLE` signatures are unchanged (only the internal scoring/filter expression changes), so no call site (`packages/cli/src/commands/{recall,query}.ts`, `packages/server/src/sync/supabase-sync.ts`, `apps/dashboard/src/components/{command-palette,memory-table}.tsx`) needs a code change.
  - Tests: No automated SQL test harness exists in this repo (confirmed via Step 1 search, same as migration 0060's own convention) — this is a DB-only change; verification is the manual SQL steps below plus the harness rerun.
  - E2E Validation:
    1. **Grep the full blast radius before applying**: `grep -rn "\.rpc('hybrid_recall'\|\.rpc('recall_memories'" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules` (confirmed this session: 5 non-server-recall.ts callers exist — `apps/dashboard/src/components/command-palette.tsx:49`, `memory-table.tsx:97`, `packages/server/src/sync/supabase-sync.ts:304,330`, `packages/cli/src/commands/query.ts:25` — re-verify this list is unchanged before applying, since the migration's safety claim depends on it).
    2. Apply migration 0061 to the **DEV** Supabase project only (`supabase db push` against `longmemeval-sandbox`'s project ref — confirm via `supabase migration list --linked` before AND after that only DEV is targeted).
    3. Manual SQL smoke test: `select * from recall_memories('<longmemeval-sandbox project id>'::uuid, '<the literal question text from gpt4_468eb063>', null, 30);` against a project still holding that question's ingested session (or re-ingest via the harness first) — confirm at least one row returns where zero did before.
    4. Standard rerun procedure. Target metrics: `recall_at_k` overall (baseline 78.0%) must increase; specifically count of `recalled_memory_count == 0` rows in the new `details[]` (baseline 11/50) must decrease. `overall_accuracy` should also move (more evidence reaching the reader), though less predictably than `recall_at_k` since it's gated by the reader too.
    5. Read the raw rows for the 4 single-session-user zero-hit questions (`001be529`, `726462e0`, `6f9b354f`, `1e043500`) post-rerun and confirm `recalled_memory_count > 0` for at least most of them — this is the type with the starkest retrieval-bound signature (recall@k == accuracy at 42.9%), so it's the clearest before/after read.
  - Depends on: nothing (independent of Task 1 and Task 3)
  - Effort: L (base M for the SQL change itself — two `DROP FUNCTION`/`CREATE OR REPLACE` statements with a scoring-expression widening; ×1.5 for database migration per the standard multiplier — irreversibility/coordination risk on a function touched by 6 real call sites across 3 packages)
  - Pre-mortem: If this takes 3x longer, it will be because `CREATE OR REPLACE FUNCTION` with an unchanged `RETURNS TABLE` still trips a Postgres catalog dependency issue on one of the 6 call sites in a way that only shows up as a runtime RPC error, not a migration-apply error — or because `word_similarity`'s 0.4 threshold turns out too permissive (precision regression: previously-filtered noise now clears the bar) or too strict (doesn't actually catch the 18K-char cases). Mitigate: the grep-blast-radius step above catches the first risk before applying; the calibration rerun's `recalled_memory_count == 0` count (not just the aggregate `recall_at_k`) is a fast, direct signal for the second — if it doesn't drop, the threshold or the CTE it was added to is wrong, iterate before considering this task done.
  - Notes: This is the highest-confidence, most concrete finding in this plan (backed by exact character counts on the exact failing rows, not inference). Zero file overlap with any other task — SQL-only.

---

- [ ] **Task 3 — PRODUCT PARITY: surface `referenced_date`/`relative_date` in `tages recall`'s CLI output**
  - **Why #3**: The server MCP tool already does this (`packages/server/src/tools/recall.ts`'s `formatMemoryBody`, shipped in Tier-1) — the CLI never got the matching change. Real product correctness gap for the ~half of Tages usage that's CLI-driven rather than MCP-driven, cheap to fix. Explicitly flagged: **this task will NOT move any LongMemEval harness number** — the harness's `tages-cli` backend (`eval/longmemeval/src/memory.ts:196-209`) parses only the memory *key* out of `tages recall`'s printed output and looks up the full text from its own `ingestedText` cache, bypassing whatever `recall.ts` prints entirely. Confirmed by reading `memory.ts` this session. Do this task for real product correctness, not for a harness delta — its E2E validation is a real-product probe, not a rerun.
  - Files:
    - Modify `packages/cli/src/commands/recall.ts` — in the per-row console output loop (lines 139-148), after the existing `similarity`/`match_type` line, print a `Dates:` line mirroring the server's `formatMemoryBody` (`packages/server/src/tools/recall.ts:129-134`) when `row.referenced_date` or `row.relative_date` is present: `referenced <YYYY-MM-DD>, relative <YYYY-MM-DD>` (reuse the same `formatCiteDate`-style `.slice(0, 10)` truncation the server uses, inlined here since the CLI doesn't import server code). Also add these two columns to the `listAll` branch's existing `.select(...)` call (line 42) if not already present — confirmed they already are (`referenced_date, relative_date` present in that select list) — so this is print-only, no query change needed for `listAll`; the hybrid-search branch's rows already carry these fields from the RPCs (migration 0060), just unprinted.
  - Tests:
    - Modify `packages/cli/src/__tests__/recall.test.ts` — add a case asserting the printed output contains a `Dates:` line when a mocked row has `referenced_date`/`relative_date` set, and asserts the line is absent when both are null (regression guard for the common no-date case, matching the sparsity documented in migration 0060's own header).
  - E2E Validation:
    - **No harness rerun for this task** (see "Why #3" above — it wouldn't move any number, and reporting a delta here would be misleading).
    - **Real-product probe (this task's actual proof)**: rebuild (`pnpm --filter @tages/cli build`), then against a real DEV project: `tages remember temporal-parity-check "Shipped the feature on July 9, 2026" --project <dev-project>`, then `tages recall "when did we ship the feature" --project <dev-project>` and visually confirm the terminal output includes a `Dates:` line with `referenced 2026-07-09`. This is the exact technique ("write, then read, then look at the actual output") that caught the embedding and temporal-reorder bugs this session — do not skip it in favor of only the unit test.
  - Depends on: nothing (Task 4 depends on this — same file, see Task 4)
  - Effort: S
  - Notes: Zero-conflict with Task 2 (different files entirely). Task 4 below touches the same file (`recall.ts`) in a different region (the merge/dedup logic, not the print loop) — sequenced after this task to avoid a two-agent same-file conflict in parallel execution (see File Ownership Matrix).

---

- [ ] **Task 4 — RECALL: CLI-side dedup + vector-threshold calibration on the hybrid merge path**
  - **Why #4**: Smaller, more speculative recall lever than Task 2. Targets the CLI's own merge/sort logic (`packages/cli/src/commands/recall.ts` lines 100-131) — the code path the harness actually exercises (unlike `packages/server/src/search/ranker.ts`, which the harness never touches — see Scope). Two sub-changes: (a) the merge step already dedups by `id` across trigram/semantic result sets but does not dedup near-duplicate *content* (e.g. two overlapping long-session chunks that both cleared threshold) — low observed evidence of this being a real problem at session-level ingestion granularity, so scoped narrowly; (b) `semanticPromise`'s hardcoded `p_threshold: 0.3` (line 88) is a candidate tuning knob for the vector-pooling-dilution cases Task 2 doesn't reach.
  - Files:
    - Modify `packages/cli/src/commands/recall.ts` — parameterize `p_threshold` (currently hardcoded `0.3` at line 88) so it can be lowered in the calibration experiment below without a second code change; keep the merge/dedup-by-id logic (lines 100-117) as-is unless the calibration rerun shows a concrete near-duplicate problem (none observed in this session's data — don't build speculative dedup logic without evidence).
  - Tests:
    - Modify `packages/cli/src/__tests__/recall.test.ts` — the threshold value used in the `semantic_recall` RPC call is asserted against the (possibly-lowered) constant, not hardcoded `0.3`, so the test doesn't silently drift from the calibrated value.
  - E2E Validation:
    1. Rebuild (`pnpm --filter @tages/cli build`).
    2. Run the standard rerun procedure TWICE post-Task-2: once at `p_threshold: 0.3` (current) as a post-Task-2 recheck baseline, once at `p_threshold: 0.25`. Compare `recall_at_k` (overall and per-type) between the two. Pick whichever value doesn't regress precision (a lower threshold pulling in more true positives is good; pulling in more noise that pushes correct answers out of the reader's top-k is bad — check `overall_accuracy` moved the same direction as `recall_at_k`, not opposite).
    3. If neither value changes `recall_at_k` meaningfully versus the post-Task-2 number, ship at 0.3 (no evidence to change it) and note the experiment's null result rather than picking a value with no justification.
  - Depends on: Task 3 (same file, `packages/cli/src/commands/recall.ts` — sequential per Gate 5c, not parallel)
  - Effort: S
  - Notes: This task is explicitly a calibration experiment, not a committed change — the "Ambiguities resolved" default is "keep 0.3 unless the rerun shows a clear win." Low file-overlap risk since it's sequenced after Task 3, not parallel with it.

---

- [ ] **Task 5 — RERANK (lowest priority, optional): heuristic dedup/trim pass before the reader**
  - **Why #5 (lowest, explicitly optional)**: Evaluated per the brief's candidate list. Current evidence weighs against high impact: `multi-session` and `knowledge-update`'s `recall_at_k` ≈ `overall_accuracy` (retrieval-bound — a reranker can't fix what wasn't retrieved), and `temporal-reasoning`'s gap is an arithmetic failure (Task 1's target, not a ranking problem). The one plausible beneficiary, `single-session-preference` (recall@k 67% vs. accuracy 33%), is only 3 of 50 sampled questions — too little signal to confirm or deny impact confidently. Ship this only if Tasks 1-4 land and time/budget remains; do not block the rest of this plan on it.
  - Files:
    - Create `eval/longmemeval/src/rerank.ts` — a pure function `rerank(memories: string[], goldFallbackLimit: number): string[]` that dedups by parsed `[session=<id>]` tag (keep first occurrence, preserving original rank order) and trims to the top N (default: unchanged from current `topK`, i.e. a no-op unless dedup actually removes rows — this task adds no new truncation risk beyond what already exists).
    - Modify `eval/longmemeval/src/run.ts` — call `rerank(memories, args.topK)` between `store.recall(...)` (line 149) and `generateAnswer(...)` (line 151).
  - Tests:
    - Create `eval/longmemeval/src/rerank.test.ts` — dedup removes a repeated session id while preserving the first occurrence's rank position; a list with no duplicates is returned unchanged (byte-identical, regression guard).
  - E2E Validation: Standard rerun procedure. Target metric: `recall_at_k_by_type['single-session-preference']` and `accuracy_by_type['single-session-preference']` (baseline 66.7% / 33.3%, n≈3 — treat any single-question swing as the entire signal, not statistically reliable) plus overall `recall_at_k`/`overall_accuracy` must not regress. Given the low-confidence framing above, a null result (no movement) is an acceptable, expected outcome for this task specifically — do not force a "positive" reading of noise on a 3-question stratum.
  - Depends on: Task 1 (same file, `eval/longmemeval/src/run.ts` — sequential per Gate 5c, not parallel)
  - Effort: M (base S for the dedup logic itself; ×1.5 applied because the pre-mortem below states genuine uncertainty about whether this task will move any metric at all — per the effort-calibration rule, an honest "we don't know" pre-mortem answer triggers the uncertainty multiplier)
  - Pre-mortem: If this task "fails" (no metric movement), it will be because the evidence above was right and reranking isn't the lever for Tages' current failure modes — that's a valid, useful negative result, not a wasted task, but it means the 1.5-2 hours spent here were lower-leverage than any of Tasks 1-4. This is exactly why it's ranked last and marked optional.

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| 1 | — | `eval/longmemeval/src/prompts.ts`, `eval/longmemeval/src/answer.ts`, `eval/longmemeval/src/run.ts`, `eval/longmemeval/src/prompts.test.ts`, `eval/longmemeval/src/answer.test.ts` |
| 2 | `supabase/migrations/0061_word_similarity_recall_fix.sql` | — |
| 3 | — | `packages/cli/src/commands/recall.ts`, `packages/cli/src/__tests__/recall.test.ts` |
| 4 | — | `packages/cli/src/commands/recall.ts` (same file Task 3 modifies — **sequential dependency, not parallel**), `packages/cli/src/__tests__/recall.test.ts` |
| 5 | `eval/longmemeval/src/rerank.ts`, `eval/longmemeval/src/rerank.test.ts` | `eval/longmemeval/src/run.ts` (same file Task 1 modifies — **sequential dependency, not parallel**) |

**File conflicts identified and resolved:**
- `packages/cli/src/commands/recall.ts` — Task 3 (print loop, lines ~139-148) and Task 4 (merge/threshold, lines ~62-131). Resolution: **sequential** — Task 4 depends on Task 3. Different regions of the same file, but two independent Howlers editing the same file in parallel risks a merge conflict regardless of line distance.
- `eval/longmemeval/src/run.ts` — Task 1 (line 151, `generateAnswer` call) and Task 5 (new line calling `rerank()` between lines 149-151). Resolution: **sequential** — Task 5 depends on Task 1, both because they touch adjacent lines of the same function and because Task 5 is lowest-priority/optional and naturally runs last regardless.

**Parallel-safe wave**: Tasks 1, 2, 3 can run fully in parallel (zero file overlap, verified above). Tasks 4 and 5 follow in a second wave once Task 3 and Task 1 respectively merge.

## Open Questions
- [ ] **Does the `longmemeval-sandbox` Supabase project exist and is it confirmed DEV, not prod?** — Blocks: Task 2's apply-and-rerun steps (migration 0061 must land somewhere real before its E2E validation can run). Default if unresolved: verify with `supabase projects list` / `supabase migration list --linked` before applying anything; if it doesn't exist, provision a fresh DEV-tier project rather than reusing an existing one, per the "never touch prod" constraint.
- [ ] **`word_similarity()` threshold (0.4) exact value** — Blocks: nothing (ships with 0.4 as written; Task 2's own calibration rerun is the tuning signal, and its pre-mortem already accounts for this). Default if unresolved: 0.4, revisit only if the rerun's `recalled_memory_count == 0` count doesn't improve.
- [ ] **Should Task 5 (rerank) be dropped from this plan entirely rather than shipped as "optional"?** — Blocks: nothing either way. Default if unresolved: keep it in the plan as written (lowest priority, explicitly cuttable) — Ryan can descope it at Spectrum-dispatch time without replanning if the earlier tasks' results confirm it's not worth the slot.
- [ ] **Multi-row (child-table) chunk storage for the vector-pooling-dilution cases Task 2 doesn't reach** — Blocks: nothing in this plan (explicitly out of scope, see Scope). Default if unresolved: revisit as a new plan if Task 2's rerun shows `recall_at_k` still meaningfully depressed by long single-session memories after the trigram-side fix ships.

## Definition of Done
- [ ] Code written and self-reviewed
- [ ] Tests written or updated for changed logic (see per-task Tests: entries)
- [ ] `pnpm --filter cli test`, `pnpm --filter eval-longmemeval test` (or equivalent `vitest run` in `eval/longmemeval`) pass; `pnpm typecheck` passes
- [ ] **Every task's E2E Validation steps completed and the target metric's before/after numbers recorded** — not just "tests pass." This is the hard gate; a task with green unit tests but no recorded harness/product-probe delta is not done.
- [ ] Product-behavior smoke checklist (above) run once on the combined diff
- [ ] Migration 0061 confirmed applied to DEV (`longmemeval-sandbox`) only, never prod
- [ ] A final combined rerun (all merged tasks together, standard procedure) recorded against the baseline table above, reported as: overall_accuracy delta, recall_at_k delta, per-type deltas, and the `recalled_memory_count == 0` count delta
- [ ] Quality gates pass (code review, tests, security review)
- [ ] PR opened with coverage gaps noted in description (Task 5's low-confidence framing, deferred multi-row chunk storage, and deferred ranker.ts/MCP-path tuning explicitly flagged as known-deferred, not silent gaps)


---

# Plan: Two-Stage Retrieval (RRF Fusion + Rerank) and Multi-Vector Chunk Storage
_Created: 2026-07-10 | Type: New Feature | Base branch: `main` @ `42360b8`_
_Amended 2026-07-10 (same day): folded in Mastra observational-memory research + published 85%+ LongMemEval systems (Hindsight, SmartSearch, Supermemory, Mem0, OMEGA, ByteRover, Honcho) per Ryan's request. Amendment scope: reranker provider recommendation revised, two new Phase 1 tasks added (temporal date-range channel, assembled-context output), Task 10's chunk-return spec upgraded from recommendation to requirement, expectation calibration added, Phase 3 note added. Diff-level detail on each change is called out inline below rather than kept as a separate changelog._

Note on scope relative to the two plans above: "Tier-1 Retrieval-Quality Fixes" (chunking/pooling, temporal anchoring — migration 0060) and "Memory Retrieval Precision/Recall" (reader date-anchor, `word_similarity` fix — migration 0061, CLI date-surfacing parity, CLI dedup) are both shipped and merged on `main`. Confirmed this session by reading the live code: `packages/cli/src/commands/recall.ts` already contains `dedupeNearDuplicateContent` (lines 39-68), `sortByTemporalProximity` wiring (line 184), and the `Dates:` print line (lines 207-212) described in that plan's Tasks 3/4; `packages/server/src/tools/recall.ts`'s `formatMemoryBody` already surfaces `referencedDate`/`relativeDate` (lines 129-134); migration `0061_word_similarity_recall_fix.sql` is on disk with the `word_similarity` widening for both `recall_memories` and `hybrid_recall`, applied to DEV only per its own header. This plan is the direct follow-up requested for "the next two phases": (Phase 1 / Tier 1) two-stage retrieve-then-rerank with RRF fusion, and (Phase 2 / Tier 2) multi-vector chunk storage to fix the mean-pool dilution behind the 11/50 zero-hit questions that `word_similarity` only partially addressed.

## Goal
Ship a two-stage hybrid-retrieve-then-rerank pipeline with proper rank-based (RRF) fusion in place of today's raw-score merge (Phase 1), then replace single-pooled-vector-per-memory storage with per-chunk vectors + parent-doc aggregation to structurally fix long-document retrieval dilution (Phase 2) — moving LongMemEval `overall_accuracy`/`recall_at_k` above the measured baseline below, with every task validated against the real harness, not just green tests.

## Baseline (measured this session — source of truth for every task's "did it work")
Run: `eval/longmemeval/results/tages-pr-50q-20260710.json`, backend `tages-cli`, embedder OpenAI `text-embedding-3-small` (`TAGES_OPENAI_EMBED=1`), n=50, seed=42.

| Metric | Overall | temporal-reasoning | multi-session | knowledge-update | single-session-user | single-session-preference |
|---|---|---|---|---|---|---|
| `overall_accuracy` | **62%** | 38.5% | 69% | 87.5% | 43% | 33% |
| `recall_at_k` | **78%** | — | — | — | — | — |

11/50 questions (22%) still return `recalled_memory_count == 0` — all long (13-18K char) single-session haystacks where the Tier-1 mean-pooled single embedding + `word_similarity`'s trigram-side mitigation both fall short. This is Phase 2's target. Retrieval recall for the *other* 39/50 questions is largely solved; the reader was the previous bottleneck (fixed by PR #71 — reference-date threading, per the plan above).

## Expectation calibration (added per Ryan's request — Mastra + published-SOTA research, this session)
Two research briefs studying Mastra's observational-memory paper and every publicly-benchmarked LongMemEval system scoring 85%+ (Mastra OM, Mem0, OMEGA, ByteRover, Honcho, Hindsight) converge on one finding that directly bounds this plan's realistic ceiling: **the published 90%+ numbers are not apples-to-apples with what this plan can deliver.** On the only comparable axis (gpt-4o reader + gpt-4o judge, S split), the field's own numbers are: full-context baseline 60.2%, oracle retrieval (perfect recall, no ranking/budget loss) 82.4%, Mastra's observational-memory (OM) architecture 84.2% — the best result at a *fixed, GPT-4-class* reader. Every 90%+ number (Mastra 94.9% with gpt-5-mini, Mem0 94.4%, OMEGA 95.4%, ByteRover 92.8%, Honcho 90.4-92.6%, Hindsight 91.4%) comes from a stronger reader model and/or a nonstandard judge, not from retrieval architecture alone. **With a GPT-class reader held fixed, published SOTA is ~84-85%, and even oracle (perfect) retrieval only reaches 82.4%.**

Tages' own reader is whatever agent calls the CLI/MCP tool (this eval harness uses `gpt-4o` as both reader and judge, matching the comparable axis above, per `eval/longmemeval/src/answer.ts`/`prompts.ts` — not independently re-verified in this amendment pass beyond the file names already cited in the plan above). Realistic targets for this plan's Phase 1 + Phase 2, informed by this ceiling: `overall_accuracy` 62% → **low-to-mid 70s** (not 90s — that requires a reader upgrade this plan doesn't touch, see Phase 3 note below), `recall_at_k` 78% → **high 80s**, and the `recalled_memory_count == 0` count 11/50 → **≤3/50**. A final combined result in the low-to-mid 70s should be read as this plan **succeeding**, not falling short of some 90%+ industry bar that isn't actually reachable at this reader tier. This recalibration replaces no numeric target elsewhere in this plan (none were stated as hard pass/fail thresholds before) — it is a Definition-of-Done interpretation guardrail, added as its own checklist item below.

Supporting evidence used directly in this amendment's task design (cited per-task below where applied):
- **SmartSearch** (arXiv 2603.15599) oracle analysis: retrieval recall 98.6% but only 22.5% of gold evidence survives truncation into the token budget without intelligent ranking — this is functionally the same gap as Tages' own measured 78% recall@k vs. 62% overall. Rank-then-truncate (a real cross-encoder after high-recall candidate generation) is the field's strongest-evidence lever, directly motivating this amendment's Task 2 revision below.
- **Hindsight** (arXiv 2512.12818, 91.4%, Postgres/pgvector — the closest published architecture to Tages): 4-way parallel retrieval (pgvector HNSW + BM25 + graph spreading-activation + an explicit date-range temporal channel) → RRF → cross-encoder → token budget. Tages already has 3 of the 4 channels' equivalents (vector, trigram, and now RRF fusion + rerank from this plan's original Phase 1); the missing 4th channel (explicit temporal date-range retrieval, not just re-ordering) is this amendment's new Task 3/Task 7.
- **Supermemory**'s "search small, return big": search over small/distilled vectors, inject the original parent chunk into results, preserving winning-chunk identity — direct published validation of this plan's original Phase 2 design, and the specific reason Task 10's chunk-identity return is upgraded from a recommendation to a requirement below.
- **Mastra OM** beats the gpt-4o *oracle* (84.2% vs. 82.4%, same reader): pre-digested, dated observation extraction at ingest time outperforms raw correct text, and every 90%+ system does some form of ingestion-time LLM distillation. This is genuinely out of scope for this plan (a write-path architecture change, not a retrieval change) — see the new "Phase 3 (not this plan)" note before Open Questions.

## Critical correction to plan scope — verified in code this session
The brief's framing assumes `hybrid_recall` is the single retrieval RPC to widen/fuse/rerank. **It is not the path the LongMemEval harness exercises.** Verified by reading both files this session:
- `eval/longmemeval/src/memory.ts`'s `TagesCliStore.recall()` (lines 196-209) shells out to `tages recall <query> --project <p> --limit <topK>` — the real public CLI.
- `packages/cli/src/commands/recall.ts` (lines 116-188) does **not** call `hybrid_recall`. It calls `recall_memories` (trigram RPC) and `semantic_recall` (vector RPC) as two **separate** RPCs in parallel, then merges/dedups/sorts client-side in TypeScript.
- `hybrid_recall` is only called from `packages/server/src/sync/supabase-sync.ts`'s `remoteHybridRecall` (lines 322-347), which is only reached from `packages/server/src/tools/recall.ts`'s `handleRecall` (line 79, the MCP-server tool path) and from `apps/dashboard`'s two callers (`command-palette.tsx:49`, `memory-table.tsx:97`, per migration 0061's header grep).

This is exactly the "CLI-vs-server parity gap pattern" the brief asked to check for (PR #71 fixed one instance of it for date-surfacing). **Consequence for this plan**: every Phase 1 change that must move the LongMemEval numbers has to land in the CLI's `recall.ts` merge path, not (only) in `hybrid_recall`'s SQL. This plan therefore ships each Phase 1 change **twice** — once in the CLI path (eval-measured) and once in `hybrid_recall`/the MCP-server path (product-parity, not eval-measured, same "no harness rerun for this task" framing the prior plan used for its Task 3) — matching the repo's established hand-duplication convention (`embedding.ts`/`chunking.ts`/`date-extraction.ts` are each already duplicated per-package by design).

## Scope

**In scope (Phase 1):**
- `packages/cli/src/commands/recall.ts` — widen candidate pool, RRF fusion, temporal date-range channel, rerank wiring, assembled-context output flag (eval-measured path)
- `packages/cli/src/lib/rrf.ts`, `packages/cli/src/lib/reranker.ts`, `packages/cli/src/lib/temporal-recall.ts` (new modules), `packages/cli/src/lib/temporal-sort.ts` (export an existing private helper)
- `supabase/migrations/0062_hybrid_recall_rrf_fusion.sql` — new migration (SQL-side RRF, DEV only)
- `packages/server/src/tools/recall.ts`, `packages/server/src/search/reranker.ts` (new), `packages/server/src/search/temporal-channel.ts` (new), `packages/server/src/sync/supabase-sync.ts` — MCP-server-path parity (rerank, temporal channel, assembled context, widened candidate pool)
- `packages/cli/package.json`, `packages/server/package.json` — new runtime dependency for the primary (local cross-encoder) reranker, see Task 2's Ambiguities Resolved note below

**In scope (Phase 2):**
- `supabase/migrations/0063_memory_chunks_schema.sql` — new child table + HNSW index (DEV only)
- `supabase/migrations/0064_chunk_aware_recall.sql` — new/extended RPC(s) for chunk-level match + parent aggregation, **returning the winning chunk's identity (chunk_index/chunk_text), not just an aggregate score** (see Task 10)
- `packages/server/src/embeddings.ts`, `packages/cli/src/lib/embedding.ts` — new `generateChunkEmbeddings()` alongside the existing pooled `generateEmbedding()`
- `packages/server/src/tools/remember.ts`, `packages/cli/src/commands/remember.ts` — write-path integration (persist per-chunk rows in addition to the pooled vector)
- `packages/server/src/cache/sqlite.ts`, `packages/server/src/sync/supabase-sync.ts` — local cache + sync mirrors for chunk rows
- `packages/cli/src/commands/recall.ts`, `packages/server/src/tools/recall.ts` — read-path wiring to the new chunk-aware RPC
- `packages/server/scripts/backfill-chunk-embeddings.ts` — new backfill script for memories written before Phase 2 ships (mirrors `backfill-embeddings.ts`'s single-project-scope convention)

**Out of scope (both phases):**
- **Any prod migration/deploy.** Migrations 0062-0064 are DEV (`ugogdqzhhnuzwgcaovty`) only, same convention as 0061. Prod stays at 0060 for this entire effort.
- **Ingestion-time observation distillation (Mastra-style) and knowledge-update supersedence relations** — the two levers that separate 84% (this plan's ceiling) from 90%+ per the research briefs. Deliberately deferred — see "Phase 3 (not this plan)" note before Open Questions.
- **ColBERT-style late-interaction retrieval** — explicitly out of scope per the brief; not feasible on pgvector without a major architecture change.
- **Sentence-window chunking** — Phase 2 reuses the existing fixed-size chunker (`packages/server/src/chunking.ts`/`packages/cli/src/lib/chunking.ts`, already tuned to ~4000 chars / 15% overlap by the Tier-1 plan) rather than building a new sentence-boundary-aware chunker.
- **BM25 and graph spreading-activation channels** — two of Hindsight's four retrieval channels. Tages already has vector + trigram (functionally BM25-adjacent) equivalents; this amendment adds the temporal channel (Hindsight's 4th) as the highest-evidence remaining gap, but a true graph/spreading-activation channel is a materially larger architecture addition not justified by this session's evidence — flagged as a possible Phase 3+ candidate, not scoped here.
- **`apps/dashboard` code changes** — Phase 1's `hybrid_recall` migration keeps `RETURNS TABLE` unchanged (only internal scoring changes, same convention as 0061), so the dashboard's two callers need no code change. Phase 2's new/extended RPC(s) are additive, so the dashboard is unaffected.
- **Full-production chunk backfill** — Task 12's script is explicitly single-project-scope, same convention as the existing `backfill-embeddings.ts`.

**Ambiguities resolved:**
- **RRF rank constant `k`** → 60 (the standard/Elasticsearch-default RRF constant), applied identically in the CLI's TypeScript fusion (Task 1), the SQL fusion (Task 5), and the new temporal channel's contribution to that same fusion (Task 3/7).
- **Reranker provider (REVISED this amendment)** → **primary: a local cross-encoder, `Xenova/ms-marco-MiniLM-L-6-v2` via `@huggingface/transformers` (ONNX runtime, CPU, no API key, works offline).** This reverses the original plan's OpenAI-LLM-judge-as-primary recommendation. Evidence: SmartSearch's published pipeline runs a CrossEncoder+ColBERT fusion on CPU in ~650ms; Hindsight (the closest published architecture to Tages) uses the exact same `ms-marco-MiniLM-L-6-v2` cross-encoder; a real cross-encoder is the field's strongest-evidence rerank technique, ahead of LLM-judge approaches on quality, latency, and per-call cost. **Cost of this choice, stated honestly**: it adds a genuinely new runtime dependency (`@huggingface/transformers` + its ONNX runtime, ~90MB model cached to disk on first use) to both `packages/cli` and `packages/server`, which breaks the no-new-runtime-deps convention this repo has held for `embedding.ts`/`chunking.ts`/`date-extraction.ts`. This is a real tradeoff, not a free upgrade — **flagged as a decision Ryan ratifies at plan review** (see Open Questions), shipped as the evidence-backed default rather than silently assumed. `OpenAIJudgeReranker` (the original plan's design, unchanged) ships as the **fallback**, used when the cross-encoder model can't be downloaded/loaded (offline-first machines, sandboxed CI, or a Ryan veto on the new dependency) — both sit behind the same `Reranker` interface from the original plan, so the fallback requires no separate design work. Voyage/Cohere hosted rerank becomes a **third**, lowest-priority option (still blocked on key acquisition, per the original plan) — not "the upgrade path" as originally framed, since the local cross-encoder is now the primary recommendation and a hosted API is a downgrade on latency/cost/offline-capability, not an upgrade.
- **Rerank candidate window** → the reranker evaluates the top 20 of the RRF-fused pool (unchanged from the original plan — this constraint is about prompt/inference-batch size, not provider-specific, so it applies equally to the cross-encoder and the LLM-judge fallback). Output is the CLI's/tool's existing `limit` parameter, not a hardcoded "top-8."
- **Rerank failure mode** → fail-open, unchanged from the original plan: any error (model load failure, timeout, malformed LLM-judge response) returns the RRF-fused order unchanged, never throws, never blocks recall. The cross-encoder path additionally fails open into the OpenAI-judge fallback (not straight to "no rerank") when the local model is unavailable but `OPENAI_API_KEY`+`TAGES_OPENAI_EMBED` are set — only falls all the way through to "no rerank" when neither path is available.
- **Widening candidate pools does not fix the 11/50 zero-hit rows** — unchanged from the original plan (those rows fail the WHERE-clause threshold entirely; Phase 2 is what's expected to move the zero-hit count).
- **Chunking strategy for Phase 2** → plain fixed-size chunks (reuse existing `chunkText()`), not sentence-window — unchanged from the original plan.
- **Chunk table RLS** → mirror the existing `memories` table's RLS policies — unchanged from the original plan.
- **Temporal date-range channel scope (NEW this amendment)** → the channel only activates for queries `isTemporalQuery()` classifies as temporal **and** for which `extractTargetDate()` resolves an actual date/window from the query text (e.g. "what did I do on July 9" or "3 weeks ago"). Temporal queries with no resolvable date ("when did I last deploy," which needs semantic understanding of "last deploy," not a literal date parse) get zero benefit from this channel and continue to rely on the existing `sortByTemporalProximity`/`reorderByTemporalProximity` re-ordering step alone — this is a real, stated limitation, not silently glossed over. Implemented as a plain client-side/PostgREST query against `memories` (filtered by `project_id`, `status = 'live'`, non-null `referenced_date`/`relative_date`, ranked by date-proximity to the resolved target), **not** a new SQL RPC/migration — keeps this task's scope and risk down (no 5th migration in an already-migration-heavy plan) and avoids a DB-migration effort multiplier.
- **Assembled-context output (NEW this amendment)** → shipped as a single task covering both the CLI (`--assembled-context` flag on the existing `recall` command) and the MCP `recall` tool (an `args.assembledContext` boolean), rather than split into CLI/parity-pair tasks like the rest of this plan — the brief's own framing treats it as one small, portable capability, and both surfaces reuse the exact same dedup+chronological-group+budget logic. **Naming note**: deliberately named `--assembled-context`, not `--context`, to avoid collision with the CLI's pre-existing, unrelated `recall-context` subcommand (`packages/cli/src/commands/recall-context.ts`, registered at `packages/cli/src/index.ts:214-221`) — that command does git-diff-based contextual filtering via a different RPC (`contextual_recall`) and has nothing to do with token-budget assembly; verified this session by reading it, to avoid a naming collision the original brief's phrasing risked.

## Type Dependencies
- `Memory` interface (`packages/shared/src/types.ts:39-79`) — unchanged by Phase 1. Phase 2 does **not** add fields to `Memory` (chunk vectors live in a separate child table).
- New (not shared, package-local) types: `RerankCandidate { id: string; text: string }` and `Reranker { rerank(query, candidates, topK): Promise<string[]> }` — one per package, matching the `embedding.ts`/`chunking.ts` duplication pattern. **Two concrete implementations per package this amendment**: `LocalCrossEncoderReranker` (primary) and `OpenAIJudgeReranker` (fallback), both implementing `Reranker`.
- New (not shared) type: a `MemoryChunk` row shape (`id`, `memory_id`, `project_id`, `chunk_index`, `chunk_text`, `embedding`) — package-local.
- New (not shared, NEW this amendment) type: `TemporalCandidate { id: string; proximityScore: number }` — the ranked-list item shape the temporal date-range channel contributes to `reciprocalRankFusion`. Package-local (CLI: `temporal-recall.ts`; server: `search/temporal-channel.ts`).
- Confirmed this session: CLI's `packages/cli/src/lib/temporal-sort.ts` exports `isTemporalQuery` (line 111) but its `extractTargetDate` (line 119) is a **private, non-exported** function — the server's equivalent (`packages/server/src/search/temporal-query.ts`) already exports both `isTemporalQuery` (line 104) and `extractTargetDate` (line 119). Task 3 below must add `export` to the CLI's `extractTargetDate` as part of its diff — a small, verified, concrete change, not an assumption.

## Critical setup gap — DEV-pointed eval path (blocks E2E validation for every task below)

The eval sandbox project `longmemeval-sandbox` (`~/.config/tages/projects/longmemeval-sandbox.json`, verified this session: `supabaseUrl: https://wezagdgpvwfywjoxztfs.supabase.co` — **prod**) lives on PROD Supabase. Migrations 0062-0064 in this plan (like 0061 before them) go to DEV (`ugogdqzhhnuzwgcaovty`) only. The eval **cannot** validate any of this plan's RPC/schema changes until it can point at a DEV project. This also means migration 0061's recall lift is itself still unmeasured against the harness — Task 0 unblocks that retroactively as a side effect.

Verified this session: `packages/cli/src/config/project.ts`'s `loadProjectConfig()` reads a static JSON file (`~/.config/tages/projects/<slug>.json`) containing `supabaseUrl`/`supabaseAnonKey`/`projectId` — these are baked in at `tages init` time, not read from env at recall/remember runtime. `packages/cli/src/commands/init.ts` (lines 11-13) already supports `TAGES_SUPABASE_URL`/`TAGES_SUPABASE_ANON_KEY` env overrides at init time, and `packages/cli/src/auth/session.ts`'s `createAuthenticatedClient` (lines 13-18) already supports a `TAGES_SERVICE_KEY` env var that bypasses RLS entirely, documented in its own header as "for CI/headless use." `docs/dev-env-teardown.md` confirms a dedicated "Tages (Dev)" GitHub OAuth app already exists against the DEV Supabase project (implying DEV has been used interactively before, likely with a real `auth.users` row already present for Ryan's GitHub identity).

- [ ] **Task 0 — Stand up a DEV-pointed eval project + verify the E2E validation gate can actually run**
  - Files: none (no code changes — this is a one-time environment/config setup task using existing CLI flags and env vars, all verified to already exist above)
  - Steps:
    1. **Preferred path (uses existing OAuth flow, satisfies `projects.owner_id references auth.users(id) not null` per `supabase/migrations/0001_initial_schema.sql:14-18` — a raw service-role `INSERT` would need a real `auth.users` row anyway):** from an empty scratch directory, run `TAGES_SUPABASE_URL=https://ugogdqzhhnuzwgcaovty.supabase.co TAGES_SUPABASE_ANON_KEY=<DEV anon key> tages init --slug longmemeval-sandbox-dev`, complete the GitHub OAuth flow via the existing "Tages (Dev)" OAuth app. This writes `~/.config/tages/projects/longmemeval-sandbox-dev.json` pointing at DEV. The DEV anon key is not present anywhere in this repo (confirmed via grep this session) — Ryan must pull it from the Supabase dashboard (Settings → API) for the `ugogdqzhhnuzwgcaovty` project. **This step requires a human/interactive browser session — not Howler-automatable.**
    2. Confirm `supabase migration list --linked` (from repo root, after `supabase link --project-ref ugogdqzhhnuzwgcaovty` if not already linked) shows `0061` applied and the linked ref is DEV, not `wezagdgpvwfywjoxztfs`.
    3. Smoke test the real round-trip: `TAGES_EVAL_PROJECT=longmemeval-sandbox-dev` env, then `tages remember smoke-test-dev "test memory pointing at dev" --project longmemeval-sandbox-dev` followed by `tages recall "test memory" --project longmemeval-sandbox-dev` — confirm it returns the memory.
    4. Update this plan's **E2E Validation Gate** section below (already written to use `longmemeval-sandbox-dev`) — no further doc change needed once Task 0 completes.
  - Tests: none (infra task) — Step 3's real round-trip *is* the test.
  - Depends on: nothing. **Blocks the E2E Validation step of every other task in this plan** (not the coding — coding tasks can start in parallel, see File Ownership Matrix), so front-load it.
  - Effort: M (1.5x uncertainty multiplier applied: the DEV anon key's exact retrieval path and whether the "Tages (Dev)" OAuth app's callback URL still resolves correctly — `docs/dev-env-teardown.md` documents *tearing down* this exact app/project, meaning it may already be degraded or partially decommissioned — is not verifiable from the repo alone).
  - Pre-mortem: If this takes 3x longer, it will be because the DEV OAuth app or DEV project has already been partially torn down (per `docs/dev-env-teardown.md`'s own existence — someone was actively considering decommissioning DEV) and Task 0 has to first *re-provision* rather than just *use* the DEV auth flow. Mitigate: run Step 2 (`supabase migration list --linked`) FIRST, before attempting OAuth — if DEV is unreachable at the Postgres level, the OAuth flow will fail too, and that's a faster, cheaper signal than debugging a stuck browser flow.
  - Notes: Fallback if OAuth proves broken: use `TAGES_SERVICE_KEY` (DEV service role key, if Ryan has it) to bypass RLS and hand-write the project config JSON directly — but the manual `projects` row still needs a valid `owner_id` referencing an existing `auth.users(id)` row in DEV, so this fallback is not meaningfully simpler unless such a row is already confirmed to exist.

---

## Phase 1 (Tier 1): Two-stage retrieve → RRF fuse (3-4 channels) → rerank → assemble

## E2E Validation Gate (hard gate — applies to every Phase 1 and Phase 2 task below)

Carried forward verbatim from the "Memory Retrieval Precision/Recall" plan above (same rule, same rationale — green unit tests are necessary-not-sufficient), with `TAGES_EVAL_PROJECT` updated to the DEV-pointed project from Task 0, and interpreted against this amendment's recalibrated targets above (low-to-mid 70s overall, not 90s).

**Standard rerun procedure:**

```bash
# 0. MANDATORY if the task touched packages/cli/src/** — rebuild, or the rerun tests stale dist:
pnpm --filter @tages/server build && pnpm --filter @tages/cli build

# 1. Ensure PATH-first shim resolves `tages` to this repo's freshly-built dist
#    (per PLAN.md's established eval-mechanics convention — global npm-linked
#    0.2.0 CLI lacks all repo changes).

# 2. Rerun the 50q calibration sample, same seed as baseline, DEV project only:
cd eval/longmemeval
set -a; source .env; set +a
PATH=<shim>:$PATH TAGES_OPENAI_EMBED=1 TAGES_EVAL_PROJECT=longmemeval-sandbox-dev TAGES_SETTLE_MS=0 \
  ./node_modules/.bin/tsx src/run.ts --n 50 --seed 42 --backend tages-cli \
  --output results/tages-<task-id>-$(date +%Y%m%d-%H%M).json

# 3. Diff against baseline (results/tages-pr-50q-20260710.json) on:
#    overall_accuracy, recall_at_k, per-type breakdowns for the task's target type(s),
#    and the recalled_memory_count == 0 row count (11/50 baseline).
```

**Pass/fail rule:** a task's target metric must move in the expected direction versus baseline. No movement or a regression means the task **failed**, regardless of unit test / code review status. Non-target metrics must not regress beyond sample noise (±1 question in a stratum with n≈3-7 is noise; a swing in `overall_accuracy` or a stratum with n≈13 is not).

**Beyond the aggregate number — read the raw rows.** Before declaring any task done, open the new results JSON's `details[]` array and manually read 2-3 previously-wrong or previously-zero-hit rows this task targeted. Confirm the *mechanism* changed, not just the percentage.

**Product-behavior smoke checklist** (run once, at the end, on the combined diff, not per-task):
- [ ] **Dist freshness**: every touched compiled `dist/` file (CLI and server) has a newer mtime than the last source commit.
- [ ] **Real CLI round-trip, not mocked**: `tages remember` + `tages recall` against DEV, visually inspect terminal output for the expected new content (Task 2: reranked ordering differs from RRF-only order on a query with >5 threshold-passing candidates; Task 3: a date-named query pulls in a memory the trigram/semantic channels alone missed; Task 4: `--assembled-context` produces one chronologically-ordered, dated block, default output unchanged; Task 11/10: a previously zero-hit long-session case now returns rows, with a specific matched chunk cited).
- [ ] **DB round-trip against DEV, not a mock client**: after each migration, run the RPC directly via `psql`/Supabase SQL editor against real rows.
- [ ] **Async/process-lifecycle**: confirm `tages remember`'s synchronous embedding write (and Phase 2's new chunk-embedding writes) complete before CLI process exit.
- [ ] **Migration scope check**: `supabase migration list --linked` confirms 0062/0063/0064 applied to `ugogdqzhhnuzwgcaovty` (DEV) only; the same command against prod must NOT show them.
- [ ] **Rerank cost/latency sanity (REVISED this amendment)**: one real `tages recall` call with the cross-encoder enabled completes fast (~sub-second, per SmartSearch's published ~650ms CPU figure — a multi-second stall indicates the ONNX model download/load path is broken, not just slow); confirm the model is cached to disk after the first call (no repeated download); confirm a forced-offline run correctly falls back to `OpenAIJudgeReranker` (or to no-rerank if that's also unavailable) rather than hanging or throwing.
- [ ] **Default-output regression (NEW this amendment)**: `eval/longmemeval/src/memory.ts`'s `parseRecallKeys` (lines 276-289) still parses `tages recall`'s **default** (non-`--assembled-context`) output correctly — Task 4 must not have changed the default format. Run one harness question through the parser manually if in doubt.

---

## Tasks (Phase 1)

- [ ] **Task 1 — Widen the CLI's candidate pool and replace raw-score merge with Reciprocal Rank Fusion**
  - Files:
    - Create `packages/cli/src/lib/rrf.ts` — `reciprocalRankFusion<T extends {id: string}>(rankedLists: T[][], k?: number): T[]`. For each list, item at 1-based rank `r` contributes `1/(k+r)` (default `k=60`); scores for the same `id` across lists are summed (0 contribution if absent from a list); returns items sorted by summed score desc, with row data merged preferring whichever list ranked the id higher (mirrors the existing "semantic results first" tie-break already in `recall.ts:157-170`). **Designed from the start to accept a variable number of lists** (not hardcoded to 2), since Task 3 and Task 11 below each add a third and fourth list to the same fusion call.
    - Modify `packages/cli/src/commands/recall.ts` — add a `RECALL_CANDIDATE_POOL` constant (default 50, overridable via `TAGES_RECALL_CANDIDATE_POOL` env, mirroring the existing `TAGES_RECALL_THRESHOLD` override pattern at lines 20-30). In the hybrid-search branch (lines 116-186), change both RPC calls' `p_limit` from `limit` to the candidate-pool constant (`recall_memories` call at line 119-124, `semantic_recall` call at lines 136-142). Replace the current merge (lines 153-173) with `reciprocalRankFusion([trigramResult.data, semanticResult.data])`. Everything downstream (`dedupeNearDuplicateContent`, `sortByTemporalProximity`, final `.slice(0, limit)`) is unchanged.
  - Tests:
    - Create `packages/cli/src/__tests__/rrf.test.ts` — an item ranked #1 in both lists outranks an item ranked #1 in only one list; an item absent from a list gets 0 contribution from it, not an error; `k` changes the spread but not the relative order for a fixed input; empty lists don't throw; a 3-list and 4-list input fuse correctly (not just the 2-list case), anticipating Task 3/Task 11.
    - Modify `packages/cli/src/__tests__/recall.test.ts` — assert both RPC calls now request the candidate-pool limit; assert the final result count is still capped at the user's `limit`; assert `TAGES_RECALL_CANDIDATE_POOL` overrides the default.
  - E2E Validation: Standard rerun procedure. Target: `overall_accuracy` and `recall_at_k` should not regress and should trend up slightly wherever more than `limit` candidates previously passed threshold. Read 2-3 `single-session-preference`/`multi-session` rows and confirm the *set* of memories reaching the reader actually changed, not just their order.
  - Depends on: nothing (parallel-safe against Task 5; different files — CLI package vs. SQL migration).
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because `TagesCliStore`'s harness-side `parseRecallKeys` (`eval/longmemeval/src/memory.ts:276-289`) is brittle to `tages recall`'s output ordering in some untested way — mitigate by running the smoke checklist's real CLI round-trip before trusting any harness delta.
  - Notes: This is the foundation Tasks 2, 3, 4, and 11 all build on — sequenced first in the file-ownership chain for `recall.ts`.

- [ ] **Task 2 — Cross-encoder rerank pass on the CLI's RRF-fused candidate pool (REVISED this amendment: cross-encoder primary, not LLM-judge)**
  - Files:
    - Create `packages/cli/src/lib/reranker.ts` — `interface RerankCandidate { id: string; text: string }`, `interface Reranker { rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<string[]> }` (returns ids in ranked order). **Two implementations**: `class LocalCrossEncoderReranker implements Reranker` — loads `Xenova/ms-marco-MiniLM-L-6-v2` via `@huggingface/transformers`' pipeline API (ONNX runtime, CPU inference, cached to disk on first use, no network call after first load), scores each (query, candidate) pair, sorts desc. `class OpenAIJudgeReranker implements Reranker` — unchanged from the original plan (one `gpt-4o-mini` listwise chat-completion call over the same top-20 window), now the **fallback** when the local model can't be loaded (offline, sandboxed, or explicitly disabled). Selection order: try `LocalCrossEncoderReranker` first; on load/inference failure, fall back to `OpenAIJudgeReranker` if `OPENAI_API_KEY`+`TAGES_OPENAI_EMBED` are set; if neither is available, return the input order unchanged (no rerank — same fail-open philosophy as `generateEmbedding`).
    - Modify `packages/cli/package.json` — add `@huggingface/transformers` as a new runtime dependency. **This is a genuinely new dependency class for this repo** (verified this session: neither `packages/cli/package.json` nor `packages/server/package.json` currently reference `transformers`/`onnxruntime`/`huggingface` in any form) — flagged explicitly in Ambiguities Resolved and Open Questions, not silently added.
    - Modify `packages/cli/src/commands/recall.ts` — after `dedupeNearDuplicateContent` (line 177) and before `sortByTemporalProximity` (line 184), call the reranker on the top 20 of `contentDeduped`, re-splice the reranked subset back to the front of the list (rows beyond 20 keep their RRF order, appended after).
  - Tests:
    - Create `packages/cli/src/__tests__/reranker.test.ts` — `LocalCrossEncoderReranker` reorders candidates per a mocked/small-fixture model run; a model-load failure falls back to `OpenAIJudgeReranker`; `OpenAIJudgeReranker`'s own tests (malformed JSON, network error → input order unchanged) carry over from the original plan unchanged; only the top 20 are sent to either backend (assert payload length), not all 50; both backends unavailable → input order unchanged, no throw.
    - Modify `packages/cli/src/__tests__/recall.test.ts` — rerank step is skipped entirely (no model load attempted, no API call attempted) only when both backends are genuinely unavailable — unlike the original plan's design, the cross-encoder path does **not** require `TAGES_OPENAI_EMBED` to be set (it has no OpenAI dependency), so this test must be updated to reflect that the opt-in gate now only governs the `OpenAIJudgeReranker` fallback, not rerank as a whole.
  - E2E Validation: Standard rerun procedure. Target: `overall_accuracy` should move up (the highest-evidence single lever per this amendment's research — SmartSearch's oracle analysis directly attributes the recall-vs-accuracy gap to exactly this rank-then-truncate step) without `recall_at_k` regressing. Read the raw rows for the 3 `single-session-preference` questions specifically (baseline 33% accuracy vs. 67% recall@k) and confirm whether reranking changed which memory made the final top-`limit` cut.
  - Depends on: Task 1 (same file, `recall.ts` — sequential per Gate 5c).
  - Effort: L (1.5x uncertainty multiplier: pre-mortem below states genuine "don't know yet" risk about ONNX runtime packaging across platforms, which per the Effort Calibration rule triggers the multiplier from base M).
  - Pre-mortem: If this takes 3x longer, it will be because `@huggingface/transformers`'s ONNX runtime has platform-specific native-binding or bundling issues when packaged into `npm install -g @tages/cli` (this repo's actual distribution model, confirmed via the CLI's `bin` entry pointing at compiled `dist/`) — cross-platform ONNX packaging for a globally-installed CLI is meaningfully riskier than for a server-side-only dependency, and this risk is untested in this repo as of this planning pass. Mitigate: verify the global-install path (`npm pack` + local install, not just `pnpm --filter @tages/cli build` + workspace symlink) works on at least macOS (Ryan's dev env) before considering this task's packaging done, and treat a packaging failure as grounds to fall back to `OpenAIJudgeReranker`-only for the CLI specifically (the MCP server, which is typically run via `npx` per-invocation rather than globally installed, may tolerate the dependency better — see Task 6).
  - Notes: Zero-conflict with Task 5/6 (different packages, and Task 6 is sequenced independently). This is the plan's single highest-evidence-backed change per the research briefs, and also its single highest-packaging-risk change — both stated plainly rather than only emphasizing the upside.

- [ ] **Task 3 — Temporal date-range retrieval channel (NEW this amendment — Hindsight's 4th channel, CLI path)**
  - Files:
    - Modify `packages/cli/src/lib/temporal-sort.ts` — add `export` to the existing private `extractTargetDate` function (line 119; currently `function extractTargetDate(query: string, anchor: Date): Date | undefined`, logic unchanged, only the export keyword is new). `isTemporalQuery` (line 111) is already exported — no change needed there.
    - Create `packages/cli/src/lib/temporal-recall.ts` — `fetchTemporalCandidates(supabase: SupabaseClient, projectId: string, query: string, limit: number): Promise<Array<{ id: string }>>`. Returns an empty array immediately (no query issued — zero added latency/cost) when `isTemporalQuery(query)` is false or `extractTargetDate(query, new Date())` resolves nothing (see Ambiguities Resolved on this channel's real limitation). Otherwise runs a plain PostgREST query (`supabase.from('memories').select('id, referenced_date, relative_date').eq('project_id', projectId).eq('status', 'live').not('referenced_date', 'is', null).or('relative_date.not.is.null')` — approximate shape, exact PostgREST filter syntax to be verified against the live schema during implementation, not hand-tested in this planning pass), then ranks the results client-side by date-proximity to the resolved target using the same proximity formula already in `temporal-sort.ts`'s private `reorderProximity` (line 146) — this task reuses that formula rather than reimplementing it, so it must also be exported or the ranking logic duplicated inline with a comment pointing back to the original.
    - Modify `packages/cli/src/commands/recall.ts` — in the hybrid-search branch, add `fetchTemporalCandidates(...)` as a third parallel promise alongside `trigramPromise`/`semanticPromise` (lines 118-142), and pass its (possibly empty) result as a third list into Task 1's `reciprocalRankFusion([...])` call.
  - Tests:
    - Create `packages/cli/src/__tests__/temporal-recall.test.ts` — a non-temporal query issues zero PostgREST calls; a temporal query with no resolvable date issues zero calls; a temporal query with a resolvable date issues the expected filtered query and ranks results by proximity to the resolved target, nearest first.
    - Modify `packages/cli/src/__tests__/recall.test.ts` — the fused output includes a memory found only via the temporal channel (not trigram or semantic) when its `id` is present in that channel's mocked results.
  - E2E Validation: Standard rerun procedure. Target: `accuracy_by_type['temporal-reasoning']` (baseline 38.5%, the weakest stratum) and its `recall_at_k` should move up. Read the raw rows for temporal-reasoning questions with a resolvable explicit date in the question text specifically (not all 13 — only the subset this channel can plausibly help, per the stated real limitation above) and confirm the *set* of retrieved memories changed for those, not the full stratum uniformly.
  - Depends on: Task 2 (same file, `recall.ts` — sequential per Gate 5c; the temporal-channel promise is added to the same fusion call site Task 1 created and Task 2 already inserted a rerank step around).
  - Effort: M
  - Pre-mortem: If this task shows no movement on `temporal-reasoning` accuracy, it will most likely be because most of that stratum's questions ("when did I last deploy," "how long ago did X happen") don't name an explicit, regex-extractable date — `extractTargetDate` can only resolve dates the existing `date-extraction.ts` regex patterns already handle (absolute dates, "N days/weeks ago," "last/next weekday" — per the Tier-1 plan's Task C scope), not open-ended relative references requiring semantic understanding. This is a real, bounded limitation stated up front, not a surprise if the rerun shows a partial rather than full stratum improvement.
  - Notes: Reuses `date-extraction.ts`'s `extractDates` (confirmed exports this session: `packages/cli/src/lib/date-extraction.ts:163` `extractDates(text, anchorDate)`) via `temporal-sort.ts`'s existing private wrapper — no new date-parsing logic invented, only a new retrieval query built on top of dates already being extracted.

- [ ] **Task 4 — Budget-fitted, chronologically-ordered assembled-context output (NEW this amendment — CLI flag + MCP tool field, bundled per Ambiguities Resolved)**
  - Files:
    - Modify `packages/cli/src/commands/recall.ts` — add a `--assembled-context` boolean option (registered on the existing `recall` command in `packages/cli/src/index.ts:82-89`; exact `.option(...)` call site to be added during implementation). When set, after the existing fusion/rerank/temporal-sort pipeline produces `data` (line 185), branch to a new `printAssembledContext(data)` function instead of the existing per-row print loop (lines 195-214) — **the existing per-row loop is completely unchanged when the flag is absent**, so the harness's default-mode output (and `parseRecallKeys`) is untouched. `printAssembledContext` groups `data` by whether each row came from a top-tier fused/reranked position vs. a lower-ranked fallback, sorts chronologically within each group by `referenced_date ?? relative_date ?? created_at`, prefixes each entry with its resolved date, dedupes (reusing `dedupeNearDuplicateContent`, already applied upstream so this is mostly a no-op safety net), and trims to a character-based token-budget estimate (reuse the existing `estimateTokens`-style char/4 heuristic already established in `packages/server/src/search/token-budget.ts:4` and `packages/*/chunking.ts`'s `estimateTokenCount` — CLI adds its own small local copy rather than importing across packages, matching the established per-package duplication convention).
    - Modify `packages/server/src/tools/recall.ts` — add an `args.assembledContext?: boolean` input (schema change in `packages/server/src/schemas.ts` for the `recall` tool's Zod input schema — file/line not verified in this planning pass, confirm during implementation). When set, `formatResults` (line 169) branches to a new `formatAssembledContext(memories, query)` function reusing the same grouping/chronological-order/budget logic as the CLI (server already has `budgetedResults`/`estimateTokens` from `token-budget.ts` natively, so no local duplication needed server-side). Default (unset) behavior is completely unchanged.
  - Tests:
    - Create `packages/cli/src/__tests__/recall-assembled-context.test.ts` — `--assembled-context` output is one block, chronologically ordered, each entry date-prefixed, budget-trimmed at a small test threshold; default (no flag) output is byte-identical to before this task (regression guard, directly protecting `parseRecallKeys`).
    - Modify `packages/server/src/__tests__/recall.test.ts` (or equivalent) — `assembledContext: true` produces the grouped/dated block; `assembledContext` unset/false produces the existing numbered-passage format unchanged.
  - E2E Validation: **No harness rerun credit** — this is an opt-in, additive output mode; the harness never passes `--assembled-context` and the MCP path it never calls anyway (harness only shells to the CLI's default `tages recall`). Its proof is a real-product probe: `tages recall "what did we decide about X" --project <dev-project> --assembled-context`, visually confirm one deduped, dated, chronologically-ordered block; separately confirm the harness's `parseRecallKeys` still parses a **default**-mode `tages recall` call correctly post-merge (the smoke checklist's new "Default-output regression" item above).
  - Depends on: Task 3 (same file, `recall.ts` — sequential; this task's output-formatting change is logically last in the CLI pipeline, after fusion/rerank/temporal-channel/temporal-sort all produce the final `data` array).
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because the "grouped by relevance tier, chronological within group" spec is underspecified at the boundary (how many tiers? where's the cutoff between "top-tier fused/reranked" and "fallback"?) and needs a concrete design decision during implementation that this planning pass deliberately left flexible (the brief's own wording — "results grouped by relevance, chronologically ordered within groups" — doesn't specify tier boundaries). Mitigate: default to two tiers only (top-`limit`-after-rerank vs. everything else that survived the candidate pool but got cut) rather than inventing a finer-grained scheme, and treat any finer tiering as a follow-on refinement, not a blocker for shipping this task.
  - Notes: Small, portable, evidence-backed (Mastra ships a chronological dated log; SmartSearch's finding that budget-cut is where answers die directly motivates a caller-controllable, budget-aware output mode). Zero conflict with Task 11 (Phase 2's chunk-channel wiring) as long as Task 11 lands before this task in the file-ownership chain — see updated File Ownership Matrix.

- [ ] **Task 5 — RRF fusion parity in `hybrid_recall` (SQL-side, migration 0062)**
  - Files:
    - Create `supabase/migrations/0062_hybrid_recall_rrf_fusion.sql`. Reproduce `hybrid_recall`'s current definition (`supabase/migrations/0061_word_similarity_recall_fix.sql`, preserving `referenced_date`/`relative_date` and the `word_similarity` widening verbatim) with the `trigram_results`/`vector_results`/`combined`/`deduped` pipeline replaced: add a `RANK() OVER (ORDER BY sim DESC)` column to each of `trigram_results` and `vector_results`, then replace the current `UNION ALL` + `DISTINCT ON (id) ORDER BY sim DESC` with a `FULL OUTER JOIN ... ON trigram_results.id = vector_results.id`, computing `rrf_score = COALESCE(1.0/(60+trigram_rank), 0) + COALESCE(1.0/(60+vector_rank), 0)`, ordering by `rrf_score DESC`. `match_type` becomes `'both'` when a row has both ranks, else `'trigram'`/`'semantic'`. `k=60`, matching Task 1's TypeScript constant.
    - `recall_memories` (the non-hybrid trigram-only RPC) is unchanged.
    - No application code changes required for `RETURNS TABLE` shape.
  - Tests: No automated SQL test harness in this repo (confirmed via search) — manual SQL smoke test.
  - E2E Validation:
    1. Grep the blast radius fresh and confirm it still matches 0061's documented 3 call sites before applying.
    2. Apply to DEV only, confirmed via `supabase migration list --linked` before AND after.
    3. Manual SQL smoke test: `match_type = 'both'` appears for at least one row scoring on both signals; ordering changed versus a pre-migration snapshot.
    4. **No harness rerun credit for this task alone** — the harness doesn't call `hybrid_recall`. Its value is MCP-server/dashboard-path product correctness.
  - Depends on: nothing (parallel-safe against Tasks 1-4 — SQL-only, different files).
  - Effort: L (base M for the CTE rewrite; ×1.5 database-migration multiplier).
  - Pre-mortem: If this takes 3x longer, it will be because `FULL OUTER JOIN` on two threshold-filtered CTEs produces a subtly different NULL-handling edge case than the current `UNION ALL`+`DISTINCT ON`. Mitigate: test the 3-callers' actual TypeScript consumption against a manually-applied DEV migration before considering this task done.
  - Notes: Zero file overlap with any other task — SQL-only.

- [ ] **Task 6 — Cross-encoder rerank parity in the MCP-server recall path (REVISED this amendment, same provider change as Task 2)**
  - Files:
    - Create `packages/server/src/search/reranker.ts` — server-package duplicate of Task 2's `Reranker` interface, `LocalCrossEncoderReranker`, and `OpenAIJudgeReranker` (same hand-duplication convention).
    - Modify `packages/server/package.json` — add `@huggingface/transformers` (same new-dependency flag as Task 2's `packages/cli/package.json` change; the MCP server is typically invoked via `npx @tages/server` per-session rather than globally installed, which somewhat lowers the cross-platform packaging risk flagged in Task 2's pre-mortem, but doesn't eliminate it).
    - Modify `packages/server/src/tools/recall.ts` — widen the `limit` passed to `sync.remoteHybridRecall(args.query, embedding, args.type, limit)` (line 79) to a candidate-pool constant. Insert rerank *before* the existing `reorderByTemporalProximity(results, args.query)` call (line 81), so temporal anchoring stays the final authority over ordering (matches the Tier-1 plan's "on top of, not replacing" design intent). Slice to `args.limit` only after both steps.
  - Tests:
    - Create `packages/server/src/__tests__/reranker.test.ts` — mirrors Task 2's `reranker.test.ts` (local model reorder, fallback to OpenAI-judge, fail-open when neither available, top-20 cap).
    - Modify the existing suite covering `handleRecall`'s remote-hybrid branch (exact filename to confirm during implementation) — `remoteHybridRecall` now called with the widened candidate-pool limit; rerank runs before `reorderByTemporalProximity`.
  - E2E Validation: **No harness rerun credit** (MCP-server tool path, never exercised by the harness). Real-product probe: run the MCP server locally, issue a `recall` tool call against a DEV project with more than `limit` threshold-passing candidates, visually confirm reranking changed the returned passage order versus a rerank-disabled control run.
  - Depends on: Task 5 (needs the widened/RRF-fused `hybrid_recall` pool) — different package/files than Tasks 1-4, parallel-safe against those.
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because rerank inserted here never actually fires for most real MCP-tool users — `handleRecall`'s local-SQLite-cache-first branch (lines 38-74) returns early at line 73 whenever the local cache has results, meaning only users hitting the remote-hybrid fallback path see this task's rerank. This is a real, pre-existing scope limitation, not a bug — flag it explicitly in the PR description.
  - Notes: Zero file overlap with Task 1-4 (different package). Overlaps with Task 7 and Task 11 in `packages/server/src/tools/recall.ts` — sequenced, see updated File Ownership Matrix.

- [ ] **Task 7 — Temporal date-range retrieval channel parity (NEW this amendment — MCP-server path)**
  - Files:
    - Create `packages/server/src/search/temporal-channel.ts` — server-package equivalent of Task 3's `fetchTemporalCandidates`, reusing the already-exported `isTemporalQuery`/`extractTargetDate` from `packages/server/src/search/temporal-query.ts` (both already exported, confirmed this session — no export-keyword fix needed server-side, unlike the CLI copy) and the proximity formula already present in `packages/server/src/search/ranker.ts`'s private `reorderProximity` (line 173; export it or duplicate inline with a pointer comment, matching Task 3's CLI-side approach).
    - Modify `packages/server/src/tools/recall.ts` — add the temporal channel as a third source feeding into the MCP-server path's candidate fusion, alongside the trigram/semantic results from `remoteHybridRecall`.
  - Tests: Create `packages/server/src/__tests__/temporal-channel.test.ts` — mirrors Task 3's CLI-side test cases (zero-cost skip for non-temporal/no-resolvable-date queries, proximity-ranked results for resolvable ones).
  - E2E Validation: **No harness rerun credit** (MCP-server path). Real-product probe: MCP `recall` tool call with an explicit-date query against DEV, confirm a memory findable only via date-range match is now returned.
  - Depends on: Task 6 (same file, `packages/server/src/tools/recall.ts` — sequential per Gate 5c).
  - Effort: M
  - Pre-mortem: Same core risk as Task 3 (only explicit, regex-resolvable dates benefit) — see Task 3's pre-mortem, applies identically here.
  - Notes: Design mirrors Task 3 deliberately for consistency between the two paths, per the brief's explicit ask to check for CLI/server parity gaps.

---

## Phase 2 (Tier 2): Multi-vector chunk storage + parent-doc retrieval

- [ ] **Task 8 — Schema: `memory_chunks` child table + HNSW index (migration 0063)**
  - Files:
    - Create `supabase/migrations/0063_memory_chunks_schema.sql` — `CREATE TABLE memory_chunks (id uuid primary key default gen_random_uuid(), memory_id uuid not null references memories(id) on delete cascade, project_id uuid not null references projects(id) on delete cascade, chunk_index int not null, chunk_text text not null, embedding vector(1536), created_at timestamptz not null default now())`; `CREATE INDEX memory_chunks_memory_id_idx ON memory_chunks(memory_id)`; `CREATE INDEX memory_chunks_embedding_idx ON memory_chunks USING hnsw (embedding vector_cosine_ops)` (mirrors `memories.embedding`'s own index exactly, per `supabase/migrations/0008_pgvector.sql:12-14`); RLS enabled with policies mirroring `memories`' current policies (`0002_rls_policies.sql`, hardened by `0031_rbac_write_policies.sql`) — **grep and diff the exact current policy SQL before writing this migration**, not invented in this planning pass. Session-level `set search_path = public, extensions;` plus per-function `SET search_path` on any function this migration defines, per the 0060/0061 pattern.
  - Tests: No automated SQL harness. Manual: apply to DEV, confirm table/indexes/RLS via `information_schema` queries and a real insert-as-authenticated-user smoke test.
  - Depends on: nothing new (parallel-safe against all of Phase 1; must land before Task 9).
  - Effort: M (base S; ×1.5 database-migration multiplier).
  - Pre-mortem: If this takes 3x longer, it will be because the RLS policy mirror is subtly wrong (missing the `0031` RBAC-role check, silently reverting to `0002`'s looser baseline) — this is the exact class of bug behind the `feedback_rls_function_diff` incident referenced in project memory. Mitigate: diff against `0031`'s live definition specifically, smoke-test as a real non-owner project member.
  - Notes: Zero file overlap with any Phase 1 task.

- [ ] **Task 9 — Write path: persist per-chunk embeddings alongside the pooled vector**
  - Files:
    - Modify `packages/server/src/embeddings.ts` — add `generateChunkEmbeddings(text: string): Promise<{ pooled: number[] | null; chunks: Array<{ text: string; embedding: number[] }> } | null>`, reusing `chunkText()` and the existing single-chunk embedding call inside `embedLongTextViaOpenAI`. `generateEmbedding()` itself is unchanged.
    - Modify `packages/cli/src/lib/embedding.ts` — same, CLI copy.
    - Modify `packages/server/src/tools/remember.ts` — in `scheduleEmbeddingSync` (lines 195-215), additionally call `generateChunkEmbeddings` and persist chunk rows (new `cache.upsertChunks`/`sync.remoteUpsertChunks`), still fire-and-forget, still fail-open.
    - Modify `packages/cli/src/commands/remember.ts` — same integration point as the existing synchronous `embedding = await generateEmbedding(value)` call (lines 65-74), awaited, matching this file's existing durable-write design.
    - Modify `packages/server/src/cache/sqlite.ts` — add a local `memory_chunks` table mirroring the `memories` table's pattern, plus `upsertChunks(memoryId, projectId, chunks)`.
    - Modify `packages/server/src/sync/supabase-sync.ts` — add `remoteUpsertChunks(memoryId, projectId, chunks)` (delete-then-insert-by-`memory_id`).
  - Tests:
    - `packages/server/src/__tests__/embeddings.test.ts` — `generateChunkEmbeddings` single-chunk parity for short text, multiple for long text, fail-closed on partial chunk failure.
    - `packages/cli/src/__tests__/embedding.test.ts` — mirror for CLI copy.
    - `packages/server/src/__tests__/sqlite.test.ts` (filename TBD) — `upsertChunks` replaces prior chunks for the same `memory_id`, not appends.
    - Integration test: a `remember` call with a 15,000-char value produces N>1 chunk rows with distinct embeddings.
  - Depends on: Task 8 (schema must exist before writing to it).
  - Effort: L
  - Pre-mortem: If this takes 3x longer, it will be because the delete-then-insert chunk-replacement logic races with a concurrent `forget`/delete of the parent memory. Mitigate: wrap the replace in a single transaction/RPC, or check the parent memory still exists immediately before the insert half.
  - Notes: No file overlap with Task 8. Zero conflict with Phase 1 tasks (different files).

- [ ] **Task 10 — Chunk-aware recall RPC: chunk-level match + parent aggregation with winning-chunk identity (migration 0064) — UPGRADED this amendment**
  - Files:
    - Create `supabase/migrations/0064_chunk_aware_recall.sql` — new function `chunk_semantic_recall(p_project_id uuid, p_embedding vector(1536), p_type text default null, p_limit int default 5, p_threshold real default 0.3)` that matches against `memory_chunks.embedding`, and rolls up to the parent `memory_id` using **`DISTINCT ON (c.memory_id) ORDER BY c.memory_id, sim DESC`** (not a plain `GROUP BY ... max(sim)`) so the **winning chunk's `chunk_index` and `chunk_text` are returned alongside the parent memory's columns**, not just an aggregate similarity score. **This is now a hard requirement, not the original planning pass's optional pre-mortem suggestion** — directly evidence-backed this amendment by Supermemory's published "search small, return big" mechanic (search over small/distilled vectors, but preserve and return the specific matched unit's identity, not just a blended score). Joins back to `memories` for the remaining returned columns (same `RETURNS TABLE` shape as today's `semantic_recall` plus the two new chunk-identity columns — additive, not a breaking change to any existing caller since this is a new function name). Filters `m.status = 'live'`. `recall_memories` (trigram) is untouched.
  - Tests: No automated SQL harness. Manual smoke: insert a long (15K-char) memory via Task 9's write path, confirm `chunk_semantic_recall` returns it (with a specific, correct `chunk_index`/`chunk_text`, not just a row) for a short natural-language query where the existing pooled `semantic_recall` returns nothing.
  - E2E Validation:
    1. Apply to DEV only, confirm via `supabase migration list --linked`.
    2. Manual SQL smoke test above, explicitly checking the returned `chunk_text` corresponds to the actual passage containing the answer, not an arbitrary chunk from the same memory.
    3. Standard rerun procedure (requires Task 11 wired in first to actually be called by `tages recall` — this task's own E2E credit is the manual SQL smoke test in isolation; the harness delta is claimed jointly with Task 11, not double-counted here).
  - Depends on: Task 8 (schema) and Task 9 (chunk data must exist to query meaningfully).
  - Effort: L (base M for a focused, well-scoped new RPC with the `DISTINCT ON` winning-chunk pattern; ×1.5 database-migration multiplier).
  - Pre-mortem: If this takes 3x longer, it will be because `DISTINCT ON (c.memory_id)` combined with the existing `p_type`/`status` filters and a join back to `memories` produces a query planner surprise (e.g. the `ORDER BY` required for `DISTINCT ON` conflicting with the final result's intended `ORDER BY sim DESC` across *different* parent memories) — Postgres requires `DISTINCT ON`'s leading `ORDER BY` columns to match its distinct columns, so the final cross-memory ordering needs a wrapping outer `SELECT ... ORDER BY sim DESC` around the `DISTINCT ON` subquery/CTE, not a single flat query. Mitigate: structure this as a CTE (`DISTINCT ON` inside, final `ORDER BY`/`LIMIT` outside), not one query trying to do both.
  - Notes: This is the structural fix for the mean-pool dilution — the highest-expected-impact task in Phase 2, now with citation-quality (which specific passage matched) as a first-class output, not an afterthought. Zero file overlap with any TS file (SQL-only).

- [ ] **Task 11 — Wire chunk-aware recall into the CLI and MCP-server read paths**
  - Files:
    - Modify `packages/cli/src/commands/recall.ts` — in the hybrid-search branch, call `chunk_semantic_recall` (Task 10) **alongside** (not instead of) the existing `semantic_recall` call, feed it into Task 1's `reciprocalRankFusion` as a **fourth** ranked list (trigram, pooled-semantic, temporal-channel from Task 3, chunk-semantic), so a long-document memory that only the chunk-level match finds still gets fused in with proper rank weighting.
    - Modify `packages/server/src/tools/recall.ts` / `packages/server/src/sync/supabase-sync.ts` — add a `remoteChunkSemanticRecall` method (mirrors `remoteHybridRecall`'s shape) and fuse it into the MCP-server path the same way, after Task 6's rerank insertion point and Task 7's temporal-channel insertion point (same file, sequenced after both per Gate 5c).
  - Tests:
    - Modify `packages/cli/src/__tests__/recall.test.ts` — `chunk_semantic_recall` RPC called with the same candidate-pool limit as the other calls; a memory found only via the chunk RPC still appears in the final merged/reranked/deduped output, with its winning `chunk_text` available for citation.
    - Modify server-side recall test suite (exact filename TBD) — same assertion for `remoteChunkSemanticRecall`.
  - E2E Validation: Standard rerun procedure. Target metric (this plan's primary success criterion): `recalled_memory_count == 0` row count (baseline 11/50) must decrease toward the recalibrated ≤3/50 target from the Expectation Calibration section above; `recall_at_k` overall (baseline 78%) must increase toward the high-80s target. Read the raw rows for all 11 baseline zero-hit question ids (re-derive the exact list from the baseline JSON's `details[]` at execution time) post-rerun and confirm `recalled_memory_count > 0` for most of them, with the retrieved content coming from a `chunk_semantic_recall`-sourced row and the cited passage (per Task 10's winning-chunk return) actually containing the answer, not just any passage from the right memory.
  - Depends on: Task 10 (RPC must exist), Task 1 (RRF fusion function it extends), Task 4 (same file `recall.ts`, sequential — this task runs last in the CLI `recall.ts` file-ownership chain, after Task 1/2/3/4), Task 6 and Task 7 (same file `tools/recall.ts` server-side, sequential, this task runs after both).
  - Effort: M
  - Pre-mortem: If this task's E2E validation doesn't move `recalled_memory_count == 0` down, it will be because Task 9's write path didn't actually run for the pre-existing zero-hit memories (written by an earlier eval run, before Phase 2 shipped) — Task 12's backfill script is the fix for that, not this task.
  - Notes: This task's success is gated on Task 12 (or a fresh re-ingest) actually having chunk data for the baseline's specific zero-hit memories — flag this dependency clearly in the PR description.

- [ ] **Task 12 — Backfill script: populate `memory_chunks` for existing memories**
  - Files:
    - Create `packages/server/scripts/backfill-chunk-embeddings.ts` — mirrors `packages/server/scripts/backfill-embeddings.ts`'s structure (single named `--project` required, no default, `--dry-run`, `--batch-size`, same auth precedence). For each memory with `value` length over the chunking threshold and no existing `memory_chunks` rows, calls Task 9's `generateChunkEmbeddings` and writes via `remoteUpsertChunks`.
    - Create `packages/server/scripts/backfill-chunk-embeddings.test.ts` — mirrors `backfill-embeddings.test.ts`: dry-run makes no writes, a memory already having chunk rows is skipped (idempotent), never logs plaintext.
  - Tests: see above.
  - E2E Validation: Run against `longmemeval-sandbox-dev` specifically before Task 11's final rerun — this backfill run is part of Task 11's validation prerequisite, not a separately-measured harness delta.
  - Depends on: Task 8 (schema), Task 9 (`generateChunkEmbeddings`) — no file overlap with Task 10/11, codeable in parallel; must run (as data, not code) before Task 11's final E2E rerun.
  - Effort: M
  - Pre-mortem: If this takes 3x longer, it will be because LongMemEval re-ingests haystacks per-question via `tages remember`/`tages forget` cycles (`memory.ts`'s `ingest`/`clear`), so "existing memories" for the eval specifically may be a moving target across runs, not a stable one-time backfill population like a real product project. Mitigate: for the eval's own validation data, a fresh full re-ingest (delete + `tages remember` again post-Task-9) may be simpler and more reliable than backfilling; treat the script as the general-purpose product-correctness deliverable and use direct re-ingest for the eval's own validation.
  - Notes: Zero file overlap with Task 10/11.

## File Ownership Matrix

| Task | Creates | Modifies |
|------|---------|----------|
| 0 | — | (none — env/config only) |
| 1 | `packages/cli/src/lib/rrf.ts`, `packages/cli/src/__tests__/rrf.test.ts` | `packages/cli/src/commands/recall.ts`, `packages/cli/src/__tests__/recall.test.ts` |
| 2 | `packages/cli/src/lib/reranker.ts`, `packages/cli/src/__tests__/reranker.test.ts` | `packages/cli/src/commands/recall.ts` (same file as Task 1 — **sequential**), `packages/cli/src/__tests__/recall.test.ts` (sequential), `packages/cli/package.json` (new dependency) |
| 3 | `packages/cli/src/lib/temporal-recall.ts`, `packages/cli/src/__tests__/temporal-recall.test.ts` | `packages/cli/src/lib/temporal-sort.ts` (add `export`), `packages/cli/src/commands/recall.ts` (same file as Task 1/2 — **sequential**), `packages/cli/src/__tests__/recall.test.ts` (sequential) |
| 4 | `packages/cli/src/__tests__/recall-assembled-context.test.ts` | `packages/cli/src/commands/recall.ts` (same file as Task 1/2/3 — **sequential, runs last in the CLI wave before Phase 2's Task 11**), `packages/cli/src/index.ts` (new option registration), `packages/server/src/tools/recall.ts`, `packages/server/src/schemas.ts`, `packages/server/src/__tests__/recall.test.ts` (or equivalent) |
| 5 | `supabase/migrations/0062_hybrid_recall_rrf_fusion.sql` | — |
| 6 | `packages/server/src/search/reranker.ts`, `packages/server/src/__tests__/reranker.test.ts` | `packages/server/src/tools/recall.ts` (also touched by Task 4 and Task 7 — **sequential, see below**), `packages/server/package.json` (new dependency), `packages/server/src/__tests__/recall.test.ts` (or equivalent) |
| 7 | `packages/server/src/search/temporal-channel.ts`, `packages/server/src/__tests__/temporal-channel.test.ts` | `packages/server/src/tools/recall.ts` (same file as Task 4/6 — **sequential**), `packages/server/src/search/ranker.ts` (export/reuse `reorderProximity`) |
| 8 | `supabase/migrations/0063_memory_chunks_schema.sql` | — |
| 9 | — | `packages/server/src/embeddings.ts`, `packages/cli/src/lib/embedding.ts`, `packages/server/src/tools/remember.ts`, `packages/cli/src/commands/remember.ts`, `packages/server/src/cache/sqlite.ts`, `packages/server/src/sync/supabase-sync.ts`, `packages/server/src/__tests__/embeddings.test.ts`, `packages/cli/src/__tests__/embedding.test.ts`, `packages/server/src/__tests__/sqlite.test.ts` (filename TBD) |
| 10 | `supabase/migrations/0064_chunk_aware_recall.sql` | — |
| 11 | — | `packages/cli/src/commands/recall.ts` (same file as Task 1/2/3/4 — **sequential, runs last in the CLI chain**), `packages/cli/src/__tests__/recall.test.ts` (sequential), `packages/server/src/tools/recall.ts` (same file as Task 4/6/7 — **sequential, runs last in the server chain**), `packages/server/src/sync/supabase-sync.ts` (also touched by Task 9 — **sequential after Task 9**), `packages/server/src/__tests__/recall.test.ts` (or equivalent) |
| 12 | `packages/server/scripts/backfill-chunk-embeddings.ts`, `packages/server/scripts/backfill-chunk-embeddings.test.ts` | — |

**File conflicts identified and resolved:**
- `packages/cli/src/commands/recall.ts` — Task 1 → Task 2 → Task 3 → Task 4 → Task 11, strictly sequential (candidate pool + RRF, then rerank on top, then temporal channel added as a 3rd fusion list, then output-format branch, then chunk-channel added as a 4th fusion list). `packages/cli/src/__tests__/recall.test.ts` follows the same chain.
- `packages/server/src/tools/recall.ts` — Task 6 → Task 7 → Task 4 → Task 11, sequential (rerank insertion point, then temporal-channel insertion, then assembled-context output branch, then chunk-channel fusion last). Note this ordering differs slightly from the CLI chain's Task ordering (CLI: 1→2→3→4→11; server: 6→7→4→11) because Task 4 (assembled context) was written as one bundled task touching both files — its server-side edit is sequenced after Task 6/7 on the server file even though its CLI-side edit is sequenced right after Task 3 on the CLI file. This is intentional (each file's own edit history determines its sequencing, not a single global task-number order) but is exactly the kind of subtlety that must be called out explicitly to whoever splits this into parallel Howler waves — **do not assume Task 4 is a single atomic unit for scheduling purposes; its CLI and server halves have different position in their respective file chains.**
- `packages/server/src/sync/supabase-sync.ts` — Task 9 (`remoteUpsertChunks`, write path) and Task 11 (`remoteChunkSemanticRecall`, read path) both touch this file. Resolution: **sequential**, Task 9 before Task 11 (already true by data-dependency, restated here per Gate 5c for the file-level conflict too).
- `packages/cli/package.json` / `packages/server/package.json` — each touched by exactly one task (2 and 6 respectively) — no conflict, listed for completeness since they're a genuinely new kind of change (dependency addition) for this repo.

**Parallel-safe waves:**
- **Wave 0**: Task 0 (env setup, blocks validation only, not coding).
- **Wave 1** (fully parallel — zero file overlap, verified above): Task 1 (CLI RRF), Task 5 (SQL RRF), Task 8 (chunk schema).
- **Wave 2**: Task 2 (after Task 1), Task 9 (after Task 8) — independent of each other.
- **Wave 3**: Task 3 (after Task 2, CLI recall.ts chain continues), Task 6 (after Task 5, server tools/recall.ts chain begins), Task 10 (after Task 8+9, SQL-only) — independent of each other.
- **Wave 4**: Task 4's CLI half (after Task 3), Task 7 (after Task 6, server tools/recall.ts chain continues) — independent of each other.
- **Wave 5**: Task 4's server half (after Task 7 — see the file-conflict note above on why Task 4 spans two waves).
- **Wave 6**: Task 11 (after Task 10, Task 4-CLI, Task 4-server/Task 7 — the integration task, necessarily last on both files).
- **Wave 7**: Task 12 (after Task 8+9; codeable earlier in parallel with Task 10/11, but its *data* must exist before Task 11's final E2E rerun — a data dependency, not a code dependency, so Gold can schedule its coding in Wave 3 alongside Task 10 if preferred, and only its execution/rerun needs to happen before Task 11's validation).

## Phase 3 (not this plan) — the levers that separate 84% from 90%+

Per the Expectation Calibration section above, both research briefs converge on the same two levers as the actual gap between this plan's realistic ceiling (~84-85%, GPT-class reader) and the published 90%+ numbers. Neither is in scope here — both are genuine architecture changes, not retrieval tuning — but both compose cleanly with Phase 2's chunk child-table design, so they're noted as the natural next plan rather than left unmentioned:

- **Ingestion-time observation distillation (Mastra-style).** Mastra's OM architecture beats even gpt-4o *oracle* retrieval (84.2% vs. 82.4%, same reader) by extracting pre-digested, dated "observations" from raw text at write time via an LLM call, rather than storing and later retrieving raw text. Every published 90%+ system does some form of this. Why deferred: it's a write-path architecture change (new LLM call per `remember`, new storage shape, new extraction-quality failure modes) fundamentally different in kind from this plan's retrieval-side tasks — not a drop-in addition to Phase 1/2. Composability note: an "observation" is naturally another child-row type in the same `memory_chunks`-adjacent pattern this plan establishes (a row linking back to a source memory), so Phase 2's schema work is not wasted effort if this is picked up next.
- **Knowledge-update supersedence relations.** LongMemEval's `knowledge-update` stratum (baseline 87.5%, already Tages' strongest) rewards systems that explicitly track "this fact replaced that fact," not just recency-based decay (which Tages already has, per `packages/server/src/decay/scoring.ts`, referenced but not modified in this plan). Why deferred: it's a new relationship/edge concept between memories, not a retrieval-ranking change, and Tages' `knowledge-update` score is already the strongest stratum — lower marginal value than the retrieval-side work in this plan, and better sequenced after Phase 1/2 land so its own baseline is measured against the improved retrieval, not the current one.

## Open Questions
- [ ] **DEV anon key retrieval** — Blocks: Task 0 (and therefore the E2E Validation gate for every other task). Not present anywhere in this repo; Ryan must pull it from the Supabase dashboard for `ugogdqzhhnuzwgcaovty`. Default if unresolved: Task 0 cannot complete; every other task can still be *coded* but none can be marked E2E-validated-done until this is resolved.
- [ ] **Is the "Tages (Dev)" OAuth app / DEV project still fully live**, or has `docs/dev-env-teardown.md`'s teardown procedure been partially executed? — Blocks: Task 0's preferred (OAuth) path. Default if unresolved: attempt Task 0's Step 2 (`supabase migration list --linked`) first as a cheap DB-level liveness check.
- [ ] **Ratify the new `@huggingface/transformers` runtime dependency (NEW this amendment, REVISED framing)** — Blocks: nothing outright (Task 2/6 ship with the local cross-encoder as the evidence-backed default per this amendment), but this is explicitly flagged for Ryan's review before merge, not silently assumed, per the coordinator's instruction. The tradeoff: real cross-platform packaging risk (see Task 2's pre-mortem) and a first-time break from this repo's no-new-runtime-deps convention, versus the field's strongest-evidence rerank technique (SmartSearch, Hindsight both use a cross-encoder in this exact class). Default if unresolved: ship as written (local cross-encoder primary, OpenAI-judge fallback) — Ryan can veto at plan review and this plan falls back cleanly to "OpenAI-judge only" (the original, pre-amendment design) with no other task restructuring needed, since both implementations already sit behind the same `Reranker` interface.
- [ ] **Voyage/Cohere hosted rerank** — now explicitly a third, lowest-priority option (not "the upgrade path" as originally framed — the local cross-encoder is the evidence-backed primary, and a hosted API is a latency/cost/offline-capability downgrade from it, not an upgrade). Blocks: nothing. Default if unresolved: not pursued unless both the local cross-encoder and OpenAI-judge paths underperform in the Task 2 rerun.
- [ ] **RRF `k=60` and rerank-window-20 exact values** — Blocks: nothing (ships as written; each task's own E2E rerun is the calibration signal). Default if unresolved: keep as written unless a rerun shows a clear miscalibration.
- [ ] **Should Task 12's backfill run automatically against every existing project, or stay single-project like its `backfill-embeddings.ts` precedent?** — Blocks: nothing (ships single-project-scoped, matching precedent). Default if unresolved: manual per-project follow-up, not automated.
- [ ] **Temporal date-range channel's real coverage (NEW this amendment)** — how much of the `temporal-reasoning` stratum actually names a regex-resolvable date vs. needing semantic "last time X happened" understanding? Blocks: nothing (Task 3/7 ship as written; this is a calibration/expectation question, not a design blocker). Default if unresolved: read the raw baseline questions for this stratum during Task 3's E2E validation to get a real number, rather than guessing here.

## Definition of Done
- [ ] Code written and self-reviewed
- [ ] Tests written or updated for changed logic (see per-task Tests: entries)
- [ ] `pnpm --filter server test`, `pnpm --filter cli test`, `pnpm typecheck` pass across all packages
- [ ] **Every task's E2E Validation steps completed and the target metric's before/after numbers recorded** — not just "tests pass." A task with green unit tests but no recorded harness/SQL-smoke/product-probe delta is not done, per this plan's E2E Validation Gate.
- [ ] **Final result interpreted against the recalibrated targets in the Expectation Calibration section, not against published 90%+ numbers** — a low-to-mid-70s combined `overall_accuracy` is this plan succeeding, not falling short.
- [ ] Product-behavior smoke checklist (above) run once on the combined diff, including the new default-output-regression and rerank-latency-sanity items
- [ ] Migrations 0062, 0063, 0064 confirmed applied to DEV (`ugogdqzhhnuzwgcaovty`) only, never prod (`wezagdgpvwfywjoxztfs`) — `supabase migration list --linked` checked against both refs
- [ ] A final combined rerun (all merged Phase 1 + Phase 2 tasks together, standard procedure) recorded against the baseline table above: `overall_accuracy` delta, `recall_at_k` delta, per-type deltas, and the `recalled_memory_count == 0` count delta (baseline 11/50)
- [ ] **`@huggingface/transformers` dependency addition explicitly called out and ratified by Ryan** (or reverted to OpenAI-judge-only per the fallback path) before merge — not silently shipped
- [ ] Quality gate: White + Gray + high-effort `/code-review` on the combined diff
- [ ] PR opened with coverage gaps noted in description: Task 5/6/7's "no harness rerun credit, product-parity only" framing, Task 3/7's bounded temporal-date-resolution coverage, Task 12's single-project backfill scope, the new runtime-dependency tradeoff, and the Phase 3 deferrals (observation distillation, supersedence relations) all explicitly flagged as known, intentional scope boundaries — not silent gaps
- [ ] gh operations run as `ryantlee25-droid` (branch protection on `main` requires this); no auto-merge
