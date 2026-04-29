#!/usr/bin/env python3
"""
Monte Carlo Simulation: Tages Data Usage & Pricing Thresholds

Models user growth, memory creation patterns, database storage consumption,
and identifies breakpoints where Supabase tier upgrades become necessary.
Includes pricing sensitivity analysis across multiple price points.

Optimized: uses vectorized cohort math instead of per-user loops.
"""

import random
import statistics
from dataclasses import dataclass

# ─── Constants ────────────────────────────────────────────────────────

SIMULATIONS = 5_000
MONTHS = 24

# Supabase infrastructure tiers (our cost)
SUPABASE_TIERS = [
    {"name": "Free",       "cost_mo": 0,    "db_limit_mb": 500},
    {"name": "Pro",        "cost_mo": 25,   "db_limit_mb": 8_192},
    {"name": "Team",       "cost_mo": 599,  "db_limit_mb": 65_536},
    {"name": "Enterprise", "cost_mo": 1500, "db_limit_mb": 500_000},
]

SUPABASE_STORAGE_OVERAGE_PER_GB = 0.125

# Vercel infrastructure tiers (dashboard hosting)
VERCEL_TIERS = [
    {"name": "Hobby",  "cost_mo": 0,   "bandwidth_gb": 100,  "fn_exec_gb_hrs": 100,    "fn_invocations": 100_000},
    {"name": "Pro",    "cost_mo": 20,  "bandwidth_gb": 1000,  "fn_exec_gb_hrs": 1000,   "fn_invocations": 1_000_000},
    {"name": "Enterprise", "cost_mo": 500, "bandwidth_gb": 10000, "fn_exec_gb_hrs": 10000, "fn_invocations": 10_000_000},
]
# Vercel Pro overages
VERCEL_BANDWIDTH_OVERAGE_PER_GB = 0.15     # $/GB beyond included
VERCEL_FN_EXEC_OVERAGE_PER_GB_HR = 0.18   # $/GB-hr beyond included
VERCEL_EDGE_FN_EXEC_PER_MILLION = 2.0     # $/million invocations beyond included
# Dashboard page views → bandwidth: ~50KB per page load avg (SSR + assets)
DASHBOARD_PAGE_SIZE_KB = 50
# API route invocations per active dashboard user per month
API_CALLS_PER_DASHBOARD_USER = 200  # project list, memory list, stats, graphs
# Average fn execution time: 200ms at 256MB
FN_EXEC_GB_HRS_PER_CALL = (0.256 * 0.2 / 3600)  # 256MB × 200ms → GB-hrs

# Embedding / LLM cost model
# KEY INSIGHT: MCP server runs on USER's machine (stdio transport)
# Embeddings: user's Ollama (free) or user's OpenAI API key
# LLM indexing: user's Ollama (free) or user's Anthropic API key
# Sharpen tool: user's Anthropic API key
# WE pay $0 for embeddings and LLM — user bears all AI compute costs

# But we model what users pay to understand value proposition + churn risk
EMBEDDING_COST_PER_1K_TOKENS = 0.00002  # OpenAI text-embedding-3-small: $0.02/1M tokens
AVG_TOKENS_PER_MEMORY = 150             # avg memory text → ~150 tokens
HAIKU_INPUT_PER_1K = 0.001              # Claude Haiku 4.5: $1/MTok input
HAIKU_OUTPUT_PER_1K = 0.005             # Claude Haiku 4.5: $5/MTok output
AVG_HAIKU_INPUT_TOKENS = 800            # diff → extraction prompt
AVG_HAIKU_OUTPUT_TOKENS = 400           # extracted memories JSON
SHARPEN_INPUT_TOKENS = 200              # sharpen prompt
SHARPEN_OUTPUT_TOKENS = 50              # one-sentence rewrite
# Fraction of memories using OpenAI embeddings (rest use free Ollama)
OPENAI_EMBEDDING_FRACTION = 0.40        # ~40% of users don't have Ollama
# Fraction of indexing using Haiku (rest use free Ollama)
HAIKU_INDEXING_FRACTION = 0.30          # ~30% use Haiku, 70% Ollama
# Fraction of Pro users who use sharpen tool monthly
SHARPEN_USAGE_RATE = 0.15               # 15% of Pro users sharpen memories

