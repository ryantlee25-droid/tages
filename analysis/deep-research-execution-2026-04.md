# Research: Tages execution de-risking for 4 differentiation bets
_Date: 2026-04-20 | Depth: Deep | Feeds: Blue PLAN.md_

**Decision:** How to execute on the 4 bets in `positioning.md` (A: Memory Governance, B: AGENTS.md-native, C: Reproducible coding-memory benchmark, D: Cross-tool plugin parity) over the next 12–18 months.
**Decision owner:** Ryan Lee (CEO)
**By:** Blue PLAN.md tonight; first deliverables within 30–90 days.
**What would flip the call:** `[USER-SUPPLIED]` "If I have no differentiator to stand on" — the research did NOT flip this; it sharpened the four bets and narrowed which are defensible. Specifically, Bet A faces more competition than positioning assumed; Bet C has a partner-able harness already; Bet D is pure config-file work; Bet B has the biggest genuine whitespace.

---

## Key Findings

1. **Mem0 Enterprise is further along on compliance than the positioning assumed.** SOC 2 Type I certified, HIPAA-ready, SOC 2 Type II in progress, zero-trust + BYOK encryption, "audit-ready logs" shipped. [CONFIRMED 2026-04 — [mem0-security]] Tages cannot win on "we have audit logs" alone; must differentiate on **field-level provenance + cross-agent consistency + specificity** (published retention, published field schema, published export format).

2. **Every mainstream memory framework lacks provenance tracking; this is a validated enterprise gap.** "Current AI agent memory frameworks don't track where data underlying a stored memory came from or its transformations, making the provenance of context invisible. Audit-traceable AI reasoning requires lineage, but none of the mainstream frameworks provide it." [CONFIRMED 2026-04 — [atlan-frameworks]] Tages's agent+session+user provenance model is genuinely uncontested.

3. **Stompy is the only open, reproducible coding-memory benchmark in existence; it is MIT-licensed, MCP-based, single-maintainer, and paused post-Phase 3.** Fork-or-partner beats rebuild. Architecture assumes MCP providers; Tages can be added as a condition with a new `.mcp.json` config and a Tages-condition prompts directory. [CONFIRMED 2026-04 — [stompy-gh]]

4. **"The first published benchmark of AI memory in coding agents" shows 22–32% cost savings and 28–40% fewer turns on complex tasks, effect scales with codebase complexity, and Stompy's quality ceiling is 67/75 vs a hand-curated file at 68/75.** [CONFIRMED 2026-03 — [stompy-medium]] Implication: Tages's benchmark narrative should measure **cost + turns + quality at fixed task complexity**, not just accuracy. "Beats hand-curated context docs on efficiency while matching on quality" is a winnable story.

5. **MCP install across Claude Code / Cursor / Codex / Gemini is effectively standardized.** All four use a JSON or TOML config with the same `mcpServers` shape plus `command` + `args` + `env`. [CONFIRMED 2026-04 — [cursor-mcp-docs][codex-mcp-docs][gemini-mcp-docs]] Tages's cross-tool plugin parity is **config-file generation + docs work**, not engineering. Estimate: under 1 week engineering, dominated by per-tool install docs and one-click install links.

6. **AGENTS.md tooling is a near-empty category.** No linters, validators, generators, or governance surfaces exist for AGENTS.md as of 2026-04-19. GitHub blog analyzed 2,500 repos and named 6 canonical sections (Commands, Testing, Project structure, Code style, Git workflow, Boundaries) + three-tier Always/Ask/Never pattern, but no tool writes or audits them. [CONFIRMED 2026-04 — [github-agents-md][agents-md-gh]] Bet B's whitespace is larger than positioning assumed.

7. **Memory drift detection is an open research problem with a 12-dimensional metric published.** Agent Stability Index (ASI) covers semantic drift, coordination drift, behavioral drift. "Detecting when high-relevance memories become stale is an open research problem." [CONFIRMED 2026-01 — [agent-drift-arxiv]] Tages can productize ASI for the multi-agent coding-team case (the `cross-agent consistency audit` Bet A deliverable).

8. **Microsoft Agent Governance Toolkit shipped April 2026.** Open-source runtime security for AI agents; 10 OWASP agentic-AI risks; sub-millisecond policy enforcement. [CONFIRMED 2026-04 — [ms-agent-gov]] This is a threat: Microsoft will commoditize governance primitives. Tages must differentiate on **memory-specific** governance (provenance, drift, cross-agent consistency) not agent-runtime governance.

