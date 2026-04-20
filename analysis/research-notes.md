# Tages Competitive Research Notes

**Purpose:** Evidence base for Tages competitive analysis. Category: AI coding agent memory / team memory. Tages is pre-launch, open source, MCP-based.

**Date compiled:** 2026-04-19
**Researcher:** Claude Opus 4.7

**Reading guide:**
- Every claim tagged `[CONFIRMED YYYY-MM — key]` or `[UNVERIFIED — what would confirm]`.
- `[DOMAIN REVIEW NEEDED]` flags security/compliance/IP claims that need a domain expert read.
- Reference-style links at bottom, short keys.

---

## TIER 1 — Direct memory platforms

### 1. Zep (getzep.com) + Graphiti (open source)

1. **Positioning:** "Context Engineering and Agent Memory Platform for AI Agents." Temporal knowledge graph approach. [CONFIRMED 2026-04 — zep-home]
2. **Product lineup:**
   - Zep Cloud (managed hosted memory service) [CONFIRMED 2026-04 — zep-pricing]
   - Graphiti (open source Apache-2.0 framework, 25.1k stars, last release mcp-v1.0.2 on 2026-03-11) [CONFIRMED 2026-04 — graphiti-gh]
   - Knowledge Graph MCP Server (from Zep, for Claude/Cursor access) [CONFIRMED 2026-04 — graphiti-gh]
   - Python + TypeScript SDKs [CONFIRMED 2026-04 — zep-home]
3. **Target user:** AI application builders and enterprises deploying stateful agents. Enterprise positioning with BYOK/BYOM/BYOC options. [CONFIRMED 2026-04 — zep-pricing]
4. **Pricing (confirmed):**
   - Free: 1,000 credits/month, 2 projects, no rollover [CONFIRMED 2026-04 — zep-pricing]
   - Flex: $125/mo with 50K credits; $25 per 10K extra credits; 5 projects; 30-day rollover [CONFIRMED 2026-04 — zep-pricing]
   - Flex Plus: $375/mo with 200K credits; $75 per 40K extra; 10 projects; webhooks, custom extraction; 60-day rollover [CONFIRMED 2026-04 — zep-pricing]
   - Enterprise: custom; SOC 2 Type II, HIPAA BAA, BYOK/BYOM/BYOC deployment [CONFIRMED 2026-04 — zep-pricing] [DOMAIN REVIEW NEEDED — verify SOC 2 attestation current]
   - Unit: 1 credit per Episode; Episodes >350 bytes bill in multiples [CONFIRMED 2026-04 — zep-pricing]
   - Prior search surface mentioned a "$475/mo" tier cap on cloud, but direct fetch of pricing page shows Flex Plus at $375/mo. Going with $375. [CONFIRMED 2026-04 — zep-pricing]
5. **Recent moves (last 12 months):**
   - Published Zep temporal KG paper on arXiv Jan 2025 (2501.13956) [CONFIRMED 2025-01 — zep-paper]
   - Scaled 30x in two weeks late 2025; P95 graph search 600ms → 150ms [UNVERIFIED — only surfaced via secondary blog summary]
   - Metered billing + BYOC deployments launched [CONFIRMED 2025 — zep-blog-billing]
   - Feature retirements May 2025 (likely deprecated older message-history APIs in favor of graph) [CONFIRMED 2025-05 — zep-retirements]
   - Graphiti MCP server v1.0.2 released March 2026 [CONFIRMED 2026-03 — graphiti-gh]
   - No known funding announcement in 2025 for Zep. [UNVERIFIED — would confirm via Crunchbase/PitchBook]
6. **Capability strengths:**
   - Temporal knowledge graph with fact validity windows (non-lossy updates) [CONFIRMED 2026-04 — graphiti-gh]
   - DMR benchmark: 94.8% vs MemGPT 93.4%; 18.5% accuracy gain and 90% latency cut vs baselines [CONFIRMED 2025-01 — zep-paper] [DOMAIN REVIEW NEEDED — benchmark methodology]
   - Hybrid retrieval (semantic + BM25 + graph traversal) [CONFIRMED 2026-04 — graphiti-gh]
   - Open-source core builds goodwill and developer trust
7. **Capability weaknesses:**
   - Credit-based metering is opaque for bursty workloads; Flex is $125 floor
   - Requires Neo4j (or FalkorDB/Kuzu/Neptune) for self-hosted Graphiti — heavy infra for a dev tool [CONFIRMED 2026-04 — graphiti-gh]
   - Not coding-agent-specific; positioning is general agent memory
8. **Distribution / install path:**
   - Graphiti self-hosted: `pip`/`uv install graphiti-core` + Neo4j 5.26+ + OpenAI key [CONFIRMED 2026-04 — graphiti-gh]
   - MCP server: bundled with Graphiti release [CONFIRMED 2026-04 — graphiti-gh]
   - Cloud: API keys, SDKs in Python/TS [CONFIRMED 2026-04 — zep-home]
9. **Memory model:** Temporal knowledge graph. Entities + relations with validity timestamps + episode provenance. Non-lossy: old facts invalidated, not deleted. [CONFIRMED 2026-04 — graphiti-gh]
10. **Team/sharing primitives:** Projects (5 on Flex, 10 on Flex Plus, unlimited on Enterprise). No explicit RBAC/federation docs surfaced. [UNVERIFIED — would confirm via help.getzep.com deep dive]
11. **Local-first:** Graphiti can be self-hosted fully; cloud version cannot run offline. Graphiti still requires external LLM for extraction by default. [CONFIRMED 2026-04 — graphiti-gh]
12. **Benchmarks/users:** DMR 94.8% (their paper, own benchmark); LongMemEval-style improvements claimed. Named customers not listed on public pages I reached. [UNVERIFIED — customer logos]

