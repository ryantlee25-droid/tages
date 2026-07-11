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
