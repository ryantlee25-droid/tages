# Tages Benchmark Rubric

10-point evaluation framework for measuring AI coding agent implementation quality with and without Tages project memory. Each metric scored 1-10 by an evaluator (Claude Opus) reviewing full diffs against known ground truth.

---

## Scoring categories

Three categories, weighted by what memory can influence.

- **Memory-dependent (1-4):** Dimensions that require project-specific knowledge not inferable from code reading alone. This is where Tages creates separation.
- **Code quality (5-8):** Standard engineering quality. Good agents score well here regardless of memory. Tages should not hurt these scores.
- **Operational (9-10):** Production readiness and completeness. Modest lift expected from memory because the agent spends less time exploring and more time building.

---

## Memory-dependent metrics

### 1. Convention compliance

Does the output follow project-specific coding patterns, naming conventions, file organization, and style rules that exist in the codebase but aren't enforced by linters?

**What to look for:**
- Naming patterns (file names, function names, variable conventions)
- File placement and module organization
- Project-specific idioms (e.g., rich text tag usage, custom error handling patterns)
- Style choices that are consistent across the codebase but undocumented

**Why memory matters:** Conventions live in patterns across files, not in any single file. Agents without memory default to generic best practices. Agents with memory match the project's actual patterns.

**Prior benchmark results:** 9/10 with brief vs 5-8/10 without. Largest consistent gap across all four benchmarks.

---

### 2. Integration wiring

Does new code connect to existing subsystems at the correct hook points, or does it create orphaned modules that compile but never execute in context?

**What to look for:**
- New handlers registered in the correct dispatcher or router
- Event listeners attached at the right lifecycle points
- Imports from the correct shared modules
- No "dead code" that exists in isolation from the running system

**Why memory matters:** Knowing where to hook in requires understanding the system's wiring diagram. Code reading shows what exists. Memory tells you where new code should connect.

**Prior benchmark results:** Pre-flight brief was the only approach that wired into combat.ts and movement.ts correctly. Both MCP-call and baseline produced dead code.

---

### 3. Gotcha avoidance

Does the implementation avoid known pitfalls, footguns, and antipatterns that have been previously documented as project lessons?

**What to look for:**
- Known edge cases handled proactively
- Antipatterns from project history not repeated
- Workarounds for known framework or library bugs applied
- Configuration gotchas respected (e.g., Supabase upsert must not include id field)

**Why memory matters:** Gotchas are learned from past failures. They don't appear in the code as warnings. Only someone who has hit the problem before (or been told about it) knows to avoid it.

**Prior benchmark results:** 9/10 with brief vs 3-5/10 without. The brief's gotcha section surfaces antipatterns and lessons as imperative rules.

---

### 4. API and utility reuse

Does the agent use existing shared helpers, message formats, internal APIs, and utility functions rather than reinventing equivalent functionality?

**What to look for:**
- Shared helper functions imported and used (not reimplemented)
- Existing message format utilities applied to new output
- Internal API endpoints called instead of rebuilding logic
- Common patterns (logging, error handling, validation) using project utilities

**Why memory matters:** Agents without memory don't know shared utilities exist unless they happen to read the right file. Memory surfaces these as integration recipes with specific import paths and usage examples.

**Prior benchmark results:** Both brief and baseline used shared message helpers, but only the brief agent used rich text tag utilities (rt.item, rt.condition, rt.keyword).

---

## Code quality metrics

### 5. Functional correctness

Does the implementation actually work? All requirements met, no runtime errors, edge cases handled, expected behavior verified.

**What to look for:**
- All stated requirements implemented
- No runtime errors or crashes
- Edge cases identified and handled
- Expected inputs produce expected outputs

---

### 6. Code quality

Readability, maintainability, appropriate abstractions, no dead code, no unnecessary complexity. Would a senior engineer approve this in review?

**What to look for:**
- Clear naming and structure
- Appropriate level of abstraction (not over-engineered, not spaghetti)
- No unnecessary duplication
- Comments where needed, not where obvious

---

### 7. Test coverage

Are tests written? Do they cover critical paths, edge cases, and failure modes? Are they meaningful or just checking that code runs without throwing?

**What to look for:**
- Tests exist for new functionality
- Critical paths covered (happy path + primary failure modes)
- Edge cases tested
- Tests are specific (assert behavior, not just "no error")

---

### 8. Architecture fit

Does the new code respect the existing architecture's patterns, boundaries, and separation of concerns? Or does it introduce a foreign paradigm?

**What to look for:**
- Module boundaries respected
- Data flow follows existing patterns
- No circular dependencies introduced
- Separation of concerns maintained

---

## Operational metrics

### 9. Completeness

Are all requirements from the prompt implemented? No missing features, no TODO stubs left behind, no "exercise for the reader" gaps.

**What to look for:**
- Every requirement from the prompt addressed
- No placeholder implementations
- No missing error states or empty catch blocks
- Feature works end-to-end, not just partially

---

### 10. Production readiness

Error handling, logging, type safety, security considerations. Could this ship without a follow-up cleanup pass?

**What to look for:**
- Errors caught and handled meaningfully
- Appropriate logging for debugging
- Type safety (no implicit any, no unsafe casts)
- No hardcoded secrets, no SQL injection vectors, no unvalidated input

---

## Reporting format

### Per-benchmark output

| Metric | With Tages | Without | Delta |
|---|---|---|---|
| 1. Convention compliance | /10 | /10 | |
| 2. Integration wiring | /10 | /10 | |
| 3. Gotcha avoidance | /10 | /10 | |
| 4. API and utility reuse | /10 | /10 | |
| 5. Functional correctness | /10 | /10 | |
| 6. Code quality | /10 | /10 | |
| 7. Test coverage | /10 | /10 | |
| 8. Architecture fit | /10 | /10 | |
| 9. Completeness | /10 | /10 | |
| 10. Production readiness | /10 | /10 | |
| **Overall average** | **/10** | **/10** | |
| **Memory-dependent avg (1-4)** | **/10** | **/10** | |

### Summary statistics to always report

- Overall average (all 10 metrics)
- Memory-dependent average (metrics 1-4 only)
- Gotchas avoided (count out of known gotchas for the task)
- Cost (total API spend, USD)
- Latency (wall clock time, seconds)

The memory-dependent cluster is the primary story. Overall average is the headline. Cost and latency prove the approach is economically viable.

---

## Benchmark protocol

1. Select a real codebase with known conventions, integration points, and documented gotchas
2. Define an implementation task that requires touching multiple subsystems
3. Run the same task with identical prompts, tools, and budget caps
4. Evaluate with Claude Opus reviewing full diffs against known ground truth
5. Judge scores each metric independently on the 1-10 scale
6. Report all 10 scores, both averages, and operational metrics (cost, latency, tokens)

**Control variables:** Same model, same prompt, same tool access, same budget cap. The only variable is whether Tages brief is injected into the system prompt.