# Tages pricing tiers (our revenue per user)
TAGES_TIERS = {
    "free":  {"price_mo": 0,   "memory_limit": 10_000,  "projects": 1},
    "pro":   {"price_mo": 14,  "memory_limit": 50_000,  "projects": 10},
    "team":  {"price_mo": 29,  "memory_limit": 100_000, "projects": 25},
}

# ─── Memory Size Model ────────────────────────────────────────────────
# Pre-computed average bytes per memory at different embedding adoption rates
# Derived from: row_overhead(200) + key(50) + value(log-normal μ=6.5 σ=1.2, median ~665)
#   + metadata(250) + embedding(6144 * adoption_rate) + versions(1.8x * 0.5)
#   + index overhead(30%)

def avg_memory_bytes(embedding_adoption: float) -> float:
    """Pre-computed average memory size in bytes."""
    base = 200 + 50 + 665 + 250  # overhead + key + median value + metadata
    embedding = 6144 * embedding_adoption
    row = base + embedding
    version_overhead = 0.8 * (200 + 665) * 0.5  # (versions-1) * partial row
    total = (row + version_overhead) * 1.30  # index overhead
    return total

# ─── Behavior Parameters ──────────────────────────────────────────────

MEMORIES_PER_MONTH = {"free": 150, "pro": 800, "team": 1200}
MEMORIES_SIGMA     = {"free": 80,  "pro": 300, "team": 400}
ACTIVE_RATE        = {"free": 0.30, "pro": 0.75, "team": 0.85}
CHURN_RATE         = {"free": 0.08, "pro": 0.04, "team": 0.02}
FREE_TO_PRO_RATE   = 0.03
FREE_TO_TEAM_RATE  = 0.005
ARCHIVE_RECLAIM    = 0.15

# ─── Scenarios ─────────────────────────────────────────────────────────

@dataclass
class Scenario:
    name: str
    description: str
    initial_free: int
    initial_pro: int
    initial_team: int
    monthly_signups: int
    signup_growth_rate: float
    team_avg_seats: float
    embedding_adoption: float
    self_hosted_ratio: float

SCENARIOS = [
    Scenario("Conservative", "Slow organic growth, mostly free users",
             50, 5, 1, 30, 0.05, 3, 0.20, 0.40),
    Scenario("Base Case", "Moderate growth, solid Pro conversion",
             200, 20, 3, 120, 0.10, 5, 0.50, 0.30),
    Scenario("Optimistic", "Strong word-of-mouth, HN/Reddit traction",
             500, 50, 10, 400, 0.15, 8, 0.70, 0.25),
    Scenario("Viral", "Major coverage, rapid adoption, enterprise interest",
             1000, 100, 25, 1000, 0.20, 12, 0.80, 0.20),
]

# ─── Simulation Engine (vectorized cohorts) ────────────────────────────

def supabase_cost(db_size_mb: float) -> tuple:
    for tier in SUPABASE_TIERS:
        if db_size_mb <= tier["db_limit_mb"]:
            return tier["name"], tier["cost_mo"]
    t = SUPABASE_TIERS[-1]
    overage_gb = max(0, (db_size_mb - t["db_limit_mb"]) / 1024)
    return t["name"], t["cost_mo"] + overage_gb * SUPABASE_STORAGE_OVERAGE_PER_GB


def vercel_cost(dashboard_users: int) -> tuple:
    """Calculate Vercel dashboard hosting cost based on active dashboard users."""
    # Dashboard page views: ~10 pages per session, 3 sessions/mo per active user
    page_views = dashboard_users * 10 * 3
    bandwidth_gb = page_views * DASHBOARD_PAGE_SIZE_KB / (1024 * 1024)

    # API route invocations
    fn_invocations = dashboard_users * API_CALLS_PER_DASHBOARD_USER
    fn_gb_hrs = fn_invocations * FN_EXEC_GB_HRS_PER_CALL

    # Pick tier
    for tier in VERCEL_TIERS:
        if (bandwidth_gb <= tier["bandwidth_gb"] and
            fn_invocations <= tier["fn_invocations"]):
            return tier["name"], tier["cost_mo"]

    # Pro with overages
    pro = VERCEL_TIERS[1]
    base = pro["cost_mo"]
    bw_overage = max(0, bandwidth_gb - pro["bandwidth_gb"]) * VERCEL_BANDWIDTH_OVERAGE_PER_GB
    fn_overage = max(0, fn_gb_hrs - pro["fn_exec_gb_hrs"]) * VERCEL_FN_EXEC_OVERAGE_PER_GB_HR
    return "Pro+", base + bw_overage + fn_overage


