# Trend Scan: AI Coding Agent Memory & MCP Ecosystem (12–18 month horizon)

**Date:** 2026-04-19
**Decision this informs:** What 3–4 differentiation bets should Tages double-down on for the next 12–18 months, given what has already shipped?
**Decision owner:** Ryan Lee (CEO)
**By when:** Pre-launch positioning call, now
**Scope type:** Market-level, AI coding agent memory / MCP ecosystem, global
**What would flip the call:** If the research surfaced no defensible differentiator against Claude Code + Mem0 OpenMemory + Supermemory at current capability, the recommendation would shift from "double down" to "pivot positioning." (Research did not flip the call; see Findings below.)

---

## Findings & Direction

### The Call

**Double down on three bets and concede one.** Over the next 12–18 months, Tages should lead as: (1) the **team-governance memory layer for coding agents** (audit + provenance + RBAC + federation across 2+ agents per team), (2) the **AGENTS.md-native author and auditor** (not a competitor to the standard, a writer and governor of it), and (3) the **reproducible coding-memory benchmark** publisher. **Concede** pure single-user memory-store ground to Mem0 OpenMemory and Supermemory, who have already captured mindshare for "memory for my coding agent."

### Why (trends driving the call)

- **Trend 2 (Claude Code managed CLAUDE.md ≠ team memory service):** Anthropic's org-policy file is push-only, machine-local, no audit, no RBAC at content level. The team-memory-with-governance wedge survives.
- **Trend 3 (AGENTS.md is the cross-tool default):** 60k+ repos, Linux Foundation stewardship, adopted by Cursor/Copilot/Codex/Factory. Fighting AGENTS.md is fighting the category. Authoring and governing AGENTS.md is not.
- **Trend 4 (coding-agent memory category has already bifurcated):** Mem0 OpenMemory explicitly targets Cursor/Windsurf/VS Code/Claude for single-user coding memory. The "memory for my agent" wedge is closing; "memory governance for my team" is not.
- **Trend 5 ($692M MCP security round in a single month):** Enterprise buyers are actively procuring around MCP governance. Tages's existing RBAC/encryption/audit surface is now a live buying story, not just a feature list.
- **Trend 6 (LongMemEval is the entry ticket):** The "9.1/10 vs 2.8/10" README claim is a credibility liability until reproduced. Publishing a real LongMemEval run and a coding-memory-specific benchmark is the cheapest credibility upgrade available.

### Sequence

- **By 2026-05-01 (14 days):** Strip the "9.1/10 vs 2.8/10" claim from the README. Update counts to 56 tools / 53 commands / 618 tests. Publish a LongMemEval harness at `/eval/longmemeval/` with a Tages reproducible run.
- **By 2026-06-01 (30–45 days):** Ship Cursor plugin (`@tages/cursor-plugin`). Make AGENTS.md a first-class Tages output: `tages agents-md write`, `tages agents-md audit`, `tages agents-md diff`. Publish a "Memory Governance for Coding Teams" positioning page.
- **By 2026-07-01 (60–75 days):** Codex + Gemini plugins. Coding-memory benchmark harness (typed-memory recall over real repo fixtures) open-sourced. `tages brief` becomes the "run this in CI" command with documented OTel output. Third-party SECURITY.md review commissioned.
- **By 2026-09-01 (105 days):** Stacklok / MCP-gateway compat tested and documented. Tages Enterprise SKU positioned around audit + provenance + federation + AGENTS.md governance. First 3–5 design-partner teams running federated memory with measurable drift-detection metrics.

### What Would Flip the Call

Three signals would force a pivot away from this sequence and toward a narrower "opinionated AGENTS.md authoring + coding skills" positioning:

