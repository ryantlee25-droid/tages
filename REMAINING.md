# Tages Execution — Remaining Work

_Companion to `PLAN.md`. Lists what is NOT yet done, what is blocked on whom, and the suggested next-up order. Updated 2026-04-20._

---

## Status snapshot

| Phase | Item | Bet | Status |
|---|---|---|---|
| P0.1 | Strip 9.1/10 README claim | — | ✅ Done |
| P0.2 | Update README counts | — | ✅ Done |
| P0.3 | npm publish workflow | — | 🟡 CI job added; needs `NPM_TOKEN` secret + `v*` tag push (Ryan) |
| P0.4 | Worktree + untracked cleanup | — | 🟡 Audit produced; awaiting Ryan's call on destructive ops |
| 1.1 | LongMemEval harness | C | ⬜ Not started |
| 1.2 | Stompy outreach issue | C | ⬜ Not started (Ryan's external action) |
| 1.3 | Governance page draft (no-index) | A | ✅ Done |
| 2.1 | @tages/cursor-plugin | D | ✅ Done |
| 2.2 | `tages agents-md write` / `audit` | B | ✅ Done (tests passing) |
| 2.3 | Governance page public | A | ⬜ Not started (depends on 1.3 review) |
| 2.4 | Stompy Tages-condition PR | C | ⬜ Blocked on 1.2 |
| 2.5 | Provenance model | A | ✅ Done |
| 3.1 | @tages/codex-plugin + @tages/gemini-plugin | D | ⬜ Not started |
| 3.2 | `tages agents-md diff` / `federate` | B | ⬜ Not started |
| 3.3 | `tages drift` | A | ⬜ Not started |
| 3.4 | Coding-memory benchmark open-source | C | ⬜ Blocked on 2.4 |
| 3.5 | Third-party SECURITY.md review | A | ⬜ Ryan procurement |
| 4.1 | Stacklok ToolHive compat guide | A | ⬜ Blocked on 3.3 |
| 4.2 | Governance SKU in Stripe + dashboard | A | ⬜ Blocked on 3.3 + 2.5 + 3.5 |
| 4.3 | Design-partner recruiting | A | ⬜ Ryan GTM |
| 4.4 | SOC 2 Type I gap analysis | A | ⬜ Ryan procurement |

Critical path remaining: **P0.4 cleanup → 3.1 plugins → 3.2 agents-md completion → 3.3 drift → 4.2 Governance SKU**.

---

## Needs your hand

These cannot proceed without Ryan.

### 1. P0.4 — Worktree + untracked cleanup

**Nine locked worktrees** in `.claude/worktrees/`. Removing is destructive (`git worktree remove --force`). Decide:
- Which branches (if any) still hold uncommitted work you want to salvage?
- Confirm to delete: `worktree-agent-a03255a9`, `feat/stripe-billing-complete`, `feat/draft-memory-phase-2-3`, `fix/full-audit-criticals`, `fix/team-rbac-audit`, `feat/marketing-and-legal`, `feat/draft-memory-phase-4-5`, `feat/draft-memory-phase-1`, `feat/observability-cleanup`.

**Untracked files to triage**:
- `supabase/migrations/0042_security_lint_fixes.sql` — intent unclear. Commit, discard, or renumber?
- `docs/superpowers/plans/*.md` (4 files) — internal plan drafts. Commit (for history) or discard (ephemeral)?
- `HOOK.md`, `docs/superpowers/HOOK.md`, `packages/server/src/search/HOOK.md` — session state per global CLAUDE.md. Gitignore.
- `.semgrep-results/` — CI artifact. Gitignore.

Suggested: add `.gitignore` entries for `HOOK.md` patterns + `.semgrep-results/`; ask me to either commit or remove `docs/superpowers/plans/*` once you decide.

### 2. P0.3 — Trigger the npm publish

```bash
# Once in repo settings: add NPM_TOKEN secret (npm access token with publish scope).
git tag v0.2.1
git push origin v0.2.1
```

The publish workflow builds + tests + publishes `@tages/shared` (0.1.1), `@tages/server` (0.1.1), `@tages/cli` (0.2.1). If you want a separate tag for the cursor-plugin version, add `packages/cursor-plugin` to the publish job first.

### 3. 1.2 — Stompy outreach

Open an issue on `github.com/banton/stompy-benchmark` asking:

> Would you accept a PR adding a Tages MCP condition to the Phase 2/3 harness? We'd mirror the existing `stompy-condition/` pattern with a `tages-condition/` directory (one `.mcp.json`, Tages-specific prompt overrides) and contribute results back upstream. Happy to also adapt the harness to any non-MCP provider you'd like if it unblocks multi-provider benchmarking.

Document the issue URL in `docs/benchmark-partnerships.md` (new file) when open.

### 4. 3.5 — Third-party SECURITY.md review

Engage a security auditor or trusted peer reviewer. Input: `SECURITY.md`, `/governance` page content (from 1.3), `docs/provenance-model.md` (from 2.5), audit log schema. Calendar: 1–2 weeks.

### 5. 4.3 — Design-partner recruiting

GTM task. Target: 3–5 teams (Claude Code + Cursor shops, 5–20 devs). Give Governance tier access once 4.2 ships. Run `tages drift` weekly with them.

### 6. 4.4 — SOC 2 Type I gap analysis

Engage a SOC 2 readiness assessor. Input: audit log schema (from 1.3), provenance model (from 2.5), SECURITY.md. Deliverable: gap report with remediation backlog. Calendar: 3–4 weeks.

---

## Autonomous work ready to pick up next

Order is rough; all unblocked and parallelizable unless marked.

### Next up (unblocked, small-to-medium)

1. **3.1 — @tages/codex-plugin + @tages/gemini-plugin** (S effort, ~1 hour each)
   - Same pattern as `@tages/cursor-plugin`. Codex writes TOML to `~/.codex/config.toml`; Gemini writes JSON to `~/.gemini/settings.json`.
   - Files: `packages/codex-plugin/*`, `packages/gemini-plugin/*`, update `docs/codex-setup.md`, `docs/gemini-setup.md`.
   - Verify: `node dist/index.js --dry-run` outputs valid TOML / JSON.

2. **3.2 — `tages agents-md diff` + `federate`** (M effort, ~half day)
   - `diff`: compare current memory state to committed AGENTS.md; highlight stale / missing / contradicting sections. Exits 1 on drift.
   - `federate`: write `.tages/agents-md-owners.json` mapping sections to teams. On `write`, filter memories by team ownership per section.
   - Extends the existing `packages/cli/src/commands/agents-md.ts`. New tests added to existing test file.

3. **1.1 — LongMemEval harness scaffold** (M effort; a real run needs dataset access + API budget)
   - Scaffold only at first: `eval/longmemeval/README.md`, `run.ts`, `notebook.ipynb` shell. Pull the LongMemEval oracle split via HuggingFace dataset API (no academic license required for oracle).
   - Judge: GPT-4o at temp=0 per LongMemEval paper defaults.
   - First run goal: ≥80% overall. If under 70% on a 50-question calibration subset, surface immediately (flip signal).
   - Cost estimate: a full 500-question run is roughly $15–$30 in OpenAI API spend (Haiku extractor optional); will ask before hitting OpenAI.

### Next up (unblocked, medium-large)

4. **3.3 — `tages drift` command** (L effort, ~2 days)
   - New CLI command backed by an ASI-inspired metric set in `packages/server/src/drift/`.
   - Inputs: project slug, time window, agent filter. Outputs: `drift_score` (0–1) plus human-readable breakdown by memory key.
   - Three sub-metrics: semantic drift (conflicting values for the same key across sessions), coordination drift (missing federation propagation), behavioral drift (action sequences diverging across agents).
   - Depends on provenance fields shipped in 2.5.
   - Gate on: label as "pilot / experimental" for first release.

5. **2.3 — Governance page public** (S effort after your review)
   - Remove `noindex, nofollow` metadata.
   - Add nav link from homepage.
   - Depends on: your review of the draft from 1.3.

### Blocked (sequencing)

6. **2.4 — Stompy Tages-condition PR** (M effort) — blocked on 1.2 response. If banton unresponsive after 14 days, fork at `tages/stompy-benchmark`.

7. **3.4 — Coding-memory benchmark open-source** (L effort) — blocked on 2.4 shape.

8. **4.1 — Stacklok ToolHive compat guide** (M effort) — blocked on 3.3 shipping (need `tages drift` OTel output to document the ToolHive integration).

9. **4.2 — Memory Governance SKU live in Stripe + dashboard** (L effort) — blocked on 3.3 (drift feature to gate), 2.5 (provenance, shipped), 3.5 (security review).

---

## Suggested immediate cadence

If you keep me running autonomously with one check-in per bet:

| Sprint | Duration | Deliverables |
|---|---|---|
| **Sprint A** | This session / tomorrow | Your P0.4 decisions → I ship 3.1 (Codex + Gemini plugins) and 3.2 (agents-md diff + federate). Check-in: full Bet D + Bet B complete. |
| **Sprint B** | 1–2 days | I scaffold 1.1 (LongMemEval harness). You decide on API budget. I run a 50-question calibration; we decide whether to proceed to full run. |
| **Sprint C** | 2–3 days | I ship 3.3 (`tages drift`). You trigger npm publish (v0.2.x → v0.3.0 range). You open Stompy issue (1.2). You commission SECURITY.md review (3.5). |
| **Sprint D** | 1 week | I ship 2.3 (Governance page public after your review), 4.1 (Stacklok guide), 4.2 (Governance SKU in Stripe). You recruit first 1–2 design partners. |
| **Sprint E** | 2–3 weeks | I ship 3.4 (coding-memory benchmark open-source). You shepherd 2.4 PR, 4.3 design partners, 4.4 SOC 2 gap. |

---

## Flip-signal check-in

Reverify monthly (or sooner on any signal) — from `positioning.md` §10 and `trend-scan-coding-memory-2026.md`:

1. **Anthropic ships cross-machine shared CLAUDE.md with per-user attribution.** Today: not shipped (managed CLAUDE.md is push-only). Monitor: Claude Code changelog.
2. **Mem0 ships a Team SKU with federation.** Today: SOC 2 Type I + HIPAA "audit-ready logs," but no team memory graph surfaced. Monitor: mem0.ai/enterprise + blog.
3. **Tages LongMemEval run lands under 70%.** Will verify in Sprint B calibration.
4. **A competitor ships `agents-md write` before we publish 2.2 publicly.** Today: zero tooling in the AGENTS.md space. Monitor: agentsmd/agents.md issues + HN.

If any flip fires, reopen `positioning.md` and re-run the differentiation call before continuing execution.

---

## Source pointers

- Strategic frame: `analysis/positioning.md`
- Trend signals (12–18 mo): `analysis/trend-scan-coding-memory-2026.md`
- Execution-level research: `analysis/deep-research-execution-2026-04.md`
- Full phase plan: `PLAN.md`
- This doc: what is left and in what order.
