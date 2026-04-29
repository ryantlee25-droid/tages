# Tages Competitive Analysis: AI Coding Agent Memory
_Internal CEO + PM Coach Document | 2026-04-19 | Confidential_

**Decision this drives:** Where to invest to create durable differentiation and what POCs to build next.
**Decision owner:** Ryan Lee (CEO), with PM coach input.
**By:** Now. Pre-launch positioning call.

**Framing note on Tages's current state:** Shipped and live, open source, no heavy marketing yet, no paying users at scale. Core features (11 memory types, audit/sharpen/enforce, RBAC, federation, local SQLite cache, MCP server with 56 tools, CLI with 52 commands, Next.js dashboard) are built and running. Self-ratings below are `[USER-SUPPLIED — live product, not yet load-tested in wild]`. Treat differentiators as **real capabilities pending real-world validation**, not vaporware.

---

# PART 1: COMPETITIVE LANDSCAPE

## 1. Executive Summary

- **Category is real and heating up.** ~$66M visible funding into AI agent memory in 18 months (Mem0 $24M, Letta $10M, Interloom $16.5M, Supermemory $2.6M, Reload $2.3M, plus Zep and Cognee undisclosed). SiliconANGLE called it "the memory supercycle" in Feb 2026 [CONFIRMED 2026-02][siliconangle].
- **Your real competitor is Claude Code, not Mem0.** Anthropic shipped auto-memory (`MEMORY.md`, Feb 2026) and auto-dream consolidation (March 2026) natively inside Claude Code [CONFIRMED 2026-02][cc-automemory][CONFIRMED 2026-03][cc-autodream]. Free, pre-installed, zero friction. Any Tages story for Claude-only developers must beat "already there."
- **One genuine whitespace Tages already occupies:** team-shared coding memory with RBAC. Shipped and live. None of Mem0, Zep, Supermemory, Letta, Basic Memory, Cognee lead with shared memory graphs across developers [CONFIRMED 2026-04][mem0-pricing][zep-pricing][supermemory-pricing]. **Defensible advantage today; window is 12-18 months.**
- **Second whitespace:** coding-agent-specific memory types (convention, decision, anti-pattern, lesson) are not first-class anywhere else. Everyone else stores generic facts. Tages's 11 structured types are a real differentiator if you can defend them as the right decomposition.
- **Local-first + team-shared is a rare combination.** Most products pick one. Tages claims both (local SQLite cache + cloud federation). Verify this actually works at load before leaning on it.
- **Three urgent risks:** (1) Anthropic expands auto-memory to include team sharing; (2) Supermemory or Mem0 ship "coding agent" tiers that match Tages's type taxonomy; (3) MCP security incident prompts platform lockdown that kills MCP-first products' install ergonomics.

## 2. Market Structure

**Four layers, each with different competitors:**

| Layer | What it is | Who plays here | Tages fit |
|---|---|---|---|
| **L1 — Native tool memory** | Built into the IDE/CLI | Claude Code, Cursor, Windsurf, Continue | Incumbent threat; not where Tages plays directly |
| **L2 — Memory platform / API** | Hosted or OSS memory service, tool-agnostic | Mem0, Zep/Graphiti, Supermemory, Letta | Tages's direct category |
| **L3 — MCP memory servers** | Reference or hobbyist MCP servers | Anthropic reference, Basic Memory, Cognee, MemPalace, Hmem | Tages lives here too, must differentiate on features |
| **L4 — Adjacent code context** | Code-graph / review tools with memory bolts | Sourcegraph Cody, Greptile | Not direct, but Greptile adding team-review memory is a flanking signal |