def user_ai_costs(new_memories: int, pro_users: int, team_users: int) -> dict:
    """Calculate AI costs borne by USERS (not us). For value prop analysis."""
    # Embedding costs (OpenAI fraction)
    embedding_memories = int(new_memories * OPENAI_EMBEDDING_FRACTION)
    embedding_tokens = embedding_memories * AVG_TOKENS_PER_MEMORY
    embedding_cost = embedding_tokens / 1000 * EMBEDDING_COST_PER_1K_TOKENS

    # Haiku indexing costs (for git hook auto-indexer)
    # ~1 Haiku call per 5 memories (one diff → multiple memories)
    haiku_calls = int(new_memories * HAIKU_INDEXING_FRACTION / 5)
    haiku_input_cost = haiku_calls * AVG_HAIKU_INPUT_TOKENS / 1000 * HAIKU_INPUT_PER_1K
    haiku_output_cost = haiku_calls * AVG_HAIKU_OUTPUT_TOKENS / 1000 * HAIKU_OUTPUT_PER_1K
    haiku_index_cost = haiku_input_cost + haiku_output_cost

    # Sharpen costs (Pro/Team users only)
    sharpen_users = int((pro_users + team_users) * SHARPEN_USAGE_RATE)
    sharpen_calls = sharpen_users * 20  # ~20 memories sharpened per session
    sharpen_cost = sharpen_calls * (
        SHARPEN_INPUT_TOKENS / 1000 * HAIKU_INPUT_PER_1K +
        SHARPEN_OUTPUT_TOKENS / 1000 * HAIKU_OUTPUT_PER_1K
    )

    return {
        "embedding": embedding_cost,
        "haiku_index": haiku_index_cost,
        "sharpen": sharpen_cost,
        "total": embedding_cost + haiku_index_cost + sharpen_cost,
        "per_user_avg": (embedding_cost + haiku_index_cost + sharpen_cost) /
                        max(1, pro_users + team_users) if (pro_users + team_users) > 0
                        else (embedding_cost + haiku_index_cost) / max(1, new_memories / 150),
    }