9. **Zero community signal on Tages.** No HN, Reddit, or prominent dev.to mentions surfaced. [CONFIRMED 2026-04 — search returned no Tages-specific results] Launch will be cold. Implication: the 4 bets must each produce a launch-worthy artifact, not just an internal capability.

10. **Pricing signal for governance-layer dev tools:** Snyk $25–$98/dev/mo, Chainguard enterprise custom. [CONFIRMED 2026-04 — [snyk-vendr]] Tages's current $14 Pro / $19 Team is priced for adoption, not enterprise. Memory Governance SKU can credibly price at $50–$99/seat/mo with published audit + compliance posture.

11. **Claude Code Skills ecosystem supports team/org provisioning already.** Team/Enterprise plans can provision skills organization-wide; skill sharing peer-to-peer (off by default). [CONFIRMED 2026-04 — [cc-skills][cc-skills-mkt]] This is partially competitive with Tages federation, but **skills are static instruction bundles, Tages federation is learned-memory propagation with audit**. Different mechanism.

---

## Research Agenda

### Bet A — Memory Governance SKU

#### Q1. Enterprise audit log requirements (priority)

- Audit trails must capture **who, what, when, where, why** for every agent action, with precise timestamps. [CONFIRMED 2026-04 — [teleport-soc2]]
- Retention: 90 days minimum to 7 years depending on regulatory regime. [CONFIRMED 2026-04 — [agility-enterprise]]
- **Tamper-proof via cryptographic signing** is a baseline requirement, not a differentiator. [CONFIRMED 2026-04 — [agility-enterprise]]
- SOC 2 is de facto required for B2B AI products; enterprise customers will not sign contracts without it. [CONFIRMED 2026-04 — [blaxel-soc2]]
- Critical compliance fields for memory systems: conversation/memory retention periods, access controls on content, deletion processes for erasure requests, handling of sensitive data (health, financial, PII). [CONFIRMED 2026-04 — [blaxel-soc2]]
- 2026 trend: real-time operational visibility, continuous monitoring, third-party risk scoring + periodic reassessment. [CONFIRMED 2026-04 — [certpro-soc2]]
- **Implication for Tages:** Publish a Tages Audit Log schema doc with every field definition, retention policy, export format (JSON + CSV), and erasure procedure. Cryptographic signing is baseline, not marketing.

#### Q2. Pricing benchmarks

- **Snyk:** $25/mo per contributing developer (Team); list $52–$98/dev/mo for bundles; Enterprise custom. [CONFIRMED 2026-04 — [snyk-vendr][snyk-pulse]]
- **Chainguard:** Catalog-based or per-image; pricing by org size. [CONFIRMED 2026-04 — [chainguard-pricing]]
- **Stacklok:** No public pricing; enterprise-only, demo-gated. [CONFIRMED 2026-04 — [stacklok-home]]
- **Cursor Teams** $40/user/mo reference. **Windsurf Teams** $30/user/mo. [CONFIRMED 2026-04 — competitive-analysis.md]
- **Implication for Tages:** Memory Governance tier can credibly sit at $39–$69/seat/mo. Keep $19/Team tier as a "starter" for Bet A's funnel; position Governance above it.

#### Q3. Competitor governance claims

- **Mem0** SOC 2 Type I certified, SOC 2 Type II in progress, HIPAA-compliant, zero-trust + BYOK encryption, "audit-ready logs, encrypted storage, flexible deployment." Trust Center unreachable on 2026-04-20 (rate-limited). [CONFIRMED 2026-04 — [mem0-security]] Specifics not published.
- **Zep Enterprise:** SOC 2 Type II, HIPAA BAA, BYOK/BYOM/BYOC. [CONFIRMED 2026-04 — [zep-pricing] (via competitive-analysis.md)] [DOMAIN REVIEW NEEDED — SOC 2 attestation currency]
- **Cognee:** $7.5M seed; 70+ enterprise customers incl. Bayer, University of Wyoming, dltHub; "governed, self-improving memory" positioning. [CONFIRMED 2026-04 — [cognee-seed][cognee-atlan]] No explicit SOC 2 claim surfaced.
- **Letta:** No surfaced SOC 2 or HIPAA claim. [UNVERIFIED — check letta.com/enterprise]
- **Implication for Tages:** Mem0 is the pacing competitor on compliance. Tages needs SOC 2 Type II on the roadmap (12–18 months) and a public "Trust Center"–style page at launch that exceeds Mem0 on specificity (exact field schema, exact retention, exact export formats).