**Tages position:** L2 + L3 simultaneously, with opinionated **coding-agent** focus (nobody else in L2 leads on coding agents; L3 products aren't opinionated).

**Unit economics of the category:**
- Mem0 bills by add/retrieval request [CONFIRMED 2026-04][mem0-pricing]
- Zep bills by "credits" (1 credit = 1 Episode ≤350 bytes) [CONFIRMED 2026-04][zep-pricing]
- Supermemory bills by tokens + queries [CONFIRMED 2026-04][supermemory-pricing]
- Letta bills per-agent + tool execution seconds + LLM passthrough [CONFIRMED 2026-04][letta-pricing]
- Tages bills per-seat flat with memory caps [USER-SUPPLIED, from README]

Tages's flat-seat pricing is the simplest to explain to buyers but leaves money on the table at the top end vs usage-metered peers. Acceptable pre-launch.

## 3. Competitive Map

**Two axes that matter for the POC decision:** coding-agent specificity (Y) and team-sharing primitives (X).

```
                     HIGH coding-agent specificity
                              |
                              |     TAGES (target)
                              |     [structured types, audit,
                              |      sharpen, RBAC, federation]
       Supermemory w/plugins  |
       Cognee w/CC plugin     |
       Hmem                   |
       ---------------------- + ----------------------
                              |
       MCP reference server   |     Greptile (code review + team memory)
       Basic Memory           |     Cursor team rules
       Mem0 / OpenMemory      |     Windsurf enterprise memories
       Letta                  |
       Zep / Graphiti         |
                              |
                     LOW coding-agent specificity
       LOW team-sharing   <---+--->   HIGH team-sharing
```

Tages's claimed upper-right is genuinely sparse [CONFIRMED 2026-04 — synthesis from vendor docs]. The question is whether the opinionation (11 types, audit, sharpen) is the right opinionation, or just opinionation for its own sake.

## 4. Geographic View

Category is overwhelmingly US-based: Mem0 (SF/NY YC), Supermemory (SF, ASU founder), Letta (Berkeley), Zep (Bay Area), Greptile (SF). European presence thin. Japan/APAC essentially absent. **No geographic wedge opportunity visible**; category dynamics will be set in US developer communities.

## 5. Market Trends

1. **MCP is the distribution standard.** 8,000+ public MCP servers; 84k stars on `modelcontextprotocol/servers` monorepo [CONFIRMED 2026-04][mcp-servers-gh]. **Implication for Tages:** MCP-first is correct; do not build a proprietary SDK-first path.

2. **Temporal knowledge graphs moved from research to product.** Zep's paper (Jan 2025) and Graphiti OSS made this the architecture to beat for general agent memory [CONFIRMED 2025-01][zep-paper]. Tages's trigram + pgvector + decay hybrid is not a temporal KG — this is a positioning choice to defend, not a weakness if framed correctly.

3. **Local-first memory is now table stakes.** OpenMemory, Basic Memory, Cognee, MemPalace, Tages all lead on it [CONFIRMED 2026-04][openmemory-blog][basic-memory-gh][cognee-home]. Cloud-only products (Mem0 cloud, Zep cloud, Supermemory hosted) have to defend.

4. **Coding agent memory is bifurcating from general agent memory.** Supermemory ships Claude Code/Cursor/OpenCode/OpenClaw plugins [CONFIRMED 2026-04][supermemory-pricing]. Mem0 branded "OpenMemory for coding agents." Cognee has a Claude Code plugin with hooks. **Every L2 player is reaching into coding.** Tages's advantage is being native to it, but the window is shrinking.

5. **Native incumbents (Claude Code, Cursor, Windsurf) are adding memory, still tool-locked.** Cursor Memories are Cursor-only. Windsurf Cascade learns codebase patterns but they're not exportable. Claude Code CLAUDE.md + MEMORY.md are Claude-only with a 200-line cap [CONFIRMED 2026-02][cc-automemory]. **Cross-tool portability is Tages's single clearest advantage over incumbents.**

6. **Shared multi-user memory is early.** Collaborative Memory arXiv (May 2025) and Reload ($2.3M Feb 2026) are the early entries [CONFIRMED 2025-05][collab-memory-paper][CONFIRMED 2026-02][techcrunch-reload]. Category is not won.

7. **MCP security is a latent crisis.** 8,000+ exposed servers, hundreds bound to 0.0.0.0 by default, 39% of companies reported AI agents accessing unintended systems in 2025 [CONFIRMED 2025-2026][mcp-security] [DOMAIN REVIEW NEEDED]. **An incident is a matter of time.** Vendors with a strong security story gain when it happens; vendors who look careless lose.

---

# PART 2: COMPETITIVE ANALYSIS

## 6. Core Competitor Profiles

### 6.1 Claude Code (Anthropic) — The Incumbent

Not a startup. Bundled in Claude Pro/Max/Team/Enterprise subscriptions [UNVERIFIED — exact tier breakdown not re-checked this pass]. Free for every Claude developer already in Tages's target market.

**Table stakes (they match you):**
- MCP server consumption: yes [CONFIRMED 2026-04][cc-docs]
- Persistent memory across sessions: yes (MEMORY.md + auto-memory, Feb 2026) [CONFIRMED 2026-02][cc-automemory]
- Memory consolidation / dedup: yes (auto-dream, March 2026) [CONFIRMED 2026-03][cc-autodream]
- Local-first memory files: yes (MEMORY.md + CLAUDE.md are local) [CONFIRMED 2026-04][cc-docs]
- Git-shareable memory: yes (CLAUDE.md checked into repo)

**Differentiators (where they genuinely beat Tages today):**
- **Zero install friction.** Bundled in the CLI that your target users already run.
  - Proof: Claude Code plugin marketplace adoption rate; CLAUDE.md is de facto standard; Tages's own README lists "Install: One line (`claude mcp add`)" as the best Tages can do, which is still a second install [CONFIRMED 2026-04 — Tages README:24].
- **Trust / security by default.** First-party Anthropic binary; no supply-chain question.
  - Proof: no MCP server vulnerability can be blamed on first-party Claude Code; every third-party MCP vendor must defend against the "rogue MCP" narrative [CONFIRMED 2026][mcp-security].
- **Auto-dream memory hygiene is closest in spirit to Tages's "audit/sharpen" pitch.**
  - Proof: auto-dream reorganizes topics, converts relative dates to absolute, deletes contradicted facts [CONFIRMED 2026-03][cc-autodream]. This overlaps Tages's `tages sharpen` and `tages audit` commands in function.

**Threats in next 12 months:**
- **Anthropic adds team-shared memory.** High likelihood given auto-memory → auto-dream cadence. Would eliminate Tages's single strongest positioning angle (team memory). **Risk: existential. Timing signal: any announcement of "Claude Code team memory" or "shared CLAUDE.md" at a Dev Day keynote.**
- **Anthropic raises the 200-line MEMORY.md cap and adds structure.** Would blunt Tages's "structured types" pitch for Claude users. **Risk: high. Timing signal: version note on v2.2+ memory limits.**
- **Skills ecosystem eats the Tages plugin surface.** SKILL.md with frontmatter is a plugin primitive; team sharing is "check into Git." **Risk: medium. Timing signal: Anthropic-authored team-scoped skills.**

### 6.2 Mem0 — The OSS Leader

53.5k GitHub stars, $24M funded (Seed + Series A, Oct 2025, YC/Peak XV/Basis Set/GitHub Fund) [CONFIRMED 2025-10][mem0-series-a][techcrunch-mem0]. 186M API calls Q3 2025. AWS's exclusive memory provider for its Agent SDK.

**Table stakes:**
- MCP server: yes (OpenMemory MCP, local-first) [CONFIRMED 2026-04][openmemory-blog]
- Structured fact extraction: yes (v3 ADD-only) [CONFIRMED 2026-04][mem0-gh]
- OSS core + hosted cloud: yes (Apache-2.0) [CONFIRMED 2026-04][mem0-gh]
- Multi-level memory (User/Session/Agent): yes
- Coding agent plugins: partial, branded "OpenMemory for coding agents" [CONFIRMED 2026-04][mem0-gh]

**Differentiators:**
- **Ecosystem gravity.** CrewAI, Langflow, Flowise native integrations; AWS partnership; 14M npm downloads.
  - Proof: [CONFIRMED 2025-10 — mem0-series-a]. Tages starts at zero downloads.
- **Enterprise readiness.** SSO, HIPAA BAA, on-prem. Tages PLAN.md shows SSO gated but not marketed pre-launch [CONFIRMED 2026-04 — Tages PLAN.md:17].
  - Proof: Mem0 enterprise tier [CONFIRMED 2026-04][mem0-pricing].
- **Funding runway to outspend for category leadership.**
  - Proof: $24M vs. Tages bootstrapped.

**Threats in next 12 months:**
- **Ship a "Mem0 Code" SKU.** They've already branded "OpenMemory for coding agents"; building out structured coding types (convention/decision/anti-pattern) is days of work for a funded team. **Risk: high. Timing signal: Mem0 launches a coding-specific vertical or blog series in Q2/Q3 2026.**
- **Out-distribute Tages in Claude/Cursor plugin marketplaces.** Mem0's ecosystem muscle means plugin installs land first. **Risk: medium.**

**Weak spots Tages can attack:**
- Pricing cliff: $19 → $249/mo with no middle tier [CONFIRMED 2026-04][mem0-pricing]. Tages's $14 Pro / $19 Team ladder is easier to swallow.
- Not coding-agent-native; plugin directory is retrofitted [CONFIRMED 2026-04 — `.claude-plugin`/`.cursor-plugin` folders added, not led with][mem0-gh].
- Cloud-first; OpenMemory is a newer local-first path. Stack is Docker + Postgres + Qdrant — heavy for a solo dev.

### 6.3 Zep / Graphiti — The Research Leader

Zep Cloud + Graphiti OSS (Apache-2.0, 25.1k stars). Temporal knowledge graph, DMR benchmark 94.8% vs MemGPT 93.4% [CONFIRMED 2025-01][zep-paper]. No 2025 funding announcement surfaced [UNVERIFIED — Zep].

**Table stakes:**
- MCP server: yes (Graphiti MCP v1.0.2, March 2026) [CONFIRMED 2026-03][graphiti-gh]
- Open-source core: yes (Apache-2.0)
- Hosted cloud + BYOC: yes [CONFIRMED 2026-04][zep-pricing]
- Enterprise SOC 2 / HIPAA: claimed [CONFIRMED 2026-04][zep-pricing] [DOMAIN REVIEW NEEDED]

**Differentiators:**
- **Temporal knowledge graph with fact validity windows.** Non-lossy updates — old facts invalidated, not deleted.
  - Proof: [CONFIRMED 2026-04][graphiti-gh]. Tages does not have this primitive.
- **Publishable benchmark leadership.** DMR 94.8%, 18.5% accuracy gain, 90% latency cut vs baselines.
  - Proof: [CONFIRMED 2025-01][zep-paper] [DOMAIN REVIEW NEEDED — benchmark methodology].
- **Enterprise-ready deployment options.** BYOK/BYOM/BYOC.
  - Proof: [CONFIRMED 2026-04][zep-pricing].

**Threats in next 12 months:**
- **Add coding-specific schemas on top of Graphiti.** Turning generic entity/relation into `convention→file`, `decision→commit` is schema work, not engine work. **Risk: medium. Timing signal: a "code agent template" or schema pack in the Graphiti repo.**
- **Windows of vulnerability:** they have to market "buy a hosted graph service" to developers who already have SQLite cached locally. Tages's "local-first + MCP" is lower-friction than Zep's "pip install + Neo4j" self-hosted story.

**Weak spots Tages can attack:**
- Self-hosted Graphiti requires Neo4j (or Kuzu/FalkorDB/Neptune) [CONFIRMED 2026-04][graphiti-gh]. Heavy infra for a dev team that wants memory.
- Credit-based cloud pricing is opaque vs Tages's flat seat model.
- Not coding-agent-first; positioning is "general agent memory."

### 6.4 Supermemory — The Scrappy Challenger

$2.6M seed Oct 2025 (Susa, Browder, SF1.vc + Cloudflare Knecht, Jeff Dean, Logan Kilpatrick, David Cramer). 19-year-old founder (Dhravya Shah, ASU). MIT license, 22k stars. Named customers: Cluely, Montra, Scira, Rube (Composio), Rets [CONFIRMED 2025-10][techcrunch-supermemory].

**Table stakes:**
- MCP server: yes (`npx -y install-mcp`) [CONFIRMED 2026-04][supermemory-gh]
- Coding agent plugins: yes (Claude Code, Cursor, OpenCode, OpenClaw) — **ahead of Tages on plugin breadth** [CONFIRMED 2026-04][supermemory-pricing]
- Self-hostable core: yes (MIT) [CONFIRMED 2026-04][supermemory-gh]
- Multi-modal extraction: yes (PDF, images, audio, video) — **Tages does not have this**

**Differentiators:**
- **MIT license + Cloudflare edge infra.** Most permissive license in category; lowest-latency cloud serving.
  - Proof: [CONFIRMED 2026-04][supermemory-pricing], Cloudflare Knecht on cap table.
- **Coding agent plugin breadth.** Ships 4 editor plugins today; Tages ships Claude Code plugin only.
  - Proof: [CONFIRMED 2026-04][supermemory-pricing], Tages README shows only Claude Code plugin.
- **Celebrity capital signals.** Jeff Dean + CF leadership invested individually; disproportionate enterprise credibility for a 19-year-old's company.

**Threats in next 12 months:**
- **Ship a coding-agent SKU with structured types.** They already have the plugin surface; adding typed memory is a straightforward product move. **Risk: high. Timing signal: "Supermemory for Dev Teams" launch or coding-specific schema docs.**
- **Take the "team memory" category naming.** They have unlimited users on every plan; if they rebrand "shared universal memory," they could own the team positioning before Tages launches. **Risk: medium. Timing signal: a marketing refresh that emphasizes teams over builders.**

**Weak spots Tages can attack:**
- Knowledge graph implementation thin in public docs [UNVERIFIED]. Claims vs reality unknown.
- 19-year-old solo founder + small team = execution/burnout risk at enterprise scale.
- Not coding-agent-first; plugins are peripheral to "Universal Memory API" framing.

### 6.5 Letta (formerly MemGPT) — The Academic Pedigree

$10M seed Sept 2024 at $70M post-money, Felicis led [CONFIRMED 2024-09][traded-letta]. Still at Seed as of April 2026 [CONFIRMED 2026-04][pitchbook-letta] — 19 months without a Series A is slower than category.

**Table stakes:**
- OSS core: yes (Apache-2.0, 22.2k stars) [CONFIRMED 2026-04][letta-gh]
- Cloud API: yes [CONFIRMED 2026-04][letta-pricing]
- Local desktop: yes (Letta Code CLI + macOS app) [CONFIRMED 2026-04][letta-home]
- SDKs: Python, TS, Rust

**Differentiators:**
- **MemGPT architecture provenance.** OS-inspired three-tier (Core/Recall/Archival) memory is foundational to the field.
  - Proof: MemGPT paper citations; first-mover pedigree [CONFIRMED 2024-09][techcrunch-letta].
- **Editable memory blocks ("human" + "persona") visible and user-steerable.**
  - Proof: [CONFIRMED 2026-04][letta-gh]. Closest to Tages's "memory is a managed artifact" framing — they already do this conceptually.

**Threats in next 12 months:**
- **Slow momentum. 19 months at Seed, $1.4M revenue [UNVERIFIED — Getlatka third-party only] [DOMAIN REVIEW NEEDED — revenue claim source reliability]. Possibility they get outrun; less a direct threat to Tages than a lesson (don't repeat their GTM).**

**Weak spots Tages can attack:**
- No prominent MCP story [UNVERIFIED — would confirm via Letta docs].
- No team-shared memory primitives.
- Lost DMR benchmark leadership to Zep (93.4% vs 94.8%) [CONFIRMED 2025-01][zep-paper].

## 7. Adjacent / Emerging Competitors

- **Cognee** — graph-vector hybrid with 70+ named customers (Bayer, U. Wyoming, dltHub). >1M pipelines/month. Has Claude Code plugin with hooks [CONFIRMED 2026-04][cognee-home][cognee-gh]. Real usage, not just stars.
- **Basic Memory** — AGPL-3.0, markdown-on-disk, Obsidian-compatible. 2.9k stars. Closest philosophical sibling to Tages's "memory as managed artifact" pitch [CONFIRMED 2026-04][basic-memory-gh]. **AGPL means enterprises can't embed — a defensive wall for Tages if it stays MIT.** [DOMAIN REVIEW NEEDED — license implications for commercial users].
- **MemPalace** — viral April 2026 launch (SQLite + ChromaDB, 19 MCP tools, MIT). Strong LongMemEval claims [CONFIRMED 2026-04][mempalace-blog][UNVERIFIED — benchmark].
- **Hmem** — Feb 2026 Show HN, "persistent hierarchical memory for AI coding agents" [CONFIRMED 2026-02][hn-hmem]. Closest framing collision with Tages; small today but watch it.
- **Cursor** — Memories + Rules, tool-locked. $20 Pro / $40 Teams. Cursor-only distribution is what protects Tages cross-tool pitch [CONFIRMED 2026-04][cursor-pricing].
- **Windsurf** — Cascade memory, post-Cognition $250M acquisition (Dec 2025). Product-integration turmoil is a market opportunity [CONFIRMED 2025-12][techfunding-windsurf].
- **Continue.dev** — OSS rules + MCP, no structured memory. Free. Adjacent, not competitive on the memory axis [CONFIRMED 2026-04][continue-gh].
- **Greptile** — AI code review with long-term review memory ($30/user/mo, $30M raised) [CONFIRMED 2024][gatech-greptile][CONFIRMED 2026][greptile-blog]. Flanking signal: they're adding team memory inside a review tool, which is a different wedge than Tages but competes for the same "team learning" budget.

## 8. Capability Deltas (Narrative)

For the POC decision, these are the axes that matter. Tages cells are `[USER-SUPPLIED — pre-launch]` unless otherwise noted — they derive from the README and PLAN.md and have not been independently load-tested.

**Axis 1: Coding-agent-specific memory types**
- Tages: 11 structured types (convention, decision, architecture, lesson, anti-pattern, pattern, entity, execution, operational, environment, preference) [USER-SUPPLIED — Tages README:41-50]
- Mem0: generic extraction, no type system [CONFIRMED 2026-04][mem0-gh]
- Zep/Graphiti: generic entity/relation, not coding-opinionated [CONFIRMED 2026-04][graphiti-gh]
- Supermemory: generic memory graph [CONFIRMED 2026-04][supermemory-gh]
- Basic Memory: WikiLink-style relations, no coding types [CONFIRMED 2026-04][basic-memory-gh]
- Cognee: ontology-driven but not coding-specific [CONFIRMED 2026-04][cognee-gh]
- Claude Code: plain markdown, no types [CONFIRMED 2026-04][cc-docs]
- **Verdict:** Tages uncontested on opinionated coding types. **Biggest claimed differentiator.** Needs validation: do developers want 11 types or find it overwhelming? POC opportunity.

**Axis 2: Team-shared memory with RBAC**
- Tages: RBAC (Owner/Admin/Member), federation, row-level security, encryption at rest — **shipped and live** [USER-SUPPLIED — confirmed live by founder 2026-04-19][Tages README:123-131]
- Mem0: enterprise SSO + multi-project, no docs on team memory graph [UNVERIFIED][mem0-pricing]
- Zep: projects (5/10/unlimited by tier), no explicit team RBAC docs [UNVERIFIED][zep-pricing]
- Supermemory: unlimited users, Enterprise SSO, no RBAC docs surfaced [UNVERIFIED][supermemory-pricing]
- Letta: no team memory primitives [UNVERIFIED]
- Basic Memory: none
- Claude Code: Git-checked CLAUDE.md only, not a service
- **Verdict:** Tages is ahead today. **This is the single most defensible whitespace and it's already built.** Next step is proof, not construction: get 3-5 real teams using federated memory and document what breaks, what delights, and what's missing.

**Axis 3: Quality control (audit, sharpen, score)**
- Tages: `audit`, `sharpen`, `enforce`, scoring [USER-SUPPLIED — Tages README:88-90]
- Claude Code: `auto-dream` consolidates memory automatically [CONFIRMED 2026-03][cc-autodream]
- Zep/Graphiti: non-lossy temporal invalidation (adjacent functionality)
- Mem0 / Supermemory / Letta / Basic Memory / Cognee: no explicit quality-control CLIs surfaced
- **Verdict:** Tages has the richest quality-control surface in the category today, but **auto-dream overlaps this for Claude users**. Need to show Tages quality primitives beat auto-dream measurably, or this differentiator dilutes.

**Axis 4: Install friction**
- Claude Code: zero (bundled)
- Cursor: zero (in editor)
- Tages: one line (`claude mcp add tages`) [USER-SUPPLIED]
- Supermemory: one line (`npx install-mcp`) [CONFIRMED 2026-04][supermemory-pricing]
- Basic Memory: `uv tool install` or Homebrew [CONFIRMED 2026-04][basic-memory-gh]
- Mem0: `pip install` + OpenMemory requires Docker + Postgres + Qdrant [CONFIRMED 2026-04][openmemory-blog]
- Zep: `pip install` + Neo4j (or Kuzu/FalkorDB/Neptune) [CONFIRMED 2026-04][graphiti-gh]
- **Verdict:** Tages competitive on install, but Claude Code and Cursor are unbeatable on-tool. Tages's angle is "one-line install matches the best third-party options, and runs fully offline."

**Axis 5: Cross-tool portability**
- Tages: Claude Code + Cursor + Codex + Gemini (anything MCP-speaking) [USER-SUPPLIED — Tages README:79]
- Supermemory: Claude Code + Cursor + OpenCode + OpenClaw (4 plugins) [CONFIRMED 2026-04][supermemory-pricing]
- Mem0: MCP + SDK, tool-agnostic
- Claude Code: Claude-only
- Cursor: Cursor-only
- Windsurf: Windsurf-only
- **Verdict:** Tages's strongest moat vs native incumbents. Second-tier vs L2 platforms.

**Axis 6: Local-first + offline**
- Tages: SQLite cache, <10ms, works offline [USER-SUPPLIED]
- Mem0 OpenMemory: local-first but Docker-heavy
- Basic Memory: markdown files on disk, fully offline
- Letta Code: runs fully locally
- Zep cloud: no (cloud-only); Graphiti self-hosted yes but infra-heavy
- Claude Code: memory files are local, but inference requires Anthropic API
- **Verdict:** Tages's lightweight local footprint is competitive with Basic Memory and better than Mem0/Zep.

**Axis 7: Benchmarks / public proof**
- Zep: DMR 94.8%, peer-reviewed paper [CONFIRMED 2025-01][zep-paper]
- Letta: MemGPT paper legacy
- MemPalace: LongMemEval claims [UNVERIFIED]
- Tages: internal benchmarks "9.1/10 vs 2.8/10" cited in README [USER-SUPPLIED — Tages README:97] — **self-reported, not peer-reviewed, no methodology published**
- Mem0, Supermemory, Basic Memory, Cognee: no published third-party benchmarks surfaced
- **Verdict:** Tages's benchmark claim is a marketing liability until reproducible. Either strip or validate. POC opportunity.

**Axis 8: License**
- MIT: Supermemory, MemPalace, Tages [CONFIRMED 2026-04 — Tages README:1]
- Apache-2.0: Mem0, Zep/Graphiti, Letta, Continue
- AGPL-3.0: Basic Memory — **commercial blocker for many enterprises** [CONFIRMED 2026-04][basic-memory-gh]
- Closed: Claude Code, Cursor, Windsurf, Greptile
- **Verdict:** Tages on MIT is as permissive as the field. Durable if held.

## 9. Whitespace & Opportunity Map

- `[Company advantage]` **Team-shared coding memory with RBAC — shipped, live today.** Nobody in L2/L3 leads on it. Closest entrants (Reload, Interloom) are general "AI employee" not coding-specific. **Defensible for 12-18 months. The job now is marketing, not building.**
- `[Company advantage]` **Coding-agent-specific memory types.** The 11-type taxonomy is opinionated in a way no competitor has been. Defensibility depends on whether the taxonomy is "right" — open question for POC validation.
- `[Company advantage]` **Quality control primitives (audit, sharpen, enforce).** Unique surface today. Auto-dream overlaps partially but only for Claude Code users.
- `[Uncontested]` **Git-hook / CI integration for codebase memory updates.** Tages mentions git hooks + CI/CD [USER-SUPPLIED — Tages README:85]. No competitor leads on this. **Clear POC target.**
- `[Uncontested]` **Cross-agent memory consistency audit.** "When three developers are using agents on the same codebase, audit what memory state each agent has and detect drift." Nobody does this. It's the natural extension of the "memory as team practice" pitch. **Strong POC candidate.**
- `[Uncontested]` **Provenance: show which agent session wrote which memory and when.** Combine with audit logs for a real "memory governance" story enterprises will pay for.
- `[Competitor risk]` **Multi-modal memory (images, PDFs, audio).** Supermemory leads here, free on every tier [CONFIRMED 2026-04][supermemory-pricing]. Not core to coding but architectural docs often have diagrams. **Might be worth a small POC, otherwise concede.**
- `[Competitor risk]` **MCP marketplace presence.** Supermemory ships 4 plugins vs Tages's 1. Pure distribution work. **Fix, not a strategic question.**

## 10. Strategic Implications

### Attack — where to hit competitors

- **Attack Claude Code on team sharing.** Their CLAUDE.md is single-machine/single-user; auto-memory is single-machine. Tages's message: "You already use Claude Code. Now your team shares what Claude learned." Positions Tages as complement, not replacement. **Consequence of inaction:** Anthropic ships shared memory in a release note; Tages becomes redundant overnight. **Horizon:** 6 months.
- **Attack Mem0 on coding specificity.** Mem0's "OpenMemory for coding agents" is a rebrand, not a product. Tages leads with coding-native types. Target: Mem0-using teams running Claude Code/Cursor. **Timing signal:** any Mem0 blog hinting at a "coding vertical" — move before they ship. **Horizon:** 3 months.
- **Attack Zep on infra cost.** Zep self-hosted requires Neo4j; Tages self-hosted requires only Postgres (via Supabase). Message: "Graphiti's temporal KG is beautiful. Your dev team will never operate Neo4j." **Horizon:** ongoing.

### Create / lead — define a category

- **Define "Team Coding Memory" as a named category.** Own the phrase. Publish the taxonomy (11 types + audit/sharpen/enforce + git hooks + CI) as an open standard. Others copying the name is how you know you led.
- **Lead on "memory governance."** No one has a story for provenance, audit logs, and cross-agent consistency. Build it before Anthropic does. Defensible because it requires a team feature set, not just a memory store.
- **Lead on reproducible coding-memory benchmarks.** Publish the "9.1/10 vs 2.8/10" evaluation methodology + dataset so others can run it. Reproducible benchmarks = leadership positioning (see Zep's DMR). Don't leave it as a README stat.

### Over-invest — disproportionate return on existing planned strengths

- **Over-invest in marketing the team/RBAC/federation surface you already shipped.** The feature is live; the gap is awareness. Nobody else in the category leads on team memory, so every blog post, demo video, and Show HN should lead with "three developers, one shared memory, with audit logs." This is the highest-leverage messaging work pre-launch push.
- **Over-invest in `tages brief` (cached context for system-prompt injection).** It's the natural "run this every session" command that creates stickiness. Make it fast, make it trustworthy, make it the thing teams run in CI.
- **Over-invest in zero-config project detection.** Tages already auto-detects via `.tages/config.json`, git remote, directory name [USER-SUPPLIED — Tages README:59-65]. Push this further — make "install + works instantly on any repo" the install experience everyone copies.

### Defend / fix — gaps on confirmed roadmap

- **Fix: Ship benchmark methodology.** The "9.1/10 vs 2.8/10" README claim is a credibility liability until reproducible. Publish dataset + eval harness or strip the claim. **Consequence of inaction:** first reviewer who tries to reproduce and fails writes the HN comment that sticks. **Horizon:** pre-launch.
- **Fix: Expand plugin coverage.** Cursor and Codex plugins before Supermemory fills that slot. Tages README says "Works With" Claude Code, Cursor, Codex, Gemini, but plugin install lines only show Claude Code [CONFIRMED 2026-04 — Tages README:26, 79]. **Horizon:** 60 days.
- **Fix: Security story.** MCP security is the next incident waiting to happen. Tages has encryption at rest + RLS + secret detection claimed [USER-SUPPLIED — Tages README:123-131]. Needs a public SECURITY.md-caliber write-up, ideally with third-party review. **Horizon:** pre-launch.
- **Fix: Document the 1-project Free tier cap clearly.** PLAN.md flags this [CONFIRMED 2026-04 — PLAN.md:16]. Getting this wrong pre-launch creates trust debt.

### Don't-do — explicit restraint

- **Don't build a temporal knowledge graph to compete with Zep.** That's a research lift that doesn't differentiate you vs Anthropic (your real competitor). Let Zep win that axis; position Tages as "opinionated coding memory," not "best retrieval engine."
- **Don't chase multi-modal (images, audio, video) memory.** Supermemory has the lead. Coding agents don't need it as a day-one requirement. Re-evaluate in 12 months.
- **Don't ship SSO marketing pre-launch.** PLAN.md already decided this [CONFIRMED 2026-04 — PLAN.md:17]. Correct call; don't relitigate.
- **Don't bill per request.** Mem0's $19 → $249 cliff and Zep's credit math are the reasons developers get confused buying memory. Hold the flat-seat line.
- **Don't position as "Mem0 alternative."** Positions you as derivative in a category where leaders get funded. Position as "team memory for coding agents," a category Tages names.

---

# APPENDIX

## A. Validation Plan

Each `[INFERRED]` and `[UNVERIFIED]` claim from this doc, with owner and method:

| # | Claim | Tag | Validation method | Owner | Due |
|---|---|---|---|---|---|
| 1 | Tages 11-type taxonomy is the right decomposition | [USER-SUPPLIED] | Run 10 user interviews with Claude Code/Cursor teams — ask them to categorize real decisions and see if the 11 types cover >85% of real memories without forced-fit | Ryan | 30 days |
| 2 | Tages RBAC + federation holds up with real teams (shipped, not yet battle-tested) | [USER-SUPPLIED — live] | Recruit 3-5 design-partner teams (Claude Code / Cursor shops); instrument federation + audit-log usage; collect breakage reports over 30 days | Ryan | 60 days |
| 3 | "9.1/10 vs 2.8/10" benchmark reproduces | [USER-SUPPLIED] | Open-source eval harness + dataset; run against Claude Code + Cursor + Supermemory + Mem0; publish notebook | Ryan | 60 days |
| 4 | Claude Code does NOT have team-shared memory by launch | [UNVERIFIED — Anthropic roadmap] | Monitor Anthropic changelog + Dev Day announcements weekly | Ryan | Ongoing |
| 5 | Zep does NOT add coding-agent schema pack | [UNVERIFIED] | Monitor Graphiti repo + Zep blog weekly | Ryan | Ongoing |
| 6 | Mem0 does NOT ship "Mem0 Code" SKU | [UNVERIFIED] | Monitor Mem0 blog + pricing page weekly | Ryan | Ongoing |
| 7 | Supermemory doesn't pivot to "team memory" positioning | [UNVERIFIED] | Monitor supermemory.ai homepage + TechCrunch quarterly | Ryan | Ongoing |
| 8 | Zep SOC 2 Type II current and HIPAA BAA available | [DOMAIN REVIEW NEEDED] | Request Zep audit letter from sales; compare to public claim | PM coach | Reference only |
| 9 | Zep DMR benchmark methodology is sound | [DOMAIN REVIEW NEEDED] | Read zep-paper Section 4 + compare to LongMemEval baselines | PM coach / ML friend | Reference only |
| 10 | Letta $1.4M revenue figure | [DOMAIN REVIEW NEEDED — Getlatka source] | Verify via primary source or treat as unreliable | Ryan | Reference only |
| 11 | Zep 2025 funding round exists / doesn't | [UNVERIFIED] | Crunchbase/PitchBook lookup | Ryan | 14 days |
| 12 | MCP security incident likelihood within 12 months | [DOMAIN REVIEW NEEDED] | Monitor mcp-security advisories; build Tages security posture independent of timing | Ryan | Ongoing |

## B. Sources & Confidence Notes

- High-confidence sources (primary): vendor pricing pages, GitHub repos, TechCrunch funding announcements, arXiv papers.
- Medium-confidence: Medium posts, third-party funding trackers (Getlatka, traded.co), blog analyses.
- Low-confidence / flagged: any claim about private revenue, undisclosed funding, future roadmap.
- Stale-risk: pricing pages change often; re-verify pricing before publishing any comparison publicly. PLAN.md:18 notes Tages's own marketing had stale competitor pricing with no "as of" date.

Most cited sources: vendor pricing pages (`*-pricing`), vendor GitHub repos (`*-gh`). Cross-checked against TechCrunch, Fortune, SiliconANGLE for funding events.

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
[cursor-pricing]: https://cursor.com/pricing
[windsurf-pricing]: https://www.verdent.ai/guides/windsurf-pricing-2026
[devops-windsurf]: https://devops.com/openai-acquires-windsurf-for-3-billion-2/
[techfunding-windsurf]: https://techfundingnews.com/how-windsurf-was-split-between-openai-google-and-cognition-in-a-billion-dollar-acquisition-deal/
[continue-gh]: https://github.com/continuedev/continue
[cc-docs]: https://docs.anthropic.com/en/docs/claude-code/memory
[cc-automemory]: https://medium.com/@joe.njenga/anthropic-just-added-auto-memory-to-claude-code-memory-md-i-tested-it-0ab8422754d2
[cc-autodream]: https://antoniocortes.com/en/2026/03/30/auto-memory-and-auto-dream-how-claude-code-learns-and-consolidates-its-memory/
[greptile-pricing]: https://www.greptile.com/pricing
[greptile-blog]: https://www.greptile.com/blog/greptile-update
[gatech-greptile]: https://news.gatech.edu/news/2026/01/05/y-combinator-backing-and-30m-investment-take-startup-greptile-next-level
[fortune-interloom]: https://fortune.com/2026/03/23/interloom-ai-agents-raises-16-million-venture-funding/
[techcrunch-reload]: https://techcrunch.com/2026/02/19/reload-an-ai-employee-agent-management-platform-raises-2-275m-and-launches-an-ai-employee/
[siliconangle]: https://siliconangle.com/2026/02/19/memory-supercycle-ai-funding-frenzy-pouring-fuel/
[collab-memory-paper]: https://arxiv.org/html/2505.18279v1
[mcp-security]: https://cikce.medium.com/8-000-mcp-servers-exposed-the-agentic-ai-security-crisis-of-2026-e8cb45f09115
