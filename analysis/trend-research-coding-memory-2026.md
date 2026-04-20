# Trend Research Notes: AI Coding Agent Memory / MCP Ecosystem (April 2026)

**Date compiled:** 2026-04-19
**Researcher:** Claude Opus 4.7 (1M context)
**Purpose:** Evidence base for `trend-scan-coding-memory-2026.md`. Claims tagged `[CONFIRMED YYYY-MM — key]`, `[UNVERIFIED — what would confirm]`, `[INFERRED → validate by: ...]`, or `[USER-SUPPLIED]`.

---

## 1. MCP: permanent infrastructure

- Anthropic donated MCP to the Linux Foundation on 2025-12-09, founding the **Agentic AI Foundation (AAIF)** with Block and OpenAI as co-founders. [CONFIRMED 2025-12][aaif-launch]
- Platinum members: AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI. Gold: 18 co including Adyen, Cisco, Datadog, Docker, IBM, JetBrains, Okta, Salesforce, Shopify, Snowflake, Temporal. [CONFIRMED 2025-12][aaif-launch]
- Other AAIF founding projects: **goose** (Block), **AGENTS.md** (OpenAI). [CONFIRMED 2025-12][aaif-launch]
- MCP stats as of 2026-Q1: 97M monthly SDK downloads, 10,000 active servers, first-class support in ChatGPT, Claude, Cursor, Gemini, Microsoft Copilot, VS Code. [CONFIRMED 2026-03][github-mcp-lf]

## 2. Claude Code memory (actual April 2026 state)

From `code.claude.com/docs/en/memory` fetched 2026-04-19:

**Memory layers, in order of precedence:**

| Layer | Location | Scope | Shared with | Audit/RBAC? |
|---|---|---|---|---|
| **Managed policy** | `/Library/Application Support/ClaudeCode/CLAUDE.md` (mac), `/etc/claude-code/CLAUDE.md` (linux), `C:\Program Files\ClaudeCode\CLAUDE.md` (win) | Org-wide | All users on a managed machine | No. Push-only via MDM/Group Policy/Ansible. Cannot be excluded by users. |
| **Project** | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project | Team via source control | Git-based only |
| **User** | `~/.claude/CLAUDE.md` | Personal, all projects | Only the user | None |
| **Local** | `./CLAUDE.local.md` | Personal, one project | Only the user (gitignored) | None |
| **Path-scoped rules** | `.claude/rules/*.md` with YAML frontmatter `paths:` | Project, glob-scoped | Team via source control | None |
| **Auto memory** | `~/.claude/projects/<repo>/memory/MEMORY.md` + topic files | Per git repo, per machine | **Not shared across machines or cloud** | None; user can edit/delete |

Critical facts: [CONFIRMED 2026-04][cc-memory-docs]

- Auto-memory requires v2.1.59+; loads first 200 lines / 25KB of MEMORY.md per session.
- Managed CLAUDE.md is for "instructions/policies," not shared learnings. No provenance. No audit log. No per-user access control.
- AGENTS.md is NOT directly read by Claude Code. Users must create CLAUDE.md that imports AGENTS.md via `@AGENTS.md`.
- Claude Code memory files are **machine-local**. No cloud sync.
- "Team" sharing works through Git (check in CLAUDE.md) or MDM (push managed file).