#### Q4. MCP gateways — complementary or competitive?

- **Stacklok ToolHive** (Apache 2.0, $36M Mar 2026): vMCP, embedded auth, tool-level policy, K8s RBAC, OTel audit. [CONFIRMED 2026-04 — [stacklok-toolhive][stacklok-comp]] **Complementary.** Stacklok gates *tool access*; Tages is *memory behind tools*. Integration opportunity.
- **TrueFoundry:** DMZ-for-tools, vMCP, 350+ req/sec, immutable OTel audit logs, K8s/VPC/air-gap. [CONFIRMED 2026-04 — [truefoundry-gw]] MCP support still maturing. **Complementary.**
- **Composio:** 500+ SaaS integrations, connectivity-focused. RBAC and PII detection weak. [CONFIRMED 2026-04 — [composio-gw]] **Neither strongly competitive nor complementary** — different category.
- **Lunar.dev MCPX:** Granular ACLs at global/service/tool level; SIEM-ready immutable logs. [CONFIRMED 2026-04 — [mcp-mgr-gw]] **Complementary.**
- **Implication for Tages:** Publish a "runs behind Stacklok ToolHive" compat guide by Q3 2026. Stacklok's "tool-level policy" is upstream of Tages's memory operations — integration is a trust multiplier, not a threat.

### Bet B — AGENTS.md-native authoring

#### Q5. AGENTS.md patterns from 2,500 repos (priority)

GitHub blog analysis yielded 6 canonical sections: [CONFIRMED 2026-04 — [github-agents-md]]
- **Commands** (listed early, with flags)
- **Testing** (executable commands)
- **Project structure** (file locations)
- **Code style** (with real snippets)
- **Git workflow**
- **Boundaries** (what to avoid)

Three-tier boundary pattern: **✅ Always, ⚠️ Ask first, 🚫 Never.** Persona + operating-manual framing beats "helpful assistant." Specificity wins: "React 18 with TypeScript, Vite, Tailwind CSS" > "React project."

Six recommended starter agent types: `@docs-agent`, `@test-agent`, `@lint-agent`, `@api-agent`, `@dev-deploy-agent` (+ one more not named in the post).

Anti-patterns: vague descriptions; missing executable commands; no code style examples; unclear file access boundaries; omitting tech-stack versions; no read-only vs. write-capable separation.

Notably absent from the post: no explicit comparison to CLAUDE.md, `.cursor/rules/`, `.github/copilot-instructions.md`. [CONFIRMED 2026-04 — [github-agents-md]] This is open ground for Tages to define "how AGENTS.md coexists with other agent config."

**Implication for Tages:** `tages agents-md write` should generate the 6 canonical sections from Tages memory. `tages agents-md audit` should lint against anti-patterns (vagueness detector, missing-commands, missing-boundaries). `tages agents-md diff` should show drift between memory state and committed AGENTS.md.

#### Q6. AGENTS.md tooling ecosystem

- No linters, validators, generators, or CLIs for AGENTS.md surfaced. [CONFIRMED 2026-04 — [agents-md-gh]]
- No formal schema. Markdown with optional YAML frontmatter (name, description). [CONFIRMED 2026-04 — [agents-md-gh]]
- No federation / section-ownership pattern in public repos. [CONFIRMED 2026-04 — [agents-md-gh]]
- 71 open issues, 65 open PRs on `agentsmd/agents.md` — active but no tooling concentration. [CONFIRMED 2026-04 — [agents-md-gh]]
- **Implication:** Bet B is even more open than positioning assumed. First-mover opportunity for Tages to be *the* AGENTS.md tooling reference.

#### Q7. Cursor precedence (rules vs AGENTS.md vs Memories)

- `.cursor/rules/*.mdc` with YAML frontmatter for path scoping. [CONFIRMED 2026-04 — [cursor-mcp-docs]]
- Cursor Memories auto-generated from conversation. [CONFIRMED 2026-04 — competitive-analysis.md]
- AGENTS.md supported as project instructions. [CONFIRMED 2026-04 — [agents-md-site]]
- Precedence rules NOT clearly documented; the `.cursor/mcp.json` docs cover server precedence (project > global) but not config-file precedence. [CONFIRMED 2026-04 — [cursor-mcp-docs]] [UNVERIFIED — check forum.cursor.com or a recent blog for definitive answer]
- **Implication:** Tages `agents-md` tooling should be conservative: emit canonical AGENTS.md, let users decide how Cursor layers it. Don't claim "replaces Cursor Rules."