---

### 2. Mem0 (mem0.ai) + OpenMemory MCP

1. **Positioning:** "The memory layer for AI." Three-line integration for agent memory. [CONFIRMED 2026-04 — mem0-gh]
2. **Product lineup:**
   - Mem0 open source (Apache-2.0, 53.5k stars, pip/npm) [CONFIRMED 2026-04 — mem0-gh]
   - Mem0 Cloud (hosted API) [CONFIRMED 2026-04 — mem0-pricing]
   - OpenMemory MCP Server (local-first, runs on Docker + Postgres + Qdrant, dashboard at localhost:3000) [CONFIRMED 2026-04 — openmemory-blog]
   - CLI: `npm install -g @mem0/cli` or `pip install mem0-cli` [CONFIRMED 2026-04 — mem0-gh]
   - Claude/Cursor plugin directories in repo (`.claude-plugin`, `.cursor-plugin`) [CONFIRMED 2026-04 — mem0-gh]
3. **Target user:** Developers through Fortune 500. AWS uses Mem0 as exclusive memory provider for its Agent SDK. [CONFIRMED 2025-10 — mem0-series-a]
4. **Pricing (confirmed):**
   - Free: 10K add requests/mo, 1K retrieval requests/mo, unlimited end users, community support [CONFIRMED 2026-04 — mem0-pricing]
   - Starter: $19/mo (50K add, 5K retrieval) [CONFIRMED 2026-04 — mem0-pricing]
   - Pro: $249/mo (500K add, 50K retrieval, private Slack, multi-project) [CONFIRMED 2026-04 — mem0-pricing]
   - Enterprise: custom — on-prem, SSO, SLA, HIPAA BAA [CONFIRMED 2026-04 — mem0-pricing] [DOMAIN REVIEW NEEDED]
   - Startup program: 3 months free Pro for companies under $5M funding [CONFIRMED 2026-04 — mem0-pricing]
5. **Recent moves (last 12 months):**
   - $24M Seed + Series A raised Oct 2025; YC, Peak XV, Basis Set Ventures, GitHub Fund [CONFIRMED 2025-10 — mem0-series-a, techcrunch-mem0]
   - Scale: 35M API calls Q1 2025 → 186M Q3 2025 (~30% MoM growth) [CONFIRMED 2025-10 — mem0-series-a]
   - Launched OpenMemory MCP (local-first) in 2025 [CONFIRMED 2025 — openmemory-blog]
   - v3 algorithm: single-pass ADD-only extraction [CONFIRMED 2026-04 — mem0-gh]
6. **Capability strengths:**
   - Largest OSS community (53.5k stars, 14M downloads) [CONFIRMED 2026-04 — mem0-gh]
   - Simple 3-line integration
   - Multi-level memory (User/Session/Agent)
   - Both hosted and local-first via OpenMemory
   - AWS integration partnership
7. **Capability weaknesses:**
   - Pricing jump from $19 to $249 creates mid-market gap
   - Coding-agent-specific features are via "OpenMemory for coding agents" branding layered on top, not native
   - Self-hosted OpenMemory stack is heavy (Docker + Postgres + Qdrant)
8. **Distribution:** pip, npm, Docker Compose, CLI, SDK, MCP server. Dashboards for OpenMemory and cloud. [CONFIRMED 2026-04 — mem0-gh, openmemory-blog]
9. **Memory model:** Vector-based (Qdrant under hood for OpenMemory); hybrid retrieval (semantic + keyword + entity linking). Not a knowledge graph first. v3 is extraction-based fact storage. [CONFIRMED 2026-04 — mem0-gh, openmemory-blog]
10. **Team/sharing:** Enterprise has SSO and multi-project. No specific team-shared memory graph across users surfaced — positioning is per-user memory. [UNVERIFIED — would confirm in Enterprise docs]
11. **Local-first:** Yes via OpenMemory MCP; "no cloud sync, no external storage." [CONFIRMED 2026-04 — openmemory-blog]
12. **Benchmarks/users:** 41K GitHub stars (as of Oct 2025 series-a page); CrewAI, Flowise, Langflow native integrations; AWS Agent SDK. [CONFIRMED 2025-10 — mem0-series-a]

---

### 3. Supermemory (supermemory.ai)

1. **Positioning:** "Universal Memory API for AI apps." Five-layer context stack (connectors, extractors, retrieval, memory graph, user profiles). [CONFIRMED 2026-04 — supermemory-pricing]
2. **Product lineup:**
   - Open source core (MIT, 22k stars) [CONFIRMED 2026-04 — supermemory-gh]
   - Hosted API + console.supermemory.ai [CONFIRMED 2026-04 — supermemory-gh]
   - MCP server: `npx -y install-mcp@latest https://mcp.supermemory.ai/mcp` [CONFIRMED 2026-04 — supermemory-gh]
   - Coding agent plugins: Claude Code, Cursor, OpenCode, OpenClaw [CONFIRMED 2026-04 — supermemory-pricing]
   - Supermemory Nova (consumer app, free) [CONFIRMED 2026-04 — supermemory-search]
