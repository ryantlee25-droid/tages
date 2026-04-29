# Tages Positioning (2026-04-19)

**Sources:** `competitive-analysis.md`, `trend-scan-coding-memory-2026.md`, and a fresh git/code audit of the repo on 2026-04-19.
**Decision:** What 3–4 differentiation bets does Tages double-down on for 12–18 months?
**Flip signal:** Research surfaces no defensible differentiator. Did not flip. Bets below are live.

---

## 1. Category & one-liner

- **Category:** **Team Coding Memory** (memory-as-governance for developer teams running one or more AI coding agents)
- **One-liner:** _Tages is the MCP-native memory service that gives developer teams one shared, audited memory graph across every AI coding agent they use._
- **Alt one-liner (team-leader angle):** _Your team uses Claude Code, Cursor, and Codex. Tages makes sure they all learn the same things — with audit logs._

## 2. Target buyer

Primary: **Team lead or engineering manager** at a 5–50 dev shop where developers mix 2+ AI coding agents (typical: Claude Code + Cursor + some Codex/Gemini). They feel the pain of "Ricardo's Claude learned X, Priya's Cursor never did; we have no audit of what the agents collectively know."

Secondary: **Head of developer platform or AI enablement** at a 50–500 dev org. Same pain, plus compliance (provenance, audit), plus governance concerns post-MCP-security-wave.

Not the buyer: individual dev using Claude Code solo. That is Mem0 OpenMemory / Supermemory / Claude Code auto-memory territory. Concede it.

## 3. The four bets

### Bet A — Memory governance is the product, not memory storage

**What:** Position the shipped RBAC + federation + audit + encryption surface as an enterprise-buyable "Memory Governance" SKU. Document: provenance model (who wrote each memory, from which agent session, when), cross-agent drift detection (three devs on the same repo running different agents, report memory-state deltas), compliance-grade audit log export.

**Why it wins:** Claude Code's managed CLAUDE.md is one-way push (IT → user) with no RBAC at content granularity, no provenance, no audit. Mem0 OpenMemory and Supermemory are per-user, per-machine. Nobody ships the whole governance surface.

**Evidence it will sell:** Interloom raised $16.5M March 2026 on the "corporate memory problem." Stacklok raised $36M for MCP governance. The $692M March 2026 MCP-security funding round validates the buyer energy.

**What to ship:** `tages governance` CLI surface: `provenance`, `drift`, `audit export`. "Memory Governance for Coding Teams" positioning page. Third-party SECURITY.md review.

### Bet B — AGENTS.md-native author and auditor

**What:** Become the best tool for writing, auditing, and federating AGENTS.md files. Ship `tages agents-md write`, `tages agents-md audit`, `tages agents-md diff`. Tages memory becomes the source of truth; AGENTS.md becomes a generated artifact.

**Why it wins:** 60k+ repos now use AGENTS.md; Linux Foundation stewards it; adopted by Cursor, Copilot, Codex, Factory. Fighting AGENTS.md is fighting the category. Authoring and governing AGENTS.md is the natural extension of existing `remember` + `audit` + `sharpen` primitives.

**Evidence:** AGENTS.md correlates with 35–55% fewer agent-generated bugs. AAIF founding project. No competitor leads with "we write and govern your AGENTS.md."

**What to ship:** AGENTS.md as a first-class output from Tages memory. Detect drift between memory and AGENTS.md. Federated section ownership (security team owns `## Security`, platform team owns `## Build & Test`).

### Bet C — Reproducible coding-memory benchmark

**What:** Publish a real LongMemEval run with methodology and notebook. Ship a second, Tages-authored, coding-memory-specific benchmark (typed-memory recall over a real repo fixture). Open-source the harness.

**Why it wins:** The "9.1/10 vs 2.8/10" README claim is a credibility liability. Vectorize's March 2026 manifesto nailed it: "the only credible benchmark is one you can reproduce yourself." Supermemory, RetainDB, Mastra have LongMemEval scores but none have a coding-memory-specific public benchmark.

**Evidence:** LongMemEval is the category entry ticket. Tages is positioned on opinionated coding types but has no public coding-specific benchmark. Cheapest credibility upgrade in the plan.

**What to ship:** `/eval/longmemeval/` harness producing reproducible results. `/eval/coding-memory/` harness: given a real repo fixture with historical decisions, measure recall precision on typed queries like "what is the convention for API error responses" or "which anti-pattern was flagged in PR 312."