#### Q8. Federated / section-ownership authoring

- No public pattern. [CONFIRMED 2026-04 — [agents-md-gh]]
- Symlink patterns for sharing AGENTS.md across projects exist. [CONFIRMED 2026-04 — [augment-agents-md]] Not true federation.
- **Implication:** Tages can *define* this pattern. "Security team owns `## Security`, platform team owns `## Build & Test`, architecture team owns `## Project structure`" is a genuinely novel governance model — ship as Tages's opinionated default with `tages agents-md federate`.

### Bet C — Reproducible coding-memory benchmark

#### Q9. RetainDB methodology (priority)

- **Dataset:** LongMemEval oracle split (up to 50 per category × 6 categories = 500 questions). [CONFIRMED 2026-04 — [retaindb-bench]]
- **Models:** Extraction GPT-5.4-mini; Answer GPT-5.4 temp=0; Judge GPT-5.4-mini (official LongMemEval evaluator). [CONFIRMED 2026-04 — [retaindb-bench]]
- **Pipeline:** Turn-by-turn extraction with 3-turn context window → write with metadata (eventDate, documentDate, confidence) → chronological retrieval (no semantic filter) → answer with "today's date and memory timeline." [CONFIRMED 2026-04 — [retaindb-bench]]
- **Reproducibility:** "Every run is reproducible," benchmark runner ships in their repo. Exact prompts not published on the benchmark page. [CONFIRMED 2026-04 — [retaindb-bench]]
- **Results:** 79% overall LongMemEval; 88% preference recall. March 2026. "Separate DB project per question — no cross-contamination." [CONFIRMED 2026-04 — [retaindb-bench]]
- Also: 16-API hallucination benchmark, 0% vs 95.5% GPT-5 ungrounded, 13ms avg retrieval latency. [CONFIRMED 2026-04 — [retaindb-bench]]
- **Implication for Tages:** Replicate the RetainDB pattern exactly. Use same judge (GPT-4o or GPT-5.4-mini per LongMemEval paper default), publish the notebook, cite methodology. Target: Tages ≥ 80% overall LongMemEval, as first-launch credibility floor.

#### Q10. Coding-specific memory benchmarks

- **Stompy benchmark** (March 2026) is the only controlled benchmark of memory in coding agents. [CONFIRMED 2026-03 — [stompy-medium]]
  - Production Python/FastAPI/Postgres codebase (4,895 LoC, 158 files)
  - Three complexity levels: moderate / high / very-high
  - Three conditions: Stompy memory / no-memory / hand-curated file
  - **Memory saved 22–32% cost, 28–40% turns** on complex tasks; quality 67/75 vs file 68/75.
  - Single model (Claude Opus 4.6), 9 runs total. Pilot methodology, self-benchmark.
- **MemoryAgentBench** (ICLR 2026, HUST): four competencies (Accurate Retrieval, Test-Time Learning, Long-Range Understanding, Conflict Resolution). NOT coding-specific. 304 stars. [CONFIRMED 2026-01 — [memagentbench-gh]]
- **LOCOMO:** Long-term conversational memory. Not coding. [CONFIRMED 2026 — background]
- "Every dedicated memory system benchmarks exclusively on conversational recall tasks like LOCOMO, while every coding benchmark treats tasks as independent episodes with no memory between them. Every published benchmark tests conversational recall but none tests coding." [CONFIRMED 2026-04 — [atlan-frameworks]]
- **Implication for Tages:** Fork or extend Stompy. Architecture already assumes MCP providers; adding Tages as a condition is config + prompts work. Publish `tages eval coding` that runs the Stompy harness with a Tages-condition by Q2 2026. Alternatively: cite Stompy + run it + contribute back a Tages adapter PR.

#### Q11. Supermemory's 85.4% methodology