3. **Target user:** AI app builders and dev teams. Hobbyist tier exists (Nova). [CONFIRMED 2026-04 — supermemory-pricing]
4. **Pricing:**
   - Free: 1M tokens/mo, 10K queries/mo, unlimited users/storage [CONFIRMED 2026-04 — supermemory-pricing]
   - Pro: $19/mo, 3M tokens, 100K queries, all plugins (Claude Code, Cursor, OpenCode, OpenClaw) [CONFIRMED 2026-04 — supermemory-pricing]
   - Scale: $399/mo, 80M tokens, 20M queries, dedicated support, Gmail/S3/Web Crawler connectors [CONFIRMED 2026-04 — supermemory-pricing]
   - Enterprise: custom, forward-deployed engineer, SSO [CONFIRMED 2026-04 — supermemory-pricing]
   - Overage: $0.01/1K tokens, $0.10/1K queries [CONFIRMED 2026-04 — supermemory-pricing]
   - Startup program: $1K credits, 6 months [CONFIRMED 2026-04 — supermemory-pricing]
5. **Recent moves:**
   - $2.6M seed Oct 2025 (Susa Ventures, Browder Capital, SF1.vc + Cloudflare Knecht, Jeff Dean, Logan Kilpatrick, David Cramer) [CONFIRMED 2025-10 — techcrunch-supermemory]
   - Founder Dhravya Shah, 19 years old, ASU [CONFIRMED 2025-10 — techcrunch-supermemory]
   - Customers named: Cluely (a16z-backed), Montra, Scira, Rube (Composio), Rets [CONFIRMED 2025-10 — techcrunch-supermemory]
6. **Capability strengths:**
   - MIT license (most permissive of peers)
   - Sub-300ms recall claim [CONFIRMED 2026-04 — supermemory-pricing] [DOMAIN REVIEW NEEDED — p95? p99?]
   - Multi-modal extraction (PDF, images, audio, video) free on every plan [CONFIRMED 2026-04 — supermemory-pricing]
   - Coding agent plugins included in Pro
   - Cloudflare Workers infra (edge-native)
7. **Capability weaknesses:**
   - Young company, small team
   - Knowledge graph claimed but implementation details thin in public docs [UNVERIFIED]
   - Not coding-agent-focused by default; plugins are secondary
8. **Distribution:** npm for MCP, SDKs (Python/JS/TS), self-host open source, hosted API. [CONFIRMED 2026-04 — supermemory-gh]
9. **Memory model:** Knowledge graph + vector hybrid with user profiles. Automatic fact extraction, contradiction resolution, "automatic forgetting." [CONFIRMED 2026-04 — supermemory-gh]
10. **Team/sharing:** Unlimited users across all plans; Enterprise SSO. No explicit RBAC or team-graph detail surfaced. [UNVERIFIED]
11. **Local-first:** Core engine self-hostable (MIT). MCP server deployable independently. Hosted version is cloud. [CONFIRMED 2026-04 — supermemory-gh]
12. **Benchmarks/users:** Named customers above. No third-party benchmark results surfaced.

---

### 4. Letta (formerly MemGPT) (letta.com)

1. **Positioning:** "The platform for building stateful agents." OS-inspired memory architecture from the MemGPT paper. [CONFIRMED 2026-04 — letta-gh]
2. **Product lineup:**
   - Letta open source (Apache-2.0, 22.2k stars, from 11.9k earlier in the year on marketing page — growth over 2025-2026) [CONFIRMED 2026-04 — letta-gh, letta-pricing]
   - Letta Cloud (hosted API platform) [CONFIRMED 2026-04 — letta-pricing]
   - Letta Code (CLI + macOS desktop app + SDK — "memory-first agent") [CONFIRMED 2026-04 — letta-home]
   - Python, TypeScript, Rust SDKs [CONFIRMED 2026-04 — letta-gh]
3. **Target user:** Developers building personalized/stateful agents. Individual devs and teams. [CONFIRMED 2026-04 — letta-home]
4. **Pricing:**
   - Free: open source, self-host [CONFIRMED 2026-04 — letta-pricing]
   - Pro: $20/mo, 20 agents, open-weights usage quota, Letta Auto [CONFIRMED 2026-04 — letta-pricing]
   - Max Lite: $100/mo, 50 agents, all frontier model providers [CONFIRMED 2026-04 — letta-pricing]
   - Max: $200/mo, increased frontier quota, 20x Letta Auto, early features [CONFIRMED 2026-04 — letta-pricing]
   - API Plan: $20/mo base + $0.10/active agent/mo + $0.00015/sec tool exec + usage LLM costs [CONFIRMED 2026-04 — letta-pricing]
5. **Recent moves:**
   - $10M seed Sept 2024 led by Felicis, $70M post-money valuation [CONFIRMED 2024-09 — traded-letta]
   - Reported $1.4M revenue as of June 2025 (13-person team) [UNVERIFIED — Getlatka third-party source, not primary] [DOMAIN REVIEW NEEDED — revenue claim source reliability]
   - Emerged from stealth Sept 2024; Berkeley PhDs Sarah Wooders and Charles Packer [CONFIRMED 2024-09 — techcrunch-letta]
   - Still at Seed as of April 2026 (no Series A confirmed) [CONFIRMED 2026-04 — pitchbook-letta]
6. **Capability strengths:**
   - First mover pedigree (MemGPT paper)
   - Editable memory blocks visible to users (transparent)
   - Model-agnostic, portable across providers
   - Both local desktop app and cloud options
7. **Capability weaknesses:**
   - No explicit team/multi-user memory sharing surfaced [UNVERIFIED]
   - MCP support not marketed prominently [UNVERIFIED — would confirm via Letta docs]
   - MemGPT on DMR (93.4%) now outperformed by Zep (94.8%) on own Zep benchmark [CONFIRMED 2025-01 — zep-paper]