1. **Anthropic ships a shared managed CLAUDE.md that syncs across machines with per-user attribution and audit logs** (effectively a team-memory service). **Today:** not shipped (fetched 2026-04-19 docs; machine-local confirmed). **Watch:** Claude Code changelog monthly.
2. **Mem0 OpenMemory ships a Team SKU** with RBAC, audit trails, and federation across developers. **Today:** OpenMemory is per-user; no team graph surfaced. **Watch:** mem0.ai/enterprise and blog.
3. **LongMemEval run on Tages lands under 70% overall accuracy**, putting Tages visibly below Supermemory (85.4%) and RetainDB (79%). Forces either engineering investment or a narrower capability-only positioning.

---

## Trends

### 1. MCP becomes permanent, vendor-neutral infrastructure (Near-term, Regulatory + Technology shift)

- Anthropic donated MCP to the Linux Foundation on 2025-12-09, founding the **Agentic AI Foundation (AAIF)** with Block and OpenAI as co-founders. Platinum members: AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI. [CONFIRMED 2025-12][aaif-launch]
- 97M monthly SDK downloads, 10,000 active servers, first-class support across ChatGPT, Claude, Cursor, Gemini, Microsoft Copilot. [CONFIRMED 2026-03][github-mcp-lf]
- Other AAIF founding projects: goose (Block), AGENTS.md (OpenAI). [CONFIRMED 2025-12][aaif-launch]
- **Implication for Tages:** Continue betting on MCP-first. The protocol is now vendor-neutral infrastructure; the "MCP will fragment" risk is gone. Update SECURITY.md to explicitly reference the AAIF governance posture.

### 2. Claude Code "team memory" ships as managed-policy push, not a collaborative service (Near-term, Competitive dynamic)