- Actually **81.6% on GPT-4o; 85.2% on Gemini-3-Pro.** Benchmark: LongMemEval_s. [CONFIRMED 2026-04 — [supermemory-research]]
- Full answer prompt in appendix; evaluation uses GPT-4o + question-specific prompts from the LongMemEval paper. [CONFIRMED 2026-04 — [supermemory-research]]
- Code, ingestion pipeline, eval scripts "available in our GitHub repository." [CONFIRMED 2026-04 — [supermemory-research]]
- No coding-agent-specific benchmark. Focus is conversational. [CONFIRMED 2026-04 — [supermemory-research]]
- **Implication:** Supermemory's public methodology is reproducible-ish but focused on chat. Tages should match methodology (same judge, same dataset, same appendix discipline) and add a coding overlay.

#### Q12. Memory drift detection

- **Agent Drift arXiv paper (Jan 2026):** Three manifestations — semantic drift, coordination drift, behavioral drift. 12-dimensional Agent Stability Index (ASI) composite metric covering response consistency, tool-usage patterns, reasoning-pathway stability, inter-agent agreement. Three mitigations: episodic memory consolidation, drift-aware routing, adaptive behavioral anchoring. [CONFIRMED 2026-01 — [agent-drift-arxiv]]
- "Detecting when high-relevance memories become stale is an open research problem." [CONFIRMED 2026-04 — [atlan-frameworks]]
- No vendor has productized drift detection as a first-class surface. [CONFIRMED 2026-04 — search returned academic only]
- **Implication:** Tages can ship `tages drift` as a first-class CLI command backed by ASI-style metrics adapted for the coding-team case. This is a genuine first-mover move with arXiv-grade backing.

### Bet D — Cross-tool plugin parity

#### Q13. Cursor plugin surface (priority)

- **No plugin system beyond MCP.** MCP servers are the primary extension surface. [CONFIRMED 2026-04 — [cursor-mcp-docs]]
- Install paths: (1) Settings UI → Tools & MCP → New MCP Server; (2) edit `.cursor/mcp.json` manually; (3) "Add to Cursor" marketplace buttons with OAuth. [CONFIRMED 2026-04 — [cursor-mcp-setup]]
- Config schema identical to standard MCP JSON: `mcpServers.{name}.{command,args,env}`. [CONFIRMED 2026-04 — [cursor-mcp-docs]]
- Project `.cursor/mcp.json` wins over global `~/.cursor/mcp.json`. [CONFIRMED 2026-04 — [cursor-mcp-docs]]
- MCP tools scanned by Cursor Agent; tool descriptions injected into context. [CONFIRMED 2026-04 — [cursor-mcp-docs]]
- **Implication:** `@tages/cursor-plugin` is a 30-minute project. Ship a `.cursor/mcp.json` snippet + a cursor.directory entry + an "Add to Cursor" button via `cursor://` deep link.

#### Q14. Codex integration

- MCP config at `~/.codex/config.toml` (global) or `.codex/config.toml` (project, trusted only). [CONFIRMED 2026-04 — [codex-mcp-docs]]
- Install: `codex mcp add <name> -- <stdio command>`. [CONFIRMED 2026-04 — [codex-mcp-docs]]
- STDIO + Streamable HTTP; OAuth via `codex mcp login <name>`. [CONFIRMED 2026-04 — [codex-mcp-docs]]
- Tool filter: `enabled_tools` / `disabled_tools`. [CONFIRMED 2026-04 — [codex-mcp-docs]]
- AGENTS.md read natively by Codex before any work. [CONFIRMED 2026-04 — [codex-agents-md]]
- **Implication:** `codex mcp add tages -- npx -y @tages/server` is the one-liner. Ship alongside Cursor. Bonus: Codex reads AGENTS.md natively — Bet B and Bet D's Codex work reinforce each other.

#### Q15. Gemini CLI integration

- Config at `~/.gemini/settings.json` or `.gemini/settings.json`. [CONFIRMED 2026-04 — [gemini-mcp-docs]]
- `mcpServers.{name}.{command,args,env,cwd,timeout,trust,includeTools,excludeTools}`. [CONFIRMED 2026-04 — [gemini-mcp-docs]]
- Environment sanitization on spawn; env vars must be explicit. [CONFIRMED 2026-04 — [gemini-mcp-docs]]
- FastMCP v2.12.3 supports `fastmcp install gemini-cli`. [CONFIRMED 2026-04 — [gemini-mcp-docs]]
- **Implication:** `@tages/gemini-plugin` = a settings.json snippet + FastMCP-installer compat. Same day-of work as Cursor/Codex.

#### Q16. Install friction comparison

