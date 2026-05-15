# Honcho Boundary Decision

_Decision date: 2026-05-15 | Owner: Ryan Lee | Status: RECOMMENDED_

---

## TL;DR

Be the substrate. Tages is codebase memory infrastructure; Honcho is a user-representation layer that reasons over conversational history. They are not the same thing. The right call is to stay below Honcho's layer, ship clean MCP primitives, and let Honcho-like systems call Tages if they need codebase memory underneath them. Building user modeling natively competes on Honcho's ground — which is not Ryan's ground — and bundling Honcho adds a dependency that doesn't fit the Tages use case at all.

---

## What Honcho Is

Concrete, from source:

- **Four storage primitives:** Workspaces, Peers, Sessions, Messages. A Peer is any participant — human or AI agent — treated as a first-class entity, not just a user ID.
- **Asynchronous reasoning pipeline:** Messages are stored synchronously; a background deriver worker processes them to build Representations, Peer Cards, and session summaries. Results are async — the system is not a fast lookup cache.
- **User representation, not memory storage:** The product Honcho is building is a model of *who the user is* (psychology, preferences, patterns) derived by reasoning over conversational history. This is distinct from what facts exist about a codebase.
- **`(observer, observed)` document pairs:** Internally, vector-embedded documents keyed by which Peer is observing which. Supports cross-agent and self-representation.
- **Chat endpoint + Conclusions API:** Query Honcho in natural language ("what does this user care about?") and get reasoning-grounded answers. LLM inference wrapped around stored representations — not a fast lookup.
- **MCP-compatible:** Honcho exposes an MCP server and SDKs (`honcho-ai` PyPI, `@honcho-ai/sdk` npm). Works with Claude Code, Cursor, Cline.
- **Hermes integration (Nous Research):** Hermes ships Honcho as an integrated dependency — evidence that Honcho positions itself as a layer other agents consume, not a standalone product.
- **What it is NOT:** Honcho is not a codebase knowledge store. It does not have structured memory types (convention, decision, anti-pattern). It does not have RBAC for teams of developers. It does not produce fast local cache lookups. It does not integrate with git hooks or CI. Its domain is *the person talking to the agent*, not *the code the agent is working on*.

---

## What Tages Is, In Relation

Tages stores and governs what an AI coding agent needs to know about a codebase — conventions, decisions, architecture, lessons, anti-patterns. It is project-level, team-shared, and governed (RBAC, audit, provenance). The memory objects are facts about software, not facts about the developer's psychology. Tages answers "what does the codebase demand?" Honcho answers "what does this user prefer?" These are orthogonal axes. A fully-featured coding agent could, in theory, consume both: Tages for codebase context, Honcho for user modeling. That is not a conflict — it is a composition opportunity. But it requires no code on Tages's side.

---

## The Three Options

### Option A — Substrate (Recommended)

**Commits to:** Tages is L2 memory infrastructure. Clean MCP primitives, stable API, well-documented schema. Let Honcho-like systems call Tages as a data source if they want codebase memory.

**Costs (eng):** Near zero. No new code. Light documentation to describe the integration surface.

**Costs (positioning):** You cede the user-modeling narrative. If someone asks "does Tages understand the developer as a person?" the answer is no, intentionally.

**Forecloses:** A "dialectic user model" inside Tages. If user modeling becomes table stakes for coding memory in 24 months, you are behind — manageable risk, fixable by integration or build at that point.

**Buyer:** Engineering managers and team leads who want shared codebase memory with governance. B2B, team-plan buyers.

---

### Option B — Compete (Build user modeling natively)

**Commits to:** Tages builds its own peer representation layer. You store conversational signals about developer behavior, preferences, and patterns alongside codebase facts.

**Costs (eng):** High. Async reasoning pipeline, per-developer representation models, query interface, ongoing LLM inference budget. Months of work, new cost model.

**Costs (positioning):** Forces you onto Honcho's ground with less traction and no asymmetric advantage. Tages's differentiation is team codebase governance — not developer psychology.

**Forecloses:** The substrate/partnership story. Compete with Honcho and you can't market "Tages + Honcho = complete agent memory stack." Blurs the product narrative at pre-scale.

**Buyer:** Shifts toward individual developers and platform builders, away from the team-lead buyer you are positioned for.

---

### Option C — Bundle (Integrate Honcho as a Tages dependency)

**Commits to:** Tages ships Honcho inside its own product. Developer installs Tages; user modeling comes with it.

**Costs (eng):** Medium to high. Runtime dependency, data model collision (Honcho's Peers vs Tages's project-scoped Users), async pipeline management, versioning, self-hosted story gets harder.

**Costs (positioning):** Confusing. Tages's pitch is codebase memory; a bundled user-psychology layer adds cognitive overhead and creates a hard dependency on Plastic Labs staying solvent.

**Forecloses:** Clean positioning. Every explanation of Tages now requires explaining Honcho. "One line install" erodes.

**Buyer:** Same team buyer, with an unexplained dependency that procurement will flag.

---

## Recommendation: Option A — Substrate

**Reasoning:**

1. **Ryan's current product surface is codebase memory, not user psychology.** 11 structured coding memory types, RBAC, federation, audit logs. None of this maps to user modeling. Adding Honcho's domain is a new product, not an extension.

2. **Hermes signals the right model.** Nous Research ships Honcho as a layer on top of underlying memory. Hermes-like platforms are building a stack: codebase memory substrate + user representation + LLM reasoning. Tages fits at the bottom. That is a supply-chain position — the substrate wins when platform players need to plug in memory.

3. **Solo-builder constraint is decisive.** Competing with Honcho requires an async reasoning pipeline, inference budget, and ongoing tuning. That is months of work that does not advance team governance, which is the actual wedge.

4. **The defensible category line is team codebase governance.** Nobody else has shipped RBAC + federation + provenance + audit for coding memory. That line is worth holding.

**The one condition under which this flips:** Anthropic or Cursor ships native team memory governance (shared CLAUDE.md with RBAC). That signal triggers a reassessment of Option B, not a reactive build today.

---

## Downstream Implications

- **Roadmap:** No user modeling primitives. Keep the user entity model simple (team member, RBAC role). No per-developer behavior tracking unless a design-partner asks and pays.
- **Dashboard:** No "developer psychology" views. Project-level: memory coverage, drift scores, audit logs, RBAC management.
- **Plugin surface:** Document MCP tools as composable primitives. A brief "pairing Tages with Honcho" integration note preempts the question for platform builders.
- **Pricing:** Hold flat-seat pricing. Per-call or per-query pricing would signal inference-heavy work Tages doesn't do.
- **Positioning copy:** Add one sentence: "Tages stores what your codebase demands. It does not model who you are as a developer — that's a different layer." Preempts the question before it costs a sales call.

---

## What This Decision Does NOT Settle

- Whether to expose a raw embedding API so Honcho or similar systems can vector-search Tages memories directly.
- Whether the `preference` memory type should be narrowed to avoid scope creep into user modeling territory.
- How to price a "Tages + Honcho" bundle if a platform partner asks.
- Whether behavioral drift analytics (tracking how individual developers' agent usage evolves) belong in Tages — touches user-modeling territory, needs a separate call.
- The Plastic Labs / Nous Research BD question: technical partnership or co-marketing? Adjacency is noted; that decision is separate.