- Claude Code supports 4 CLAUDE.md scopes (managed / project / user / local) plus per-repo auto-memory at `~/.claude/projects/<repo>/memory/`. Fetched directly from the docs 2026-04-19. [CONFIRMED 2026-04][cc-memory-docs]
- **Managed policy CLAUDE.md** lives at OS-level paths (`/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS, `/etc/claude-code/CLAUDE.md` on Linux, `C:\Program Files\ClaudeCode\CLAUDE.md` on Windows), deployed via MDM / Group Policy / Ansible. Cannot be excluded by users. [CONFIRMED 2026-04][cc-memory-docs]
- But: managed CLAUDE.md is **instructions, not learnings**. No audit logs, no per-user attribution, no RBAC at content granularity, **no cross-machine sync of anything**. Auto-memory is explicitly machine-local. [CONFIRMED 2026-04][cc-memory-docs]
- Claude Code reads CLAUDE.md, not AGENTS.md. Bridging requires a manual `@AGENTS.md` import. [CONFIRMED 2026-04][cc-memory-docs]
- **Implication for Tages:** The "team memory as a governed service" wedge is still open. Message: "Claude Code writes one file per machine. Tages gives your team one memory graph with audit, provenance, and RBAC, across every MCP-speaking agent." Build, don't rebuild, the messaging campaign.

### 3. AGENTS.md becomes the cross-tool default (Near-term, Technology shift)

- 60,000+ repos contain AGENTS.md as of April 2026; "detailed AGENTS.md" correlates with 35–55% fewer agent-generated bugs on community leaderboards. [CONFIRMED 2026-04][github-agents-md] [DOMAIN REVIEW NEEDED — leaderboard methodology]
- Adopted by Codex, GitHub Copilot, Cursor (primary), Factory, Ona, Kilo, Augment Code. Claude Code bridges via CLAUDE.md import. [CONFIRMED 2026-04][codex-agents-md][augment-agents-md]
- Stewarded by Linux Foundation as an AAIF founding project. [CONFIRMED 2025-12][aaif-launch]
- **Implication for Tages:** Do not try to replace AGENTS.md. Become its best author and governor. Ship `tages agents-md write`, `tages agents-md audit`, `tages agents-md diff` so teams generate AGENTS.md from structured memory, detect drift, and federate section updates. This is the natural extension of existing `remember`, `audit`, and `sharpen` primitives.

### 4. Coding-agent memory has bifurcated from general agent memory (Medium-term, Competitive dynamic)

- **Mem0 OpenMemory** explicitly positioned: "adds persistent, project-aware memory to Cursor, Windsurf, and VS Code agents," "every MCP-compatible coding agent." Auto-captures coding preferences, patterns, implementation details. Memory tagged by type. [CONFIRMED 2026-04][openmemory]
- **Supermemory** shipped dedicated Claude Code and OpenCode plugins; positioning: "agents can run for months without starting over." Memory expiration as first-class. [CONFIRMED 2026-04][supermemory-blog]
- **Cognee** has a Claude Code plugin with hooks; 70+ enterprise customers including Bayer, University of Wyoming, dltHub; >1M pipelines/month. [CONFIRMED 2026-04][cognee]
- Mem0 $24M Series A (Oct 2025), 186M API calls Q3 2025, AWS exclusive memory provider for Agent SDK. [CONFIRMED 2025-10][mem0-series-a]
- **Implication for Tages:** The "personal memory for my coding agent" wedge is saturating. Concede it. Lead with what these don't offer: **team governance, cross-agent consistency, federated memory, provenance, audit**. Single-user memory is not the fight Tages wins in 2026.

### 5. MCP security becomes the year's most-funded adjacent category (Medium-term, Investment pattern + Regulatory)

- March 2026 alone: **$692M raised in MCP-adjacent AI security**. Snyk $300M, Chainguard $356M (explicit AI-agent-workload focus), Stacklok $36M (MCP governance). [CONFIRMED 2026-03][crunchbase-q1-2026]
- Stacklok ToolHive / vMCP ships tool pre-filtering (agents never see blocked tools), on-demand tool discovery (60–85% token cut), OpenTelemetry observability everywhere. [CONFIRMED 2026-04][stacklok-docs]
- Enterprise reality: "agents receive every tool in every connected server" without a gateway. 8,000+ exposed MCP servers on the public internet. [CONFIRMED 2025–2026][mcp-security] [DOMAIN REVIEW NEEDED]
- **Implication for Tages:** Tages's existing RBAC/RLS/encryption-at-rest/secret-detection/audit-log surface is now a live enterprise buying story, not a checkbox list. But: it is also rapidly becoming table stakes. Ship a public third-party-reviewable SECURITY.md, emit OpenTelemetry on every tool call, and publish compat with at least one MCP gateway (Stacklok ToolHive first). Without this, Tages looks behind.

### 6. Reproducible LongMemEval becomes the entry ticket for memory credibility (Medium-term, Behavioral shift)

- LongMemEval (ICLR 2025) is the emergent benchmark: 500 questions across 5 memory abilities, LLM-as-judge with shared prompts, explicit reproducibility contract. [CONFIRMED 2025][longmemeval-iclr]
- 2026 scores on public pages: **RetainDB 88% preference recall / 79% overall** (Mar 2026, full methodology published); **Supermemory 85.4% overall**; **Observational Memory (Mastra) 84.23% gpt-4o**. [CONFIRMED 2026][retaindb][supermemory-research][mastra-obs-memory]
- Vectorize "Agent Memory Benchmark Manifesto" (Mar 2026): "the only credible benchmark is one you can reproduce yourself." [CONFIRMED 2026-03][vectorize-manifesto]
- Tages's "9.1/10 vs 2.8/10" README claim is not LongMemEval, has no methodology, no dataset, no reproduction path. [USER-SUPPLIED — Tages README:97]
- **Implication for Tages:** This is the single cheapest credibility upgrade in the scan. Strip the existing claim. Run LongMemEval. Publish the notebook. Ship a second, coding-memory-specific benchmark (typed recall over a real repo fixture) and open-source the harness. Neither Mem0 nor Supermemory has a coding-memory-specific benchmark; the whitespace is real.

### 7. Memory governance as an enterprise-buyable surface (Medium-term, Behavioral shift + Competitive dynamic)

- **Interloom** raised $16.5M March 2026 on the "corporate memory problem"; claim: narrowed documentation-to-operational-knowledge gap from ~50% to 5%. [CONFIRMED 2026-03][fortune-interloom]
- **Reload** $2.275M Feb 2026 for shared AI-employee memory. [CONFIRMED 2026-02][techcrunch-reload]
- "Collaborative Memory" arXiv paper May 2025 frames the multi-user memory problem academically. [CONFIRMED 2025-05][collab-memory]
- Cognee enterprise customers validate the buying behavior. SiliconANGLE framed Feb 2026 as "the memory supercycle." [CONFIRMED 2026-02][siliconangle]
- **Implication for Tages:** The buying signal is real. Package the shipped federation + audit + RBAC + encryption surface as "Memory Governance." Three deliverables: a documented provenance model (who wrote each memory, from which agent session, when), a cross-agent drift-detection audit (given 3 devs on the same repo running Claude Code + Cursor + Codex, report the memory-state deltas), and an exportable audit log suitable for compliance review.

### 8. Temporal knowledge graphs: the architecture you do not have to build (Long-term, Technology shift)

- Graphiti is actively maintained, 25.1k stars, drivers for Neo4j / FalkorDB / Kuzu / Neptune. Context graphs with validity windows are moving from research to product. [CONFIRMED 2026-04][graphiti-gh]
- Zep's positioning shifted from "memory" to "context engineering" and "context graphs at scale." [CONFIRMED 2026-04][zep-home]
- Zep benchmarked DMR 94.8% vs MemGPT 93.4% in 2025. [CONFIRMED 2025-01][zep-paper-ref]
- Graphiti requires Neo4j (or Kuzu/FalkorDB/Neptune); infra-heavy for a dev team. [CONFIRMED 2026-04][graphiti-gh]
- **Implication for Tages:** Do not try to replicate Graphiti in-engine. Tages's trigram + pgvector + decay hybrid is a pragmatic "good enough for teams" architecture. Watch: if temporal KG becomes table stakes (signal: a coding-agent-specific temporal schema released by Zep, or Claude Code adding validity windows to auto-memory), consider a pluggable Graphiti backend behind a feature flag rather than a rewrite.

---

## Overhyped or Premature

### 1. Multi-modal memory (images, audio, video) as a coding-agent requirement

- **What is claimed:** Supermemory advertises PDF, images, audio, video extraction free on every plan. Several vendor blogs position multi-modal memory as a 2026 requirement. [CONFIRMED 2026-04][supermemory-apis]
- **Why overhyped for coding agents specifically:** Coding agents primarily consume code, commits, tickets, and text. Architectural diagrams exist but are rarely the memory path of least resistance; developers usually re-encode them as text or ADRs. The buying signal in coding is for richer typed text memory, not richer modalities.
- **What would change the call:** A real customer requirement emerges where a coding team pays for "our agent must read diagrams," specifically to route design decisions from Figma or Mermaid. Until then, concede this axis.

### 2. Temporal knowledge graphs as a near-term coding-team requirement

- **What is claimed:** Graphiti and Zep position "fact validity windows" as the correct memory architecture. Several market surveys list temporal KGs as a 2026 must-have. [CONFIRMED 2026-04][graphiti-gh]
- **Why overhyped on the coding-team horizon:** Most coding memories (conventions, decisions, anti-patterns) are either durable or updated by a human committing a decision, not by time-stamped invalidation flows. Temporal KG helps in CRM/sales-ops contexts more than in dev-team contexts. The infra cost (Neo4j cluster or equivalent) exceeds the marginal value for a 5–20 dev team.
- **What would change the call:** A published coding-memory benchmark shows a ≥10 point accuracy gap between temporal-KG architectures and trigram+vector+decay on repo-fixture tasks.

### 3. "Memory supercycle" applied to coding specifically

- **What is claimed:** SiliconANGLE Feb 2026: AI memory is "the next funding wave." [CONFIRMED 2026-02][siliconangle]
- **Why partly overhyped:** Most of the $66M of visible funding (Mem0 $24M, Interloom $16.5M, Letta $10M, Greptile $30M cum, Supermemory $2.6M, Reload $2.3M) is across general-agent, customer-support, AI-employee, and review-agent use cases. Pure coding-agent memory is a narrower wedge than the cap tables suggest. Funding does not equal end-user buying signal.
- **What would change the call:** A pure-play coding-memory vendor raises >$20M explicitly positioned for developer teams (not AI app builders). Until then, treat the "memory supercycle" framing as investor narrative, not procurement.

### 4. Benchmark wars without reproducibility

- **What is claimed:** Several vendor pages publish LongMemEval scores without methodology or reproduction path; "top leaderboards" proliferate. [CONFIRMED 2026][supermemory-research][mastra-obs-memory][retaindb]
- **Why partly overhyped:** Vectorize's Manifesto is correct: non-reproducible scores do not prove capability. A vendor that publishes only a score is building a marketing asset, not a credibility asset.
- **What would change the call:** None required to act; Tages should publish with reproduction notes regardless. But treat competitor claims without reproduction as roughly equivalent to marketing copy.

---

## Appendix

### Classification balance

- Technology shift: Trends 1, 3, 8 (3)
- Competitive dynamic: Trends 2, 4 (2)
- Investment pattern: Trend 5 primary (1)
- Regulatory: Trend 5 secondary, Trend 1 secondary (inline)
- Behavioral shift: Trends 6, 7 (2)

Five of five buckets represented.

### Horizon balance

- Near-term (0–1yr): Trends 1, 2, 3 (3)
- Medium-term (1–3yr): Trends 4, 5, 6, 7 (4)
- Long-term (3–5yr): Trend 8 (1)

### Geography

US-centric category. No regional wedge surfaced. Tages's existing US-market positioning is correct.

### Source list

[aaif-launch]: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
[github-mcp-lf]: https://github.blog/open-source/maintainers/mcp-joins-the-linux-foundation-what-this-means-for-developers-building-the-next-era-of-ai-tools-and-agents/
[cc-memory-docs]: https://code.claude.com/docs/en/memory
[github-agents-md]: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/
[augment-agents-md]: https://www.augmentcode.com/guides/how-to-build-agents-md
[codex-agents-md]: https://developers.openai.com/codex/guides/agents-md
[openmemory]: https://mem0.ai/openmemory
[mem0-series-a]: https://mem0.ai/series-a
[supermemory-blog]: https://blog.supermemory.ai/agentic-workflows-vp-engineering-guide/
[supermemory-apis]: https://blog.supermemory.ai/best-memory-apis-stateful-ai-agents/
[supermemory-research]: https://supermemory.ai/research/
[cognee]: https://www.cognee.ai/
[crunchbase-q1-2026]: https://news.crunchbase.com/venture/record-breaking-funding-ai-global-q1-2026/
[stacklok-docs]: https://docs.stacklok.com/toolhive/
[stacklok-blog]: https://stacklok.com/blog/governing-mcp-servers-in-cursor-with-stacklok/
[mcp-security]: https://cikce.medium.com/8-000-mcp-servers-exposed-the-agentic-ai-security-crisis-of-2026-e8cb45f09115
[longmemeval-iclr]: https://openreview.net/forum?id=pZiyCaVuti
[retaindb]: https://www.retaindb.com/benchmark
[mastra-obs-memory]: https://mastra.ai/research/observational-memory
[vectorize-manifesto]: https://hindsight.vectorize.io/blog/2026/03/23/agent-memory-benchmark
[fortune-interloom]: https://fortune.com/2026/03/23/interloom-ai-agents-raises-16-million-venture-funding/
[techcrunch-reload]: https://techcrunch.com/2026/02/19/reload-an-ai-employee-agent-management-platform-raises-2-275m-and-launches-an-ai-employee/
[collab-memory]: https://arxiv.org/html/2505.18279v1
[siliconangle]: https://siliconangle.com/2026/02/19/memory-supercycle-ai-funding-frenzy-pouring-fuel/
[graphiti-gh]: https://github.com/getzep/graphiti
[zep-home]: https://www.getzep.com/
[zep-paper-ref]: https://arxiv.org/abs/2501.13956