| Tool | Install syntax | Config format |
|---|---|---|
| Claude Code | `claude mcp add tages` | managed by CLI |
| Codex | `codex mcp add tages -- npx -y @tages/server` | TOML (`config.toml`) |
| Cursor | UI button, marketplace deep-link, or edit `.cursor/mcp.json` | JSON |
| Gemini CLI | Edit `settings.json` or `fastmcp install gemini-cli` | JSON |

All four are effectively one-liner install experiences. **Tages's "works everywhere" story is real and cheap to execute.** [CONFIRMED 2026-04 — source matrix above]

### Broader Market

#### Q17. Dev-team case studies

- **Cognee:** 70+ enterprise customers; Bayer (scientific research), University of Wyoming (evidence graph from policy docs with page-level provenance), dltHub. $7.5M seed. >1M pipelines/month. [CONFIRMED 2026-04 — [cognee-seed][cognee-atlan]]
- **Mem0:** AWS Agent SDK exclusive memory provider; 186M API calls Q3 2025. [CONFIRMED 2025-10 — [mem0-series-a]]
- **Supermemory:** Cluely, Montra, Scira, Rube (Composio), Rets. [CONFIRMED 2025-10 — [techcrunch-supermemory]]
- **Greptile:** Team-review memory. Named customers not listed. [CONFIRMED 2026-04 — competitive-analysis.md]
- No Tages customers yet. Pre-launch. [USER-SUPPLIED]
- **Implication:** Case studies are a future milestone; design-partner recruiting is a Bet A prerequisite.

#### Q18. Pricing elasticity

- SaaS pricing shift away from per-seat toward credit / usage / outcome models. [CONFIRMED 2026-04 — [nxcode-saas]]
- Anthropic Enterprise Claude: $20/seat base + usage-metered. [CONFIRMED 2026-04 — [kingy-anthropic]]
- AI cost variance up to 10x per-request drives usage-based adoption. [CONFIRMED 2026-04 — [nxcode-saas]]
- GitHub Copilot flat rate retained for predictability. [CONFIRMED 2026-04 — [techinsider-cc-gh]]
- **Implication for Tages:** Keep flat-seat as pricing default (predictability is a live buying signal). Consider a "metered audit-log storage" add-on for Governance SKU at enterprise tier to capture high-volume customers without breaking the flat-seat narrative.

#### Q19. Claude Code Skills ecosystem

- Skills = SKILL.md with instructions; loaded on demand. [CONFIRMED 2026-04 — [cc-skills]]
- **Team/Enterprise plans support org-wide skill provisioning** via organization settings. [CONFIRMED 2026-04 — [cc-skills-mkt]]
- Peer-to-peer / peer-to-org sharing off by default; owner enables. [CONFIRMED 2026-04 — [cc-skills-mkt]]
- Project skills at `.claude/commands/` shared via Git. [CONFIRMED 2026-04 — [cc-skills-mkt]]
- Marketplaces: SkillsMP (800k+ skills), ClaudeSkills.info (140+ free). [CONFIRMED 2026-04 — [skills-mp]]
- **Implication:** Skills are instruction bundles, Tages is learned/audited memory. Different mechanism. But: Claude Code's org-level skill provisioning **does** compete with Tages's "team-shared CLAUDE.md analog" positioning. Tages should position against this by emphasizing memory is **written**, not just **installed** — learnings accumulate from real work, not from pre-authored bundles.

#### Q20. Community perception of Tages

- **Zero public signal.** No HN submissions, no Reddit r/mcp mentions, no dev.to posts, no cursor.directory entry. [CONFIRMED 2026-04 — search returned zero Tages-specific results]
- Competitor signal: Hmem (Feb 2026 Show HN, similar framing) still has the HN attention for "hierarchical coding-agent memory." [CONFIRMED 2026-02 — [hn-hmem]]
- **Implication:** Launch is cold start. Every bet needs a launch-worthy artifact (blog, demo, benchmark, plugin) and a coordinated distribution push (HN Show, r/mcp, r/LocalLLaMA, dev.to, cursor.directory, MCP Hunt).

---

## Assumptions Challenged

1. **"Tages's team+RBAC+audit is uncontested."** [CONTRADICTED 2026-04] Mem0 Enterprise is SOC 2 Type I certified with audit-ready logs. Zep Enterprise is SOC 2 Type II with BYOK/BYOM/BYOC. Tages is **ahead on coding-specific team memory**, not on "enterprise governance generally." Sharpen the differentiator: **memory governance for teams running 2+ agents per developer on shared code**, not "we have audit logs."

