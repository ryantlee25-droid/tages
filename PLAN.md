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