### Bet D — Cross-tool distribution parity

**What:** Close the plugin gap. Claude Code plugin exists; Cursor, Codex, Gemini do not. Ship them.

**Why it wins:** Tages's single most concrete advantage over Claude Code is "works in every agent." That advantage is hollow if only the Claude Code plugin ships. Supermemory already ships 4 plugins; Mem0 OpenMemory covers Cursor, Windsurf, VS Code, Claude. Tages is visibly behind on distribution.

**Evidence:** Cursor's `.cursor/rules/` + Memories and Codex's AGENTS.md are the entry points. Gemini CLI supports MCP. All three are straightforward plugin ports.

**What to ship:** `@tages/cursor-plugin`, `@tages/codex-plugin`, `@tages/gemini-plugin`, each invoking the same MCP server. One-line install per tool.

## 4. What Tages explicitly concedes

- **Personal / single-user memory for a solo developer.** That is Mem0 OpenMemory and Claude Code auto-memory territory. Tages should not market there.
- **Temporal knowledge graphs with validity windows.** Zep/Graphiti owns that architecture. Tages stays pragmatic (trigram + pgvector + decay).
- **Multi-modal memory (images, audio, video).** Supermemory leads there; coding teams do not pay for it as a priority.
- **General-agent memory (CRM, sales, support).** Category will be won by Mem0, Zep, Letta, Interloom, Reload. Tages is coding-specific, period.

## 5. Comparison matrix (buyer-facing)

| Capability | Claude Code | Cursor | Mem0 OpenMemory | Supermemory | **Tages** |
|---|---|---|---|---|---|
| MCP-native | Yes | Yes | Yes | Yes | **Yes** |
| Works across Claude Code + Cursor + Codex + Gemini | No (Claude-only) | No (Cursor-only) | Partial (Cursor/Windsurf/VS Code/Claude) | Partial (Claude Code + OpenCode) | **Target Q3 2026** |
| Team-shared memory graph | No (managed CLAUDE.md is instructions, not learnings) | No (team rules only) | No (per-user) | No (unlimited users ≠ shared graph) | **Yes (shipped)** |
| Audit log of memory writes | No | No | Partial (access logs) | No | **Yes (shipped)** |
| Provenance (agent + session + user for every memory) | No | No | No | No | **Yes (shipped)** |
| RBAC at content level (Owner / Admin / Member) | No (managed = all-or-nothing) | No | No | No | **Yes (shipped)** |
| Federation across projects | No | No | No | No | **Yes (shipped)** |
| Opinionated coding memory types | No (plain markdown) | No (plain markdown) | Generic with tags | Generic | **Yes (11 types)** |
| Encryption at rest | Optional (OS) | Cloud-managed | Cloud-managed | Cloud-managed | **Yes (AES-256-GCM opt-in)** |
| Published reproducible benchmark | No | No | No | Yes (LongMemEval 85.4%) | **Target Q2 2026** |
| AGENTS.md native author | No (imports via `@AGENTS.md`) | Partial | No | No | **Target Q2 2026** |
| MCP-gateway compat (Stacklok etc.) | N/A | N/A | Untested | Untested | **Target Q3 2026** |

Key takeaway: Tages is the only row with "Yes (shipped)" across team graph + audit + provenance + RBAC + federation + typed memory. Everything else is single-user or single-tool.

## 6. Messaging ladder

**Tagline (one line):** _Shared memory for coding agents. Audited. Governed. Portable across every agent your team uses._

**For the solo developer:** Use Claude Code auto-memory or Mem0 OpenMemory. Tages is not for you.

**For the team lead (5–20 devs):** Your team's agents are each learning different things. Tages gives them one memory graph with an audit trail, so what Ricardo's Claude learns today, Priya's Cursor knows tomorrow, and you can see who wrote what.

**For the director / VP of engineering (50–500 devs):** Tages is memory governance for coding teams. RBAC, provenance, audit export, federation across projects. Works in every MCP-speaking agent. Enterprise security story documented. Ready for a procurement review.

**For the OSS developer / DevRel audience:** Tages is the MCP server that writes and audits your team's AGENTS.md. 56 MCP tools, 618 tests, MIT-licensed.

## 7. Objection handling