8. **Distribution:** npm for Letta Code CLI, Python/TS/Rust SDKs, Docker, macOS desktop app, Letta Cloud API. [CONFIRMED 2026-04 — letta-home]
9. **Memory model:** Three tiers — Core Memory (in context window), Recall Memory (searchable history), Archival Memory (long-term, tool-queried). Editable memory blocks labeled "human" and "persona." [CONFIRMED 2026-04 — letta-gh]
10. **Team/sharing:** Agents are model/API-portable. No dedicated team memory primitives. [UNVERIFIED — no public docs surfaced]
11. **Local-first:** Letta Code CLI runs fully locally on user's computer; open source core on GitHub. [CONFIRMED 2026-04 — letta-pricing]
12. **Benchmarks/users:** Original MemGPT paper has strong academic citation base. Public customer logos not surfaced.

---

## TIER 2 — MCP memory / knowledge servers

### 5. Anthropic MCP Memory Server (reference implementation)

1. **Positioning:** Reference implementation — "Knowledge graph-based persistent memory system." [CONFIRMED 2026-04 — mcp-memory-gh]
2. **Product lineup:** Open source reference MCP server only. npx, Docker, VS Code one-click install. [CONFIRMED 2026-04 — mcp-memory-gh]
3. **Target user:** Developers evaluating MCP; not a commercial product.
4. **Pricing:** Free, MIT-adjacent (repo inherits modelcontextprotocol org license). [CONFIRMED 2026-04 — mcp-memory-gh]
5. **Recent moves:** The modelcontextprotocol/servers monorepo has 84.1k stars, active maintenance. [CONFIRMED 2026-04 — mcp-servers-gh]
6. **Capability strengths:**
   - Official Anthropic reference; widely copied as starting point
   - Dead simple JSONL storage — fully local, no DB required
7. **Capability weaknesses:**
   - `read_graph` dumps entire graph into context (14K+ tokens reported) [CONFIRMED 2026 — mempalace-blog]
   - No project/memory isolation between sessions [CONFIRMED 2026 — mempalace-blog]
   - Scales poorly; explicit complaints in community
8. **Distribution:** `npx -y @modelcontextprotocol/server-memory` or Docker. [CONFIRMED 2026-04 — mcp-memory-gh]
9. **Memory model:** Knowledge graph — Entities + Relations (directed) + Observations (strings). Stored in JSONL. [CONFIRMED 2026-04 — mcp-memory-gh]
10. **Team/sharing:** None. Single-user local file. [CONFIRMED 2026-04 — mcp-memory-gh]
11. **Local-first:** Fully. [CONFIRMED 2026-04 — mcp-memory-gh]
12. **Benchmarks/users:** De facto baseline; community benchmarks show it gets beaten by purpose-built servers.

---

### 6. Basic Memory (github.com/basicmachines-co/basic-memory)

1. **Positioning:** "AI conversations that actually remember. Never re-explain your project to your AI again." Obsidian-compatible markdown notes as memory. [CONFIRMED 2026-04 — basic-memory-gh]
2. **Product lineup:**
   - Open source MCP server (AGPL-3.0, 2.9k stars) [CONFIRMED 2026-04 — basic-memory-gh]
   - Basic Memory Cloud (subscription cloud routing) [CONFIRMED 2026-04 — basic-memory-gh]
   - basic-memory-skills companion repo [CONFIRMED 2026-04 — basic-memory-gh]
3. **Target user:** Developers/knowledge workers already in a markdown/Obsidian workflow. [CONFIRMED 2026-04 — basic-memory-gh]
4. **Pricing:**
   - Open source: free (AGPL) [CONFIRMED 2026-04 — basic-memory-gh]
   - Cloud: subscription, "BMFOSS" code gives 20% off to OSS users [CONFIRMED 2026-04 — basic-memory-gh] [UNVERIFIED — exact dollar amounts not surfaced]
5. **Recent moves:** v0.12.0 released in 2026. Discord community. [CONFIRMED 2026-04 — basic-memory-gh]
6. **Capability strengths:**
   - Markdown files are human-readable and diff-able
   - Obsidian integration (both LLM and human edit same files)
   - Local-first with SQLite index, fully offline
   - MCP-native