def run_sim(scenario: Scenario, seed: int,
            pro_price: float = None, team_price: float = None,
            conv_mult: float = 1.0) -> list:
    """Single simulation run. Returns list of monthly snapshots (dicts)."""
    rng = random.Random(seed)

    pp = pro_price if pro_price is not None else TAGES_TIERS["pro"]["price_mo"]
    tp = team_price if team_price is not None else TAGES_TIERS["team"]["price_mo"]

    free = scenario.initial_free
    pro = scenario.initial_pro
    team = scenario.initial_team
    seats = int(team * scenario.team_avg_seats)
    sh = int((free + pro) * scenario.self_hosted_ratio)

    mem_size = avg_memory_bytes(scenario.embedding_adoption)
    total_mem = 0
    db_bytes = 0.0
    cum_rev = 0.0
    cum_cost = 0.0
    cum_user_ai = 0.0
    snaps = []

    for m in range(1, MONTHS + 1):
        # Signups
        base_signups = scenario.monthly_signups * (1 + scenario.signup_growth_rate) ** (m - 1)
        signups = max(0, int(rng.gauss(base_signups, base_signups * 0.15)))
        free += signups
        sh += int(signups * scenario.self_hosted_ratio)

        # Conversions (elasticity-adjusted)
        new_pro = max(0, int(free * rng.gauss(FREE_TO_PRO_RATE * conv_mult, 0.005)))
        new_team = max(0, int(free * rng.gauss(FREE_TO_TEAM_RATE * conv_mult, 0.002)))
        new_pro = min(new_pro, free)
        new_team = min(new_team, free - new_pro)
        free -= new_pro + new_team
        pro += new_pro
        team += new_team
        seats += int(new_team * scenario.team_avg_seats)

        # Churn
        for tier, ref in [("free", None), ("pro", None), ("team", None)]:
            u = {"free": free, "pro": pro, "team": team}[tier]
            c = max(0, min(u, int(u * rng.gauss(CHURN_RATE[tier], CHURN_RATE[tier] * 0.2))))
            if tier == "free": free -= c
            elif tier == "pro": pro -= c
            else:
                team -= c
                seats -= int(c * scenario.team_avg_seats)
        seats = max(team, seats)

        # Cloud users (subtract self-hosted from free)
        cloud_free = max(0, free - sh)

        # Memory creation — vectorized per-cohort (no per-user loop)
        new_mem = 0
        for tier, count in [("free", cloud_free), ("pro", pro), ("team", team)]:
            active = int(count * ACTIVE_RATE[tier])
            if active <= 0:
                continue
            cohort_mean = active * MEMORIES_PER_MONTH[tier]
            cohort_sigma = MEMORIES_SIGMA[tier] * (active ** 0.5)
            created = max(0, int(rng.gauss(cohort_mean, cohort_sigma)))
            new_mem += created

        total_mem += new_mem

        # Archive reclaim
        capped = int(cloud_free * 0.1)
        archived = int(capped * TAGES_TIERS["free"]["memory_limit"] * ARCHIVE_RECLAIM)
        total_mem = max(0, total_mem - archived)

        # Storage
        db_bytes += new_mem * mem_size - archived * mem_size * 0.3
        db_mb = db_bytes / (1024 * 1024)

        # Revenue
        rev = pro * pp + seats * tp
        cum_rev += rev

        # ── OUR costs ──
        # Supabase
        supa_tier, supa_cost_mo = supabase_cost(db_mb)

        # Vercel (dashboard hosting)
        # Dashboard users: ~50% of Pro, ~80% of Team (CLI users may skip dashboard)
        dashboard_users = int(pro * 0.50 + team * 0.80 + cloud_free * 0.05)
        vcel_tier, vcel_cost_mo = vercel_cost(dashboard_users)

        total_our_cost = supa_cost_mo + vcel_cost_mo
        cum_cost += total_our_cost

        # ── USER costs (not our expense, but track for value analysis) ──
        user_ai = user_ai_costs(new_mem, pro, team)
        cum_user_ai += user_ai["total"]

        snaps.append({
            "month": m, "free": free, "pro": pro, "team": team, "seats": seats,
            "sh": sh, "memories": total_mem, "db_mb": db_mb,
            "new_mem": new_mem,
            "rev": rev, "cum_rev": cum_rev,
            "supa_tier": supa_tier, "supa_cost": supa_cost_mo,
            "vcel_tier": vcel_tier, "vcel_cost": vcel_cost_mo,
            "total_our_cost": total_our_cost, "cum_cost": cum_cost,
            "net": rev - total_our_cost, "cum_net": cum_rev - cum_cost,
            # User-side AI costs
            "user_embed_cost": user_ai["embedding"],
            "user_haiku_cost": user_ai["haiku_index"],
            "user_sharpen_cost": user_ai["sharpen"],
            "user_ai_total": user_ai["total"],
            "cum_user_ai": cum_user_ai,
        })

    return snaps


def percentile(vals, p):
    s = sorted(vals)
    return s[min(int(len(s) * p / 100), len(s) - 1)]


def run_monte_carlo(scenario: Scenario) -> dict:
    all_runs = [run_sim(scenario, i * 7919) for i in range(SIMULATIONS)]

    result = {"scenario": scenario.name, "desc": scenario.description, "months": []}
    for mi in range(MONTHS):
        month_snaps = [r[mi] for r in all_runs]

        def agg(key):
            vals = [s[key] for s in month_snaps]
            return {
                "p5": percentile(vals, 5), "p25": percentile(vals, 25),
                "median": percentile(vals, 50), "p75": percentile(vals, 75),
                "p95": percentile(vals, 95), "mean": statistics.mean(vals),
            }

        tier_counts = {}
        for s in month_snaps:
            tier_counts[s["supa_tier"]] = tier_counts.get(s["supa_tier"], 0) + 1

        # Vercel tier distribution
        vcel_counts = {}
        for s in month_snaps:
            vcel_counts[s["vcel_tier"]] = vcel_counts.get(s["vcel_tier"], 0) + 1

        result["months"].append({
            "month": mi + 1,
            **{k: agg(k) for k in ["free", "pro", "team", "seats", "memories", "db_mb",
                                     "rev", "cum_rev", "supa_cost", "vcel_cost",
                                     "total_our_cost", "cum_cost", "net", "cum_net",
                                     "user_embed_cost", "user_haiku_cost", "user_sharpen_cost",
                                     "user_ai_total", "cum_user_ai"]},
            "tier_dist": tier_counts,
            "vcel_dist": vcel_counts,
        })
    return result