**"Isn't this just CLAUDE.md?"**
No. CLAUDE.md is one file, one machine, one tool, no audit, no RBAC. Tages is one graph, every machine, every MCP agent, with provenance and audit logs. (Show: four-layer Claude Code memory diagram next to Tages's RBAC + federation + audit diagram.)

**"Won't Anthropic ship this?"**
Fetched the Claude Code docs on 2026-04-19. Managed policy CLAUDE.md is IT-push instructions, not team-shared learnings. Auto-memory is explicitly machine-local, no cloud sync. Anthropic has not shipped a collaborative memory service and has no signal they intend to. Watch signal: any announcement of a cross-machine, per-user-attributed CLAUDE.md.

**"Isn't this Mem0?"**
Mem0 OpenMemory is explicitly per-user coding memory across Cursor/Windsurf/VS Code/Claude. It does not ship RBAC, team graphs, provenance, or federation. Mem0's Enterprise tier has SSO but no shared memory graph across developers. Different product.

**"Isn't this Supermemory?"**
Supermemory has "unlimited users" on every plan but that is seats, not a shared graph. Their positioning is "Universal Memory API" (builder-facing); Tages is "Team Coding Memory" (developer-team-facing). Adjacent, not overlapping. Also: Tages is coding-agent-native, Supermemory is multi-modal general.

**"Why should I trust a pre-launch product for team memory?"**
Tages is shipped and live today: 56 MCP tools, 53 CLI commands, 618 tests, 57 migrations, live Stripe, encryption at rest, RBAC, audit logs, team invite flow merged 2026-04-19. MIT licensed. Self-hostable. You can run it in your own infra if you want.

**"What about the benchmark?"**
Tages is publishing a reproducible LongMemEval run and a coding-memory-specific benchmark in Q2 2026. The older "9.1/10 vs 2.8/10" README claim is being replaced with reproducible methodology.

## 8. Enemies to name explicitly

- **Claude Code's managed CLAUDE.md** as the "team memory" shortcut. The shortcut is real but incomplete (push, no graph, no audit). Name it and show the gap.
- **Mem0 OpenMemory** for single-user coding memory. Do not attack; concede the category and contrast.
- **"Memory platform" generalists** (Letta, Zep-as-general-agent-memory). Position Tages as coding-specific; do not fight on general agent memory.

## 9. Immediate pre-launch hygiene (before any of this lands publicly)

From the 2026-04-19 git audit:

1. Strip or replace "9.1/10 vs 2.8/10" benchmark claim in README. (Bet C depends on this.)
2. Update README counts: 56 tools, 53 CLI commands (not 52), 618 server tests (not 521).
3. Tag and publish current package versions (v0.2.1 CLI / v0.1.1 server / v0.1.1 shared) to npm. Release tag drift is a credibility red flag.
4. Resolve 12 untracked files + worktree cleanup in `.claude/worktrees/` before any public demo.
5. Add an npm publish step to CI.

None of these are positioning work, but all of them undermine positioning until fixed.

## 10. Sequencing summary (from trend brief's decision ladder)

- **2 weeks (2026-05-01):** Hygiene done. LongMemEval harness published.
- **30–45 days (2026-06-01):** Cursor plugin. AGENTS.md write/audit/diff. Memory Governance positioning page.
- **60–75 days (2026-07-01):** Codex + Gemini plugins. Coding-memory benchmark open-sourced. Third-party SECURITY.md review.
- **~105 days (2026-09-01):** Stacklok/MCP-gateway compat. Enterprise SKU lineup. First 3–5 design-partner teams on federation with measurable drift detection.

## 11. One-page summary

**Who we are:** The MCP-native memory service that gives developer teams one shared, audited memory graph across every AI coding agent they use.

**Why now:** Coding-agent memory has bifurcated from general agent memory. Personal memory is saturated (Mem0, Supermemory, Claude Code auto-memory). Team memory governance is wide open. MCP just became permanent infrastructure under Linux Foundation. AGENTS.md is the cross-tool standard. MCP security is the $692M adjacent category. Enterprise buyers are procuring.

**What we concede:** Single-user coding memory. Temporal KGs. Multi-modal. General agent memory.

**What we lead with:** Memory governance (audit + provenance + RBAC + federation). AGENTS.md authoring and auditing. Reproducible coding-memory benchmarks. Cross-tool plugin distribution.

**What would flip:** Anthropic ships a cross-machine, per-user-attributed CLAUDE.md service. Mem0 ships a Team SKU with federation. Tages LongMemEval run under 70%.