**What Claude Code does NOT have:** [INFERRED 2026-04 → validate by: monitor cc changelog monthly]
- True collaborative team memory service
- Memory audit logs / provenance (who wrote what, when, why)
- RBAC at content granularity
- Cross-machine / cross-user memory graph
- Cross-agent portability (memory written by Claude Code doesn't flow to Cursor or Codex)
- Structured memory types (11-type taxonomy, convention/decision/anti-pattern, etc.)
- Quality-control CLI comparable to `audit` / `sharpen` / `enforce`

## 3. AGENTS.md: the cross-tool convention

- 60,000+ repos contain AGENTS.md as of 2026-04. [CONFIRMED 2026-04][github-agents-md]
- Detailed AGENTS.md correlates with 35–55% fewer agent-generated bugs on community leaderboards. [CONFIRMED 2026-04][github-agents-md] [DOMAIN REVIEW NEEDED — leaderboard methodology]
- Open format, markdown-only, Linux Foundation-stewarded. [CONFIRMED 2025-12][aaif-launch][CONFIRMED 2026-04][agents-md-site]
- Adopted by: OpenAI Codex, GitHub Copilot, Cursor (as primary), Factory, Ona, Kilo, Augment Code. [CONFIRMED 2026-04][augment-agents-md][codex-agents-md]
- Claude Code reads **CLAUDE.md**, not AGENTS.md directly. Users bridge with `@AGENTS.md` import. [CONFIRMED 2026-04][cc-memory-docs]

## 4. Mem0 / OpenMemory coding positioning

- **OpenMemory is explicitly a coding-agents product.** Supports Cursor, Windsurf, VS Code, Claude, "every MCP-compatible coding agent." [CONFIRMED 2026-04][openmemory]
- Capabilities: auto-captures coding preferences, patterns, setup; project-scoped memories; memory tagged by type (user preference, implementation); full privacy + audit control showing access logs of memory served. [CONFIRMED 2026-04][openmemory]
- "State of AI Agent Memory 2026" published 2026-Q1 — Mem0 positioning itself as category shaper. [CONFIRMED 2026][mem0-state]
- Funding: $24M (Seed + Series A) Oct 2025; 186M API calls Q3 2025; AWS exclusive memory provider for Agent SDK. [CONFIRMED 2025-10][mem0-series-a]
- Note: no public team/collaborative memory feature surfaced. OpenMemory is per-user, per-machine. [UNVERIFIED — check Mem0 Enterprise docs for team graph]

## 5. Supermemory positioning update

- Shipped dedicated Claude Code plugin and OpenCode plugin. "Agents can run for months without starting over." [CONFIRMED 2026-04][supermemory-blog]
- Positions treat memory expiration as first-class; API-first; single vendor surface. [CONFIRMED 2026-04][supermemory-apis]
- 22k GitHub stars, MIT. $2.6M seed Oct 2025. Founder age 19. [CONFIRMED 2025-10][techcrunch-supermemory]
- Benchmark: LongMemEval 85.4% overall; 92.3% single-session user retrieval. [CONFIRMED 2026][supermemory-research]

## 6. MCP security: the $692M March

- **March 2026 MCP-adjacent funding: $692M in a single month.** [CONFIRMED 2026-03][aaif-launch]
  - Snyk $300M (AI-focused application security) [CONFIRMED 2026-03][snyk-funding]
  - Chainguard $356M (software supply-chain security, explicitly AI agent workloads) [CONFIRMED 2026-03][chainguard-funding]
  - Stacklok $36M (MCP governance, ToolHive/vMCP) [CONFIRMED 2026-03][stacklok]
- Stacklok ToolHive / vMCP capabilities: tool pre-filtering before agent sees it; on-demand tool discovery (60–85% token cut); OpenTelemetry observability; audit log of every server download + tool call. [CONFIRMED 2026-04][stacklok-docs]
- Enterprise concern: "agents receive every tool in every connected server" without a gateway. [CONFIRMED 2026-04][stacklok-blog]
- 8,000+ MCP servers exposed on public internet; hundreds bound to 0.0.0.0 by default. [CONFIRMED 2025-2026][mcp-security] [DOMAIN REVIEW NEEDED]

## 7. LongMemEval: the benchmark that counts

- Published ICLR 2025. 500 curated questions across 5 abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention. [CONFIRMED 2025][longmemeval-iclr]
- 2026 scores on public leaderboard style:
  - **RetainDB** 88% preference recall, 79% overall, March 2026, published methodology + reproduce notes. [CONFIRMED 2026-03][retaindb]
  - **Supermemory** 85.4% overall. [CONFIRMED 2026][supermemory-research]
  - **Observational Memory (Mastra)** 84.23% gpt-4o. [CONFIRMED 2026][mastra-obs-memory]
- Vectorize "Agent Memory Benchmark Manifesto" (Mar 2026) makes the case: "the only credible benchmark is one you can reproduce yourself." [CONFIRMED 2026-03][vectorize-manifesto]
- Tages's "9.1/10 vs 2.8/10" README claim is not LongMemEval and has no published methodology. [USER-SUPPLIED — Tages README:97]

## 8. Memory governance / corporate memory

- **Interloom** $16.5M VC round March 2026 for "corporate memory problem" — narrowed the gap between documented and actual operational knowledge from ~50% to 5%. [CONFIRMED 2026-03][fortune-interloom]
- **Reload** $2.275M Feb 2026 for shared AI employee memory. [CONFIRMED 2026-02][techcrunch-reload]
- Collaborative Memory arXiv paper May 2025. [CONFIRMED 2025-05][collab-memory]
- SiliconANGLE "memory supercycle" framing, Feb 2026. [CONFIRMED 2026-02][siliconangle]
- Cognee named enterprise customers: Bayer, University of Wyoming, dltHub. >1M pipelines/month. [CONFIRMED 2026-04][cognee]

## 9. Zep/Graphiti trajectory

- Graphiti 25.1k stars, Apache-2.0. Active development, "enhanced custom schema support" upcoming. [CONFIRMED 2026-04][graphiti-gh]
- Drivers: Neo4j, FalkorDB, Kuzu, Neptune. [CONFIRMED 2026-04][graphiti-gh]
- Zep "context graphs at scale," positioning moved from "memory" to "context engineering." [CONFIRMED 2026-04][zep-home]
- No confirmed funding round in 2025. [UNVERIFIED]

## 10. Tages actual shipped state (from 2026-04-19 git analysis)

- 56 MCP tools, 53 CLI commands, 618 tests, 57 migrations. [CONFIRMED 2026-04-19 — internal code analysis]
- Tier split: 19 Free tools, 37 Pro tools, gated via `withGate()` wrapper. [CONFIRMED 2026-04-19]
- Team invite-flow shipped 2026-04-19. RBAC at migration 0031; team_invites at 0044, 0055, 0056. [CONFIRMED 2026-04-19]
- Encryption: AES-256-GCM field-level, opt-in via `TAGES_ENCRYPTION_KEY`. [CONFIRMED 2026-04-19]
- Dashboard: Next.js 16, 19 page routes, 12 API routes, Stripe checkout/portal/webhook wired. [CONFIRMED 2026-04-19]
- Red flags: release tag drift (v0.1.0 only, package.json at 0.2.1/0.1.1), README stale on counts (claims 52 cmds / 521 tests), no npm publish in CI. [CONFIRMED 2026-04-19]

---

## Reference keys

[aaif-launch]: https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
[github-mcp-lf]: https://github.blog/open-source/maintainers/mcp-joins-the-linux-foundation-what-this-means-for-developers-building-the-next-era-of-ai-tools-and-agents/
[mcp-blog-aaif]: https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/
[anthropic-mcp-lf]: https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
[cc-memory-docs]: https://code.claude.com/docs/en/memory
[cc-automemory]: https://medium.com/@joe.njenga/anthropic-just-added-auto-memory-to-claude-code-memory-md-i-tested-it-0ab8422754d2
[github-agents-md]: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/
[agents-md-site]: https://agents.md/
[augment-agents-md]: https://www.augmentcode.com/guides/how-to-build-agents-md
[codex-agents-md]: https://developers.openai.com/codex/guides/agents-md
[openmemory]: https://mem0.ai/openmemory
[mem0-state]: https://mem0.ai/blog/state-of-ai-agent-memory-2026
[mem0-series-a]: https://mem0.ai/series-a
[techcrunch-mem0]: https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/
[supermemory-blog]: https://blog.supermemory.ai/agentic-workflows-vp-engineering-guide/
[supermemory-apis]: https://blog.supermemory.ai/best-memory-apis-stateful-ai-agents/
[supermemory-research]: https://supermemory.ai/research/
[techcrunch-supermemory]: https://techcrunch.com/2025/10/06/a-19-year-old-nabs-backing-from-google-execs-for-his-ai-memory-startup-supermemory/
[stacklok]: https://stacklok.com/
[stacklok-docs]: https://docs.stacklok.com/toolhive/
[stacklok-blog]: https://stacklok.com/blog/governing-mcp-servers-in-cursor-with-stacklok/
[snyk-funding]: https://news.crunchbase.com/venture/record-breaking-funding-ai-global-q1-2026/
[chainguard-funding]: https://news.crunchbase.com/venture/record-breaking-funding-ai-global-q1-2026/
[mcp-security]: https://cikce.medium.com/8-000-mcp-servers-exposed-the-agentic-ai-security-crisis-of-2026-e8cb45f09115
[longmemeval-iclr]: https://openreview.net/forum?id=pZiyCaVuti
[longmemeval-gh]: https://github.com/xiaowu0162/longmemeval
[retaindb]: https://www.retaindb.com/benchmark
[mastra-obs-memory]: https://mastra.ai/research/observational-memory
[vectorize-manifesto]: https://hindsight.vectorize.io/blog/2026/03/23/agent-memory-benchmark
[fortune-interloom]: https://fortune.com/2026/03/23/interloom-ai-agents-raises-16-million-venture-funding/
[techcrunch-reload]: https://techcrunch.com/2026/02/19/reload-an-ai-employee-agent-management-platform-raises-2-275m-and-launches-an-ai-employee/
[siliconangle]: https://siliconangle.com/2026/02/19/memory-supercycle-ai-funding-frenzy-pouring-fuel/
[collab-memory]: https://arxiv.org/html/2505.18279v1
[cognee]: https://www.cognee.ai/
[graphiti-gh]: https://github.com/getzep/graphiti
[zep-home]: https://www.getzep.com/
[claude-code-2]: https://claude5.ai/news/anthropic-claude-code-v2-agentic-features-launch
[crunchbase-q1-2026]: https://news.crunchbase.com/venture/record-breaking-funding-ai-global-q1-2026/
