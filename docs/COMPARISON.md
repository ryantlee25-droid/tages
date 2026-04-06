# Tages — Competitive Comparison

An honest look at how Tages compares to other agent memory tools.

---

## Landscape

| Tool | Approach | Pricing | Key Strength | Key Weakness |
|------|----------|---------|-------------|-------------|
| **Tages** | MCP server + CLI + dashboard | Free (10k memories) / $9 Pro | Published A/B evidence, local-first, hybrid search | Newer, smaller community |
| **Mem0** | Python SDK, cloud-first | Free tier / Enterprise | Funded (YC), broad ecosystem, graph memory | Cloud-dependent, no published quality evidence |
| **Omega** | CLI + MCP server | Open source | Benchmark leader on context recall, auto-capture hooks | No dashboard, no team sharing |
| **Engram** | Single binary MCP server | Open source | Dead simple (one file), zero dependencies | No dashboard, no search beyond exact match |
| **Greptile** | Enterprise SaaS | $30/dev/mo, $50k/yr self-hosted | SOC 2 Type II, VPC deployment | Expensive, not open source |
| **Sourcegraph Cody** | Enterprise code intelligence | Enterprise pricing | SAML SSO, repo-level permissions, GDPR | Not memory-focused, enterprise-only |

---

## Detailed Comparisons

### vs Mem0 / OpenMemory

Mem0 is the most-funded competitor (YC-backed). It offers a Python SDK with automatic memory extraction, graph-based memory relationships, and a cloud platform.

**Where Mem0 wins:**
- Larger community and ecosystem
- Graph memory with relationship tracking
- Multi-language SDK support (Python, JS, Go)
- Enterprise features (SSO, compliance)

**Where Tages wins:**
- **Published evidence**: A/B test showing 68% quality improvement and 0 hallucinations. Mem0 has no published quality impact data.
- **Local-first**: SQLite cache for <10ms queries. Mem0 requires cloud connectivity.
- **Dashboard**: Web UI for browsing, searching, and editing memories. Mem0 is API/SDK only.
- **Git hook auto-indexing**: Automatically extracts decisions from commits. Mem0 requires manual or SDK-based capture.
- **MCP native**: Built for the MCP protocol. Mem0 has MCP adapters but wasn't designed for it.

### vs Omega

Omega is the current benchmark leader for context recall quality. It uses a CLI + MCP server architecture similar to Tages.

**Where Omega wins:**
- Higher scores on context recall benchmarks
- Auto-capture hooks that require less manual memory creation
- Smaller codebase, easier to audit

**Where Tages wins:**
- **Dashboard**: Web UI for team visibility into what agents remember
- **Team sharing**: Multiple developers share one memory store (Pro)
- **Git hook extraction**: Auto-indexes architectural decisions from commit diffs using local LLM
- **A/B evidence**: Published test results showing quality impact, not just recall accuracy
- **Import**: Seed memories from existing CLAUDE.md, ARCHITECTURE.md, LESSONS.md files

### vs Engram

Engram is the simplest possible agent memory — a single binary with zero dependencies.

**Where Engram wins:**
- Single binary, zero configuration
- No database required
- Instant setup

**Where Tages wins:**
- **Hybrid search**: pg_trgm + pgvector finds related memories even without keyword overlap
- **Dashboard**: Browse, edit, search memories in a web UI
- **Cloud sync**: Memories persist across machines (Pro)
- **Import from existing files**: Seed from CLAUDE.md and other documentation
- **Quality scoring**: Automatic memory quality assessment and staleness detection

### vs Greptile

Greptile is enterprise-grade codebase intelligence at $50k/yr for self-hosted.

**Where Greptile wins:**
- SOC 2 Type II certified
- VPC/air-gapped deployment
- Dedicated support
- Broader codebase intelligence (not just memory)

**Where Tages wins:**
- **Open source**: Full source audit, no vendor lock-in
- **Free**: 10,000 memories free. Greptile starts at $30/dev/month.
- **Self-hosted free forever**: Bring your own Supabase, no license fees
- **Agent memory focused**: Purpose-built for the memory problem, not a general code intelligence platform
- **Published evidence**: A/B test data showing quality impact

---

## Tages's Unique Position

Tages is **the only agent memory tool with published evidence that memory improves output quality**.

Other tools measure recall accuracy (did the memory come back?). Tages measures outcome quality (did the agent produce better work?). The A/B tests show that the answer is yes — measurably, reproducibly, and cheaply.