7. **Capability weaknesses:**
   - AGPL-3.0 is a hard blocker for many commercial embeddings [DOMAIN REVIEW NEEDED — competing products often can't adopt]
   - Small team, 2.9k stars vs Graphiti 25k or Mem0 53k
   - No team/multi-user primitives
   - Not coding-agent-specific; general knowledge mgmt
8. **Distribution:** `uv tool install basic-memory` or Homebrew. [CONFIRMED 2026-04 — basic-memory-gh]
9. **Memory model:** Observations (typed facts) + Relations (WikiLink-style) stored in markdown files; SQLite + semantic vector index; graph traversal via memory:// URLs. [CONFIRMED 2026-04 — basic-memory-gh]
10. **Team/sharing:** None explicit. Cloud offers "per-project routing." [CONFIRMED 2026-04 — basic-memory-gh]
11. **Local-first:** Yes, fully offline. [CONFIRMED 2026-04 — basic-memory-gh]
12. **Benchmarks/users:** No public benchmarks. Community via Discord.

---

### 7. Other notable MCP memory servers

- **Cognee (topoteretes/cognee):** Graph-vector hybrid memory; SQLite + LanceDB + Kuzu embedded; MCP server for Cursor/Claude/Cline; >1M pipelines/month; 70+ companies including Bayer, University of Wyoming, dltHub. [CONFIRMED 2026-04 — cognee-home, cognee-gh]
- **mcp-memory-service (doobidoo):** REST API + knowledge graph + autonomous consolidation; supports LangGraph, CrewAI, AutoGen. [CONFIRMED 2026-04 — mcp-memory-service-gh]
- **MemPalace:** Viral April 2026 launch; SQLite + ChromaDB, 19 MCP tools for Claude Code; MIT-licensed; strong LongMemEval claims. [CONFIRMED 2026-04 — mempalace-blog] [UNVERIFIED — benchmark claim]
- **Hmem:** Feb 2026 Show HN post framing "persistent hierarchical memory for AI coding agents." [CONFIRMED 2026-02 — hn-hmem]
- **local-memory-mcp (cunicopia-dev):** Small project, local-only. [CONFIRMED 2026-04 — mcp-local-search]

---

## TIER 3 — Embedded memory in IDE/agent tools

### 8. Cursor (cursor.com)

1. **Positioning:** Leading AI code editor, now with agentic features.
2. **Product lineup:** Editor, MCPs, cloud agents, Agent rules, Memories feature. [CONFIRMED 2026-04 — cursor-pricing]
3. **Target user:** Individual devs through enterprise.
4. **Pricing (June 2025 credit-based revamp):**
   - Hobby: free [CONFIRMED 2026-04 — cursor-pricing]
   - Pro: $20/mo ($16 annual) — $20 monthly credit pool [CONFIRMED 2026-04 — cursor-pricing]
   - Pro+: $60/mo — 3x credits [CONFIRMED 2026-04 — cursor-pricing]
   - Ultra: $200/mo — large codebases, all day [CONFIRMED 2026-04 — cursor-pricing]
   - Teams: $40/user/mo — privacy mode, SSO, $20 credit/user [CONFIRMED 2026-04 — cursor-pricing]
   - Enterprise: custom — SCIM, audit logs, pooled usage [CONFIRMED 2026-04 — cursor-pricing]
5. **Recent moves:** June 2025 shift from request-based to credit-based pricing. Cursor 3 with Worktrees. Expansion of Rules and Memories across team/org. [CONFIRMED 2025-06 — cursor-pricing]
6. **Strengths:** Massive user base; Memories generate automatically; rules in repo + user + team + AGENTS.md.
7. **Weaknesses:** Memories are project-scoped and tool-locked. No cross-tool portability. Credit model opaque.
8. **Distribution:** Standalone editor (VS Code fork). [CONFIRMED 2026-04 — cursor-pricing]
9. **Memory model:** Rules (project `.cursor/rules/*.mdc`, user, team, AGENTS.md) + auto-generated Memories from conversations. Not graph; more like scoped prompt snippets. [CONFIRMED 2026-04 — cursor-memory]
10. **Team/sharing:** Team rules via dashboard; enterprise adds SCIM. [CONFIRMED 2026-04 — cursor-pricing]
11. **Local-first:** No. Privacy mode exists but cloud-hosted. [CONFIRMED 2026-04 — cursor-pricing]
12. **Notable:** Future 2026 roadmap includes org-wide memory per secondary coverage. [UNVERIFIED — only in blog speculation]

---

### 9. Windsurf (windsurf.com / formerly Codeium)

1. **Positioning:** AI-native code editor with Cascade agent and Memories.
2. **Product lineup:** Editor, Cascade engine, Memories, SWE-1.5 model. [CONFIRMED 2026-04 — windsurf-pricing]
3. **Target user:** Individual devs to enterprise.
4. **Pricing:**
   - Pro: $15/mo — 500 credits/mo, unlimited completions [CONFIRMED 2026-04 — windsurf-pricing]
   - Teams: $30/user/mo — 500 credits, SSO, usage analytics [CONFIRMED 2026-04 — windsurf-pricing]
   - Enterprise: custom — 1,000 credits/user, RBAC, SSO+SCIM, 200-seat cap default [CONFIRMED 2026-04 — windsurf-pricing]
5. **Recent moves (MAJOR):**
   - OpenAI acquisition for $3B fell apart in 2025 due to Microsoft IP rights conflict [CONFIRMED 2025 — devops-windsurf]
   - Cognition (Devin) acquired Windsurf for ~$250M Dec 2025 [CONFIRMED 2025-12 — techfunding-windsurf]
   - OpenAI/Google/Cognition split product, talent, and IP across three rivals [CONFIRMED 2025 — techfunding-windsurf]
   - Codemaps feature, SWE-1.5 model [CONFIRMED 2026-04 — windsurf-pricing]
6. **Strengths:** Agentic Cascade; Memories learn codebase patterns over ~48 hours of use.
7. **Weaknesses:** Memories are implicit, not exportable; post-acquisition stability questionable.
8. **Distribution:** Standalone editor. VS Code plugin. [CONFIRMED 2026-04 — windsurf-pricing]
9. **Memory model:** Opaque "Cascade learns your patterns" — appears to be implicit context not structured memory. [CONFIRMED 2026-04 — windsurf-pricing]
10. **Team/sharing:** Team admin dashboard; Enterprise RBAC. [CONFIRMED 2026-04 — windsurf-pricing]
11. **Local-first:** No. [CONFIRMED 2026-04 — windsurf-pricing]

---

### 10. Continue.dev (continue.dev)

1. **Positioning:** "Source-controlled AI checks, enforceable in CI. Powered by the open-source Continue CLI." [CONFIRMED 2026-04 — continue-gh]
2. **Product lineup:** Open source VS Code / JetBrains plugin + CLI. Free. [CONFIRMED 2026-04 — continue-gh]
3. **Target user:** Devs who want control over models and privacy.
4. **Pricing:** Free (Apache-2.0 open source). [CONFIRMED 2026-04 — continue-gh] [UNVERIFIED — any hosted/paid tier]
5. **Recent moves:** Expanded rules system with `.continue/rules/`; MCP integration. [CONFIRMED 2026-04 — continue-docs]
6. **Strengths:** Model-agnostic, local LLM support (Ollama, LM Studio), MCP integration for databases, git, docs.
7. **Weaknesses:** No structured memory beyond rules + embeddings; no temporal layer; not a memory product per se.
8. **Distribution:** VS Code/JetBrains marketplace + CLI. [CONFIRMED 2026-04 — continue-gh]
9. **Memory model:** Embedding + re-ranking for code retrieval; rules directories; MCP for external data. No knowledge graph. [CONFIRMED 2026-04 — continue-docs]
10. **Team/sharing:** Rules in `.continue/rules/` dir, check into repo (Git as the sharing primitive). [CONFIRMED 2026-04 — continue-docs]
11. **Local-first:** Yes, with local LLMs. [CONFIRMED 2026-04 — continue-local-tutorial]

---

### 11. Claude Code (Anthropic) — Tages's main incumbent

1. **Positioning:** First-party Anthropic CLI for agentic coding. [CONFIRMED 2026-04 — cc-docs]
2. **Product lineup:** CLI + CLAUDE.md memory + SKILL.md skills + auto-memory + auto-dream (late 2025/early 2026). [CONFIRMED 2026-04 — cc-docs, cc-automemory]
3. **Target user:** Claude Pro/Max/Team/Enterprise subscribers, devs.
4. **Pricing:** Bundled in Claude subscriptions ($20/mo Pro; $100/mo Max; enterprise via Anthropic). [UNVERIFIED — exact current Claude Code tier breakdown]
5. **Recent moves (last 12 months):**
   - CLAUDE.md convention established and widely adopted [CONFIRMED 2025 — cc-docs]
   - Agent Skills (SKILL.md) launched in anthropics/skills repo [CONFIRMED 2025 — anthropic-skills-gh]
   - Auto-memory (MEMORY.md) added Feb 2026, requires v2.1.59+ [CONFIRMED 2026-02 — cc-automemory]
   - Auto-dream (memory consolidation) added March 2026 [CONFIRMED 2026-03 — cc-autodream]
   - Feb/April 2026 workspace updates [CONFIRMED 2026-02 — cc-feb2026]
6. **Strengths:**
   - First-party integration, no install friction for Claude users
   - CLAUDE.md is the de facto standard devs have internalized
   - Skills ecosystem is expanding; plugin-style packaging
   - Auto-memory + auto-dream is a direct shot at the Tages thesis
7. **Weaknesses (relevant to Tages):**
   - 200-line hard limit on MEMORY.md [CONFIRMED 2026-02 — cc-automemory]
   - Claude-only; not portable to Cursor/Windsurf
   - Memory is per-project, per-machine — no team sharing
   - No structured types, no temporal, no graph — just markdown
   - Long sessions still compress and lose decisions (community complaint) [CONFIRMED 2026-02 — hn-hmem]
8. **Distribution:** Bundled npm `claude-code` CLI. [CONFIRMED 2026-04 — cc-docs]
9. **Memory model:** Plain markdown. CLAUDE.md (hand-authored instructions) + MEMORY.md (auto-written notes) + SKILL.md frontmatter. Auto-dream reorganizes topics and converts relative dates to absolute. [CONFIRMED 2026-03 — cc-autodream]
10. **Team/sharing:** CLAUDE.md can be checked into Git. No native team memory service. [CONFIRMED 2026-04 — cc-docs]
11. **Local-first:** Memory files are local. Model inference still requires Anthropic API. [CONFIRMED 2026-04 — cc-docs]
12. **Notable:** Auto-dream is the closest incumbent feature to a "team memory for agents" pitch — but still single-user, per-project.

---

## TIER 4 — Adjacent / emerging

### 12. Sourcegraph Cody

1. **Positioning:** Codebase-aware AI assistant using Sourcegraph's code graph.
2. **Product lineup:** Cody VS Code/JetBrains plugins + Sourcegraph platform. [CONFIRMED 2026-04 — cody-pricing]
3. **Pricing:**
   - Enterprise Starter: $19/user/mo — but Cody removed from Starter as of June 25, 2025 [CONFIRMED 2025-06 — sg-changes]
   - Cody Enterprise: $59/user/mo, annual contract, typical $50-75K/yr minimum [CONFIRMED 2026-04 — cody-pricing]
4. **Strengths:** 1M token context, multi-repo context (up to 10 repos), OpenCtx providers (Jira, Linear, Notion, Google Docs).
5. **Weaknesses:** RAG-based, not memory — no persistent user/team facts across sessions. Community reports "lost context between sessions." [CONFIRMED 2026 — cody-review]
6. **Memory model:** RAG over indexed codebase + OpenCtx context providers. Not a persistence/memory system. [CONFIRMED 2026-04 — cody-context]

---

### 13. Greptile

1. **Positioning:** AI code review agent with complete codebase context.
2. **Product lineup:** PR reviewer (GitHub/GitLab integration), enterprise self-hosted option. [CONFIRMED 2026-04 — greptile-home]
3. **Pricing:** $30/developer/mo; free for OSS; self-hosted/enterprise on request. [CONFIRMED 2026-04 — greptile-pricing]
4. **Recent moves:**
   - $25M Series A 2024 led by Benchmark, $30M total raised, $180M valuation [CONFIRMED 2024 — gatech-greptile]
   - YC W24 alum [CONFIRMED 2024 — gatech-greptile]
   - v4 early 2026 — 74% more addressed comments, 68% more positive dev replies [CONFIRMED 2026 — greptile-blog]
   - Long-term memory for review agent added (learns team's idiosyncrasies) [CONFIRMED 2026 — greptile-blog]
   - Jira/Google Docs/Notion MCP integrations [CONFIRMED 2026 — greptile-blog]
5. **Memory model:** Graph-based codebase context + long-term memory layer that absorbs team review patterns. [CONFIRMED 2026-04 — greptile-graph]
6. **Adjacent not direct:** Greptile is code review, not agent memory primitive. But their long-term memory direction is a signal — they're building team memory into a code review product, adjacent to Tages.

---

## Market section

### Market size / trajectory signals

- **Mem0 growth:** 35M API calls Q1 2025 → 186M Q3 2025, ~30% MoM [CONFIRMED 2025-10 — mem0-series-a]
- **MCP adoption:** >8,000 MCP servers exposed on public internet by Feb 2026 [CONFIRMED 2026-02 — mcp-security] [DOMAIN REVIEW NEEDED — security implications]
- **MCP monorepo:** 84.1k stars on modelcontextprotocol/servers [CONFIRMED 2026-04 — mcp-servers-gh]
- **Total disclosed Tier-1 funding:** Mem0 $24M (2025-10) + Supermemory $2.6M (2025-10) + Letta $10M (2024-09) + Greptile $30M cum (2024) = ~$66M visible. Zep funding undisclosed in public 2025 sources. [UNVERIFIED for Zep]
- **Interloom** raised $16.5M Series for AI agent "tacit knowledge" Mar 2026. [CONFIRMED 2026-03 — fortune-interloom]
- **Reload** raised $2.275M Feb 2026 for shared AI agent memory / "AI employee" platform. [CONFIRMED 2026-02 — techcrunch-reload]
- **SiliconANGLE ("memory supercycle"):** explicitly frames AI memory as the next funding wave Feb 2026. [CONFIRMED 2026-02 — siliconangle]

### Key trends 2025-2026

1. **MCP became the standard.** MCP donated to Linux Foundation. Claude, GPT, Gemini, and most agent frameworks support it. [CONFIRMED 2026 — mcp-local-search]
2. **Temporal knowledge graphs moved from research to product.** Zep's paper (Jan 2025) and Graphiti OSS made this architecture accessible. [CONFIRMED 2025-01 — zep-paper]
3. **Local-first memory is a differentiator.** OpenMemory, Basic Memory, Cognee, MemPalace all lead on "stays on your machine." [CONFIRMED 2026-04 — mcp-local-search]
4. **Coding agent memory is bifurcating from general agent memory.** OpenMemory branded a "coding agents" product; Supermemory shipped Claude Code/Cursor/OpenCode plugins; Cognee has Claude Code plugin with hooks. [CONFIRMED 2026-04 — supermemory-pricing, cognee-home]
5. **Incumbent IDEs (Cursor, Windsurf) are adding memory features, but still tool-locked and per-project.** [CONFIRMED 2026-04 — cursor-memory, windsurf-pricing]
6. **Anthropic ships auto-memory and auto-dream natively in Claude Code** — this is the main incumbent threat to any standalone memory product for Claude users. [CONFIRMED 2026-02 — cc-automemory] [CONFIRMED 2026-03 — cc-autodream]
7. **Shared / multi-user / RBAC memory is early and scarce.** Collaborative Memory arXiv paper (May 2025), Reload (Feb 2026) are early signals. Zep Enterprise and Mem0 Enterprise add SSO but not true shared memory graphs across users. [CONFIRMED 2025-05 — collab-memory-paper, 2026-02 — techcrunch-reload]

### Notable critiques / complaints

- **Official Anthropic MCP memory server:** `read_graph` dumps entire graph (14K+ tokens reported), no project isolation. [CONFIRMED 2026 — mempalace-blog]
- **CLAUDE.md limits:** Long conversations compress; decisions 2 hours in silently disappear; memory locked to one tool on one machine. [CONFIRMED 2026-02 — hn-hmem]
- **MCP security concerns:** 8,000+ exposed MCP servers; prompt injection risks; Backslash found hundreds bound to 0.0.0.0 by default. 39% of companies reported AI agents accessing unintended systems in 2025. [CONFIRMED 2025-2026 — mcp-security] [DOMAIN REVIEW NEEDED — serious implication for any MCP vendor's security posture]
- **Cody:** "Lost context between sessions" in 2026 reviews. [CONFIRMED 2026-04 — cody-review]
- **Mem0 opacity:** Pro tier jumps from $19 to $249 with no middle ground; variable LLM cost for extraction. [CONFIRMED 2026-04 — mem0-pricing]

### Recent funding events in AI memory / agent-persistence space

| Company | Round | Amount | Date | Source |
|---|---|---|---|---|
| Mem0 | Seed + Series A | $24M | 2025-10 | [mem0-series-a] |
| Supermemory | Seed | $2.6M | 2025-10 | [techcrunch-supermemory] |
| Letta | Seed | $10M at $70M post | 2024-09 | [traded-letta] |
| Greptile | Series A | $25M ($30M cumulative, $180M val) | 2024 | [gatech-greptile] |
| Interloom | Series (likely A) | $16.5M | 2026-03 | [fortune-interloom] |
| Reload | Seed | $2.275M | 2026-02 | [techcrunch-reload] |
| Zep | — | — | — | [UNVERIFIED — no 2025 announcement surfaced] |
| Cognee | — | — | — | [UNVERIFIED] |
| Basic Memory | — | — | — | [UNVERIFIED — appears bootstrapped/indie] |

---

## Summary take for Tages

**Direct head-to-heads (same category):** Mem0/OpenMemory, Zep/Graphiti, Supermemory, Letta, Basic Memory, Cognee, Anthropic's reference MCP memory server.

**Incumbent gravity (Tages must beat this):** Claude Code's native CLAUDE.md + auto-memory + auto-dream. Free, zero-friction for Claude users, shipping fast.

**Whitespace signals:**
- Team/shared memory with RBAC is barely addressed by any of the listed competitors (Collaborative Memory paper May 2025 notwithstanding)
- Coding-agent-specific memory semantics (code entities, PR context, file ownership) are not first-class anywhere
- Local-first + team-sharing is a contradiction most products dodge — they pick one
- MCP-native + open source + team primitives is an uncrowded combination

---

## References

[zep-home]: https://www.getzep.com/
[zep-pricing]: https://www.getzep.com/pricing/
[zep-paper]: https://arxiv.org/abs/2501.13956
[zep-blog-billing]: https://blog.getzep.com/introducing-metered-billing-and-byoc-deployments/
[zep-retirements]: https://www.getzep.com/blog/zep-feature-retirements-may-2025/
[graphiti-gh]: https://github.com/getzep/graphiti
[mem0-gh]: https://github.com/mem0ai/mem0
[mem0-pricing]: https://mem0.ai/pricing
[mem0-series-a]: https://mem0.ai/series-a
[techcrunch-mem0]: https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/
[openmemory-blog]: https://mem0.ai/blog/introducing-openmemory-mcp
[supermemory-gh]: https://github.com/supermemoryai/supermemory
[supermemory-pricing]: https://supermemory.ai/pricing/
[supermemory-search]: https://supermemory.ai/consumer
[techcrunch-supermemory]: https://techcrunch.com/2025/10/06/a-19-year-old-nabs-backing-from-google-execs-for-his-ai-memory-startup-supermemory/
[letta-home]: https://letta.com/
[letta-pricing]: https://letta.com/pricing
[letta-gh]: https://github.com/letta-ai/letta
[techcrunch-letta]: https://techcrunch.com/2024/09/23/letta-one-of-uc-berkeleys-most-anticipated-ai-startups-has-just-come-out-of-stealth/
[traded-letta]: https://traded.co/vc/deal/letta-secures-10-million-seed-funding-led-by-felicis-ventures-at-70-million-valuation/
[pitchbook-letta]: https://pitchbook.com/profiles/company/673815-70
[mcp-memory-gh]: https://github.com/modelcontextprotocol/servers/tree/main/src/memory
[mcp-servers-gh]: https://github.com/modelcontextprotocol/servers
[basic-memory-gh]: https://github.com/basicmachines-co/basic-memory
[cognee-home]: https://www.cognee.ai/
[cognee-gh]: https://github.com/topoteretes/cognee
[mcp-memory-service-gh]: https://github.com/doobidoo/mcp-memory-service
[mempalace-blog]: https://www.mempalace.tech/blog/best-ai-memory-frameworks-2026
[hn-hmem]: https://news.ycombinator.com/item?id=47103237
[mcp-local-search]: https://github.com/cunicopia-dev/local-memory-mcp
[cursor-pricing]: https://cursor.com/pricing
[cursor-memory]: https://www.lullabot.com/articles/supercharge-your-ai-coding-cursor-rules-and-memory-banks
[windsurf-pricing]: https://www.verdent.ai/guides/windsurf-pricing-2026
[devops-windsurf]: https://devops.com/openai-acquires-windsurf-for-3-billion-2/
[techfunding-windsurf]: https://techfundingnews.com/how-windsurf-was-split-between-openai-google-and-cognition-in-a-billion-dollar-acquisition-deal/
[continue-gh]: https://github.com/continuedev/continue
[continue-docs]: https://docs.continue.dev/customize/rules
[continue-local-tutorial]: https://github.com/stanek-michal/local_AI_code_assistant_tutorial
[cc-docs]: https://docs.anthropic.com/en/docs/claude-code/memory
[cc-automemory]: https://medium.com/@joe.njenga/anthropic-just-added-auto-memory-to-claude-code-memory-md-i-tested-it-0ab8422754d2
[cc-autodream]: https://antoniocortes.com/en/2026/03/30/auto-memory-and-auto-dream-how-claude-code-learns-and-consolidates-its-memory/
[cc-feb2026]: https://www.nagarro.com/en/blog/claude-code-feb-2026-update-analysis
[anthropic-skills-gh]: https://github.com/anthropics/skills
[cody-pricing]: https://sourcegraph.com/pricing
[cody-context]: https://sourcegraph.com/blog/how-cody-understands-your-codebase
[sg-changes]: https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans
[cody-review]: https://zencoder.ai/blog/cody-ai-alternatives
[greptile-home]: https://www.greptile.com/
[greptile-pricing]: https://www.greptile.com/pricing
[greptile-graph]: https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context
[greptile-blog]: https://www.greptile.com/blog/greptile-update
[gatech-greptile]: https://news.gatech.edu/news/2026/01/05/y-combinator-backing-and-30m-investment-take-startup-greptile-next-level
[fortune-interloom]: https://fortune.com/2026/03/23/interloom-ai-agents-raises-16-million-venture-funding/
[techcrunch-reload]: https://techcrunch.com/2026/02/19/reload-an-ai-employee-agent-management-platform-raises-2-275m-and-launches-an-ai-employee/
[siliconangle]: https://siliconangle.com/2026/02/19/memory-supercycle-ai-funding-frenzy-pouring-fuel/
[collab-memory-paper]: https://arxiv.org/html/2505.18279v1
[mcp-security]: https://cikce.medium.com/8-000-mcp-servers-exposed-the-agentic-ai-security-crisis-of-2026-e8cb45f09115