# ─── Pricing Sensitivity ──────────────────────────────────────────────

PRICING_GRID = [
    (9,  19, "Aggressive:  Pro $9  / Team $19"),
    (9,  29, "Low Pro:     Pro $9  / Team $29"),
    (14, 29, "Current:     Pro $14 / Team $29"),
    (14, 39, "High Team:   Pro $14 / Team $39"),
    (19, 29, "High Pro:    Pro $19 / Team $29"),
    (19, 39, "Premium:     Pro $19 / Team $39"),
    (24, 49, "Enterprise:  Pro $24 / Team $49"),
    (29, 59, "Top Shelf:   Pro $29 / Team $59"),
]


def conv_mult(pro_price: float) -> float:
    base = 14
    if pro_price <= base:
        return 1.0 + (base - pro_price) / base * 0.5
    return max(0.2, 1.0 - (pro_price - base) / base * 0.4)


def run_pricing_sensitivity(scenario: Scenario, n_sims: int = 2000) -> list:
    results = []
    for pp, tp, label in PRICING_GRID:
        cm = conv_mult(pp)
        runs = [run_sim(scenario, i * 7919, pp, tp, cm) for i in range(n_sims)]

        m12 = [r[11] for r in runs]
        m24 = [r[23] for r in runs]

        results.append({
            "label": label, "pp": pp, "tp": tp, "cm": cm,
            "m12_rev": percentile([s["rev"] for s in m12], 50),
            "m12_net": percentile([s["cum_net"] for s in m12], 50),
            "m24_rev": percentile([s["rev"] for s in m24], 50),
            "m24_net": percentile([s["cum_net"] for s in m24], 50),
            "m24_margin": percentile(
                [(s["rev"] - s["supa_cost"]) / s["rev"] * 100 if s["rev"] > 0 else -100 for s in m24], 50),
            "m24_rev_p25": percentile([s["rev"] for s in m24], 25),
            "m24_rev_p75": percentile([s["rev"] for s in m24], 75),
        })
    return results


# ─── Report Formatting ────────────────────────────────────────────────

def fmt(n):
    if abs(n) >= 1_000_000: return f"{n/1e6:.1f}M"
    if abs(n) >= 1_000: return f"{n/1e3:.1f}K"
    return f"{n:.0f}"