2. **"We need to build a coding-memory benchmark from scratch."** [CONTRADICTED 2026-04] Stompy exists, MIT, reproducible, MCP-based, paused. Partnering (adapter PR) or forking (Tages-branded extension) beats building a new harness by weeks.

3. **"Plugin parity is a big engineering effort."** [CONTRADICTED 2026-04] Cursor, Codex, and Gemini MCP installation are config-file snippets. All together is under a week of focused work. Time-cost was overestimated.

4. **"Provenance is a Tages-specific feature."** [CONFIRMED 2026-04] Uncontested. Mainstream memory frameworks do not track provenance. Double-down on this.

5. **"AGENTS.md tooling is crowded."** [CONTRADICTED 2026-04] No linters, validators, or generators exist. Bet B has bigger whitespace than positioning assumed.

6. **"MCP security / gateway vendors are competitive."** [PARTIALLY CONTRADICTED 2026-04] Stacklok, TrueFoundry, Lunar.dev MCPX are all **complementary** (tool-access gating, upstream of memory). Composio is neither. Treat these as integration targets, not competitors.

---

## Validation Plan

| # | Claim | Tag | Validation | Owner | Due |
|---|---|---|---|---|---|
| 1 | Mem0 audit log specifics (field schema, retention, export) are weaker than Tages can match | [UNVERIFIED — Trust Center returned 429] | Manual fetch of trust.mem0.ai/ or request via Mem0 support | Ryan | 14 days |
| 2 | Stompy maintainer (banton / Markus Sandelin) would accept a Tages-condition PR | [INFERRED → validate by: GitHub issue or email outreach to banton] | Open a GitHub issue on stompy-benchmark asking about adapter pattern | Ryan | 7 days |
| 3 | Tages ≥80% on LongMemEval_s is achievable with current retrieval stack | [INFERRED → validate by: run the harness] | Stand up `eval/longmemeval/` and run one calibration pass with GPT-4o | Ryan / agent | 14 days |
| 4 | Cursor conflict resolution between Rules / AGENTS.md / Memories | [UNVERIFIED — docs don't spell it out] | Ask on forum.cursor.com or fetch a recent blog post that documents precedence | Ryan | 14 days |
| 5 | Claude Code org-skill provisioning is actually a team-memory competitor | [INFERRED → validate by: talking to a Team-plan admin] | Reach out to one Claude Code Team customer or Anthropic DevRel | Ryan | 30 days |
| 6 | Stacklok ToolHive integration with Tages is technically compatible | [INFERRED → validate by: install ToolHive locally, run Tages behind it] | 1-day spike | Ryan / agent | 30 days |
| 7 | Memory Governance SKU at $39–$69/seat/mo is defensible | [INFERRED → validate by: 3 enterprise pricing conversations] | Pricing interviews with 3 design-partner team leads | Ryan | 60 days |
| 8 | Zep SOC 2 Type II attestation current in 2026 | [DOMAIN REVIEW NEEDED] | Request attestation letter via Zep sales | PM coach | 30 days |
| 9 | AGENTS.md precedence / coexistence story is not already claimed by another vendor | [UNVERIFIED] | Weekly monitor of agentsmd/agents.md repo + Linux Foundation AAIF posts | Ryan | Ongoing |
| 10 | Tages LongMemEval + Stompy dual-publication is enough for launch credibility | [INFERRED → validate by: draft-publish to 3 trusted reviewers before HN launch] | Pre-launch review sprint | Ryan | 75 days |

---

## Open Questions

1. **What exactly is in Mem0's audit log?** Trust center rate-limited. Would close with a direct fetch of trust.mem0.ai or a support request.
2. **Does Cursor's rules+memory+AGENTS.md precedence allow a Tages-authored AGENTS.md to be authoritative?** Check forum.cursor.com, Cursor 3 release notes, or community thread.
3. **Would Anthropic deprioritize a "team-shared auto-memory" feature because Skills already partially cover team provisioning?** Check Claude Code v2.2+ changelog monthly.
4. **Is there an ICLR 2026 workshop or paper track for memory benchmarks?** If so, Tages + Stompy could submit a joint track entry for reputational lift.
5. **What's the right legal / contractual surface for "memory governance"?** SOC 2 compliance roadmap from an auditor is a 3–6 month project; who owns it?

---

## Source Index

[mem0-security]: https://mem0.ai/security
[mem0-series-a]: https://mem0.ai/series-a
[openmemory]: https://mem0.ai/openmemory
[mem0-state]: https://mem0.ai/blog/state-of-ai-agent-memory-2026
[stompy-gh]: https://github.com/banton/stompy-benchmark
[stompy-medium]: https://medium.com/@mrsandelin/the-first-controlled-benchmark-of-ai-memory-in-coding-agents-8e0bb776d39e
[retaindb-bench]: https://www.retaindb.com/benchmark
[supermemory-research]: https://supermemory.ai/research/
[supermemory-apis]: https://blog.supermemory.ai/best-memory-apis-stateful-ai-agents/
[memagentbench-gh]: https://github.com/HUST-AI-HYZ/MemoryAgentBench
[agent-drift-arxiv]: https://arxiv.org/abs/2601.04170
[ms-agent-gov]: https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/
[atlan-frameworks]: https://atlan.com/know/best-ai-agent-memory-frameworks-2026/
[github-agents-md]: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/
[agents-md-gh]: https://github.com/agentsmd/agents.md
[agents-md-site]: https://agents.md/
[augment-agents-md]: https://www.augmentcode.com/guides/how-to-build-agents-md
[codex-agents-md]: https://developers.openai.com/codex/guides/agents-md
[codex-mcp-docs]: https://developers.openai.com/codex/mcp
[cursor-mcp-docs]: https://cursor.com/docs/context/mcp
[cursor-mcp-setup]: https://cursor.com/docs/cli/mcp
[gemini-mcp-docs]: https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
[cc-skills]: https://code.claude.com/docs/en/skills
[cc-skills-mkt]: https://support.claude.com/en/articles/12512180-use-skills-in-claude
[skills-mp]: https://skillsmp.com
[snyk-vendr]: https://www.vendr.com/marketplace/snyk
[snyk-pulse]: https://getpulsesignal.com/pricing/snyk
[chainguard-pricing]: https://www.chainguard.dev/pricing
[stacklok-home]: https://stacklok.com/
[stacklok-toolhive]: https://docs.stacklok.com/toolhive/
[stacklok-comp]: https://stacklok.com/blog/best-mcp-platforms-for-teams-that-need-access-control-and-audit-logs-2026/
[truefoundry-gw]: https://www.truefoundry.com/mcp-gateway
[composio-gw]: https://composio.dev/content/best-mcp-gateway-for-developers
[mcp-mgr-gw]: https://mcpmanager.ai/blog/best-mcp-gateway-for-engineering/
[teleport-soc2]: https://goteleport.com/blog/ai-agents-soc-2/
[agility-enterprise]: https://agility-at-scale.com/ai/agents/security-and-compliance-for-enterprise-ai-agents/
[blaxel-soc2]: https://blaxel.ai/blog/soc-2-compliance-ai-guide
[certpro-soc2]: https://certpro.com/soc-2-framework-requirements-2026/
[nxcode-saas]: https://www.nxcode.io/resources/news/saas-pricing-strategy-guide-2026
[kingy-anthropic]: https://kingy.ai/ai/usage-based-billing-no-flat-rate-why-anthropics-2026-pricing-shift-changes-everything-for-claude-users/
[techinsider-cc-gh]: https://tech-insider.org/claude-code-vs-github-copilot-2026/
[cognee-seed]: https://www.cognee.ai/blog/cognee-news/cognee-raises-seven-million-five-hundred-thousand-dollars-seed
[cognee-atlan]: https://atlan.com/know/best-ai-agent-memory-frameworks-2026/
[techcrunch-supermemory]: https://techcrunch.com/2025/10/06/a-19-year-old-nabs-backing-from-google-execs-for-his-ai-memory-startup-supermemory/
[hn-hmem]: https://news.ycombinator.com/item?id=47103237

---

## What to Do with This

Hand this file to Blue. Blue's PLAN.md should structure around the 4 bets with (a) the specific artifact each bet must produce before launch, (b) the validation-plan items that are prerequisites, and (c) the sequencing in `positioning.md` §10. Priority adjustments based on this research: Bet D moved earlier (low-cost config-file work); Bet C partner-path with Stompy documented explicitly; Bet A narrowed to *memory-specific governance* (provenance + drift + cross-agent consistency) vs *generic enterprise audit*; Bet B expanded to include federated section-ownership as a first-class feature.