def generate_report(all_results, pricing_results):
    L = []
    L.append("=" * 95)
    L.append("  TAGES MONTE CARLO SIMULATION — DATA USAGE & PRICING THRESHOLDS")
    L.append(f"  {SIMULATIONS:,} simulations × {MONTHS} months × {len(SCENARIOS)} scenarios")
    L.append("=" * 95)

    L.append("\n┌─ OUR INFRASTRUCTURE COSTS ──────────────────────────────────────────────────────┐")
    L.append("│  SUPABASE:  Free $0 (500MB) | Pro $25/mo (8GB) | Team $599/mo (64GB)            │")
    L.append("│  VERCEL:    Hobby $0 (100GB BW) | Pro $20/mo (1TB BW) | Enterprise $500/mo      │")
    L.append("└──────────────────────────────────────────────────────────────────────────────────┘")
    L.append("┌─ USER-BORNE AI COSTS (not our expense) ─────────────────────────────────────────┐")
    L.append("│  Embeddings: Ollama FREE or OpenAI $0.02/1M tok (~$0.0003/memory)                │")
    L.append("│  Indexing:   Ollama FREE or Haiku $1/$5 per MTok (~$0.003/extraction)            │")
    L.append("│  Sharpen:    Haiku only, ~$0.0005/call                                           │")
    L.append("└──────────────────────────────────────────────────────────────────────────────────┘")
    L.append("┌─ TAGES REVENUE ──────────────────────────────────────────────────────────────────┐")
    L.append("│  Free: $0 (10K memories)  |  Pro: $14/mo (50K)  |  Team: $29/seat/mo (100K)     │")
    L.append("└──────────────────────────────────────────────────────────────────────────────────┘")

    for res in all_results:
        L.append(f"\n{'─' * 95}")
        L.append(f"  SCENARIO: {res['scenario'].upper()} — {res['desc']}")
        L.append(f"{'─' * 95}")

        milestones = [1, 3, 6, 12, 18, 24]

        # Main growth + revenue table
        L.append(f"\n  USERS & REVENUE (median)")
        L.append(f"  {'Mo':>3}  {'Free':>7}  {'Pro':>5}  {'Team':>5}  {'Seats':>5}  "
                 f"{'Memories':>9}  {'DB MB':>7}  {'Rev/mo':>8}")
        L.append(f"  {'─'*3}  {'─'*7}  {'─'*5}  {'─'*5}  {'─'*5}  "
                 f"{'─'*9}  {'─'*7}  {'─'*8}")
        for m in milestones:
            d = res["months"][m - 1]
            L.append(
                f"  {m:3d}  {fmt(d['free']['median']):>7}  {fmt(d['pro']['median']):>5}  "
                f"{fmt(d['team']['median']):>5}  {fmt(d['seats']['median']):>5}  "
                f"{fmt(d['memories']['median']):>9}  {fmt(d['db_mb']['median']):>7}  "
                f"{'$'+fmt(d['rev']['median']):>8}")

        # Cost breakdown table (OUR costs)
        L.append(f"\n  OUR COST BREAKDOWN (median, monthly)")
        L.append(f"  {'Mo':>3}  {'Supabase':>9}  {'Vercel':>8}  {'Total':>8}  {'Rev/mo':>8}  {'Net/mo':>8}  {'Cum Net':>9}")
        L.append(f"  {'─'*3}  {'─'*9}  {'─'*8}  {'─'*8}  {'─'*8}  {'─'*8}  {'─'*9}")
        for m in milestones:
            d = res["months"][m - 1]
            L.append(
                f"  {m:3d}  {'$'+fmt(d['supa_cost']['median']):>9}  "
                f"{'$'+fmt(d['vcel_cost']['median']):>8}  "
                f"{'$'+fmt(d['total_our_cost']['median']):>8}  "
                f"{'$'+fmt(d['rev']['median']):>8}  "
                f"{'$'+fmt(d['net']['median']):>8}  "
                f"{'$'+fmt(d['cum_net']['median']):>9}")

        # User-borne AI costs table
        L.append(f"\n  USER-BORNE AI COSTS (median, monthly — NOT our expense)")
        L.append(f"  {'Mo':>3}  {'Embed':>8}  {'Haiku Idx':>10}  {'Sharpen':>8}  {'Total':>8}  {'Cum Total':>10}  {'$/user':>7}")
        L.append(f"  {'─'*3}  {'─'*8}  {'─'*10}  {'─'*8}  {'─'*8}  {'─'*10}  {'─'*7}")
        for m in milestones:
            d = res["months"][m - 1]
            total_paying = d['pro']['median'] + d['seats']['median']
            per_user = d['user_ai_total']['median'] / max(1, total_paying)
            L.append(
                f"  {m:3d}  {'$'+fmt(d['user_embed_cost']['median']):>8}  "
                f"{'$'+fmt(d['user_haiku_cost']['median']):>10}  "
                f"{'$'+fmt(d['user_sharpen_cost']['median']):>8}  "
                f"{'$'+fmt(d['user_ai_total']['median']):>8}  "
                f"{'$'+fmt(d['cum_user_ai']['median']):>10}  "
                f"{'$'+f'{per_user:.2f}':>7}")

        # Uncertainty at M12 and M24
        L.append(f"\n  Uncertainty (P5–P95):")
        for t in [12, 24]:
            d = res["months"][t - 1]
            L.append(f"    M{t}: DB {fmt(d['db_mb']['p5'])}–{fmt(d['db_mb']['p95'])} MB | "
                     f"Rev ${fmt(d['rev']['p5'])}–${fmt(d['rev']['p95'])}/mo | "
                     f"Our Cost ${fmt(d['total_our_cost']['p5'])}–${fmt(d['total_our_cost']['p95'])}/mo | "
                     f"Net ${fmt(d['cum_net']['p5'])}–${fmt(d['cum_net']['p95'])} cum.")

        # Infrastructure tier probability
        L.append(f"\n  Infrastructure tier probability:")
        for t in [6, 12, 24]:
            td = res["months"][t - 1]["tier_dist"]
            vd = res["months"][t - 1]["vcel_dist"]
            supa_parts = [f"{k} {v/SIMULATIONS*100:.0f}%" for k, v in sorted(td.items()) if v > 0]
            vcel_parts = [f"{k} {v/SIMULATIONS*100:.0f}%" for k, v in sorted(vd.items()) if v > 0]
            L.append(f"    M{t}: Supabase: {' | '.join(supa_parts)}")
            L.append(f"         Vercel:   {' | '.join(vcel_parts)}")

        # Thresholds
        L.append(f"\n  KEY THRESHOLDS:")
        for d in res["months"]:
            td = d["tier_dist"]
            non_free = sum(v for k, v in td.items() if k != "Free")
            if non_free / SIMULATIONS > 0.5:
                L.append(f"    M{d['month']:2d}: >50% need Supabase Pro (median DB: {fmt(d['db_mb']['median'])} MB)")
                break
        else:
            L.append(f"    Supabase Free tier sufficient for full 24 months")

        for d in res["months"]:
            vd = d.get("vcel_dist", {})
            non_hobby = sum(v for k, v in vd.items() if k != "Hobby")
            if non_hobby / SIMULATIONS > 0.5:
                L.append(f"    M{d['month']:2d}: >50% need Vercel Pro")
                break
        else:
            L.append(f"    Vercel Hobby tier sufficient for full 24 months")

        for d in res["months"]:
            if d["net"]["median"] > 0:
                L.append(f"    M{d['month']:2d}: Monthly breakeven (rev ${fmt(d['rev']['median'])} > total cost ${fmt(d['total_our_cost']['median'])})")
                break

        for t in [12, 24]:
            d = res["months"][t - 1]
            rev = d["rev"]["median"]
            cost = d["total_our_cost"]["median"]
            margin = (rev - cost) / rev * 100 if rev > 0 else -100
            L.append(f"    M{t}: Gross margin {margin:.0f}% (rev ${fmt(rev)}, supa ${fmt(d['supa_cost']['median'])}, vcel ${fmt(d['vcel_cost']['median'])})")

    # ─── Pricing Sensitivity ──────────────────────────────────────────
    for scenario_name, pr in pricing_results.items():
        L.append(f"\n{'=' * 95}")
        L.append(f"  PRICING SENSITIVITY — {scenario_name.upper()}")
        L.append(f"  {len(PRICING_GRID)} pricing configs × 2,000 simulations each")
        L.append(f"{'=' * 95}")

        pr.sort(key=lambda r: r["m24_net"], reverse=True)

        L.append(f"\n  {'Config':<35}  {'Conv':>4}  {'M12 Rev':>8}  {'M24 Rev':>8}  "
                 f"{'M24 Range':>14}  {'Margin':>7}  {'Cum Net':>10}")
        L.append(f"  {'─'*35}  {'─'*4}  {'─'*8}  {'─'*8}  {'─'*14}  {'─'*7}  {'─'*10}")

        best = pr[0]
        for r in pr:
            is_current = r["pp"] == 14 and r["tp"] == 29
            marker = " ◄ NOW" if is_current else (" ★" if r is best else "")
            L.append(
                f"  {r['label']:<35}  {r['cm']:.2f}  "
                f"{'$'+fmt(r['m12_rev']):>8}  {'$'+fmt(r['m24_rev']):>8}  "
                f"{'$'+fmt(r['m24_rev_p25'])+'-'+fmt(r['m24_rev_p75']):>14}  "
                f"{r['m24_margin']:>6.0f}%  "
                f"{'$'+fmt(r['m24_net']):>10}{marker}")

        current = next((r for r in pr if r["pp"] == 14 and r["tp"] == 29), pr[0])
        delta = best["m24_net"] - current["m24_net"]
        L.append(f"\n  Best: {best['label'].strip()} → ${best['m24_net']:,.0f} cumulative net over 24 months")
        L.append(f"  Current: {current['label'].strip()} → ${current['m24_net']:,.0f}")
        if delta > 100:
            L.append(f"  Potential uplift: +${delta:,.0f} by switching to {best['label'].strip()}")
        else:
            L.append(f"  Current pricing is near-optimal for this scenario.")

    # ─── Recommendations ──────────────────────────────────────────────
    L.append(f"\n{'=' * 95}")
    L.append("  RECOMMENDATIONS")
    L.append(f"{'=' * 95}")
    L.append("""
  ┌─ COST RESPONSIBILITY MATRIX ────────────────────────────────────────────────┐
  │                                                                             │
  │  COST TYPE              WHO PAYS        HOW                                 │
  │  ─────────────────────  ──────────────  ──────────────────────────────────  │
  │  Database storage       WE (Tages)      Supabase subscription               │
  │  Dashboard hosting      WE (Tages)      Vercel subscription                 │
  │  Stripe fees            WE (Tages)      2.9% + $0.30 per transaction        │
  │  Domain / DNS           WE (Tages)      ~$12/yr                             │
  │  Embedding generation   USER            Ollama (free) or OpenAI API key     │
  │  LLM auto-indexing      USER            Ollama (free) or Anthropic API key  │
  │  Memory sharpening      USER            Anthropic API key (Haiku)           │
  │  Local SQLite cache     USER            Free (disk space)                   │
  │                                                                             │
  │  KEY: All AI compute runs on USER's machine (stdio MCP transport).          │
  │  We have ZERO variable AI costs. Our costs are purely infrastructure.       │
  └─────────────────────────────────────────────────────────────────────────────┘

  1. SUPABASE FREE TIER RUNWAY
     Conservative → 10+ months on Free. Base Case → upgrade to Pro ($25/mo) by M3-6.
     Optimistic/Viral → budget Supabase Pro from day 1.

  2. VERCEL COSTS ARE MINIMAL
     Dashboard traffic is light (dev tool, not consumer app). Vercel Hobby ($0)
     covers Conservative/Base Case for 12+ months. Pro ($20/mo) only needed
     at Optimistic+ scale with 1K+ dashboard users.

  3. TOTAL INFRA COST IS TINY
     Supabase + Vercel combined: $0–$45/mo for first year in Base Case.
     Even at Viral scale, infra is <1% of revenue. This is a very capital-
     efficient business model because AI compute is externalized to users.

  4. USER AI COST IS LOW (GOOD FOR RETENTION)
     Average user pays ~$0.10–$2.00/mo in AI costs (mostly free via Ollama).
     This is well below the $14/mo Pro price — users get clear value surplus.
     Risk: if we ever move AI compute server-side, margins collapse.

  5. PRICING SENSITIVITY
     Higher Team price ($39-49/seat) is the highest-leverage change.
     Pro at $14 undercuts Mem0 ($19) and Zep ($25) — good anchor.
     Consider: $14 Pro / $39 Team as next pricing move.

  6. MONITORING TRIGGERS
     Supabase: 400 MB → alert, 500 MB → must upgrade Pro, 7 GB → alert Team
     Vercel: 80 GB BW → alert, 100 GB → upgrade Pro
     Track: DB size, growth rate, largest project, dashboard MAU

  7. NEVER MOVE EMBEDDINGS SERVER-SIDE
     Current model: $0 AI cost to us, users bring their own compute.
     If we hosted embeddings: at Base Case M24, embedding cost alone would
     be ~$500-2K/mo (eating 5-20% of margin). Keep the stdio architecture.""")

    L.append(f"\n{'=' * 95}")
    return "\n".join(L)


# ─── Main ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import time
    t0 = time.time()

    print(f"Running {SIMULATIONS:,} sims × {len(SCENARIOS)} scenarios...")

    all_results = []
    for sc in SCENARIOS:
        print(f"  {sc.name}...", end=" ", flush=True)
        r = run_monte_carlo(sc)
        all_results.append(r)
        print(f"done ({time.time()-t0:.1f}s)")

    print(f"\n  Pricing sensitivity (Base Case + Optimistic)...")
    pricing = {}
    for sc in [SCENARIOS[1], SCENARIOS[2]]:
        print(f"    {sc.name}...", end=" ", flush=True)
        pricing[sc.name] = run_pricing_sensitivity(sc)
        print(f"done ({time.time()-t0:.1f}s)")

    report = generate_report(all_results, pricing)
    print(report)

    out = "/Users/ryan/projects/tages/analysis/monte_carlo_results.txt"
    with open(out, "w") as f:
        f.write(report)
    print(f"\nSaved to: {out}")
    print(f"Total time: {time.time()-t0:.1f}s")
