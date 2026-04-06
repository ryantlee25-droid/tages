import type { Memory } from '@tages/shared'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const DEFAULT_BUDGET = 3000

/**
 * Generate a token-budgeted project brief for system prompt injection.
 * Prioritizes actionable gotchas and integration recipes over descriptive prose.
 *
 * Structure (in priority order):
 *  1. STOP: Gotchas — anti-patterns and lessons, formatted as imperative rules
 *  2. Integration Recipes — how to wire new features (extracted from patterns/execution)
 *  3. Conventions — coding standards, formatted as terse rules with code snippets
 *  4. Architecture — system overview (truncated if budget tight)
 *  5. Decisions — why things are the way they are
 *  6. Remaining types
 */
export async function handleBrief(
  args: { task?: string; budget?: number },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const budget = args.budget || DEFAULT_BUDGET

  const allMemories = cache.getAllForProject(projectId)

  if (allMemories.length === 0) {
    return {
      content: [{ type: 'text', text: 'No memories stored. Use `remember` to build project knowledge.' }],
    }
  }

  // Group by type
  const grouped: Record<string, Memory[]> = {}
  for (const m of allMemories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }

  // Sort each group by confidence descending
  for (const items of Object.values(grouped)) {
    items.sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
  }

  const sections: string[] = []
  let estimatedTokens = 0

  const header = `# Project Brief\n_Tages context — ${allMemories.length} memories. Follow these rules._\n`
  sections.push(header)
  estimatedTokens += estimateTokens(header)

  // ── 1. GOTCHAS (anti_pattern + lesson) — imperative, terse ──
  const gotchaItems = [...(grouped.anti_pattern || []), ...(grouped.lesson || [])]
  if (gotchaItems.length > 0) {
    const section = formatImperativeSection('STOP — Read Before Coding', gotchaItems)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // ── 2. INTEGRATION RECIPES (execution + pattern) — step-by-step wiring ──
  const recipeItems = [...(grouped.execution || []), ...(grouped.pattern || [])]
  if (recipeItems.length > 0) {
    const section = formatRecipeSection('Integration Recipes', recipeItems)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // ── 3. CONVENTIONS — terse rules, code-formatted where possible ──
  if (grouped.convention) {
    const section = formatConventionSection('Conventions', grouped.convention)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // ── 4. ARCHITECTURE — descriptive, lower priority ──
  if (grouped.architecture) {
    const section = formatSection('Architecture', grouped.architecture)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // ── 5. DECISIONS ──
  if (grouped.decision) {
    const section = formatSection('Decisions', grouped.decision)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // ── 6. Remaining types ──
  const covered = new Set(['anti_pattern', 'lesson', 'execution', 'pattern', 'convention', 'architecture', 'decision'])
  for (const group of [
    { types: ['entity'], title: 'Key Entities' },
    { types: ['operational'], title: 'Operational' },
    { types: ['environment'], title: 'Environment' },
    { types: ['preference'], title: 'Preferences' },
  ]) {
    const items: Memory[] = []
    for (const t of group.types) {
      if (grouped[t]) items.push(...grouped[t])
      covered.add(t)
    }
    if (items.length === 0) continue
    const section = formatSection(group.title, items)
    estimatedTokens = appendIfBudget(sections, section, estimatedTokens, budget)
  }

  // Task context
  if (args.task) {
    const taskSection = `\n## Current Task\n${args.task}\n`
    estimatedTokens = appendIfBudget(sections, taskSection, estimatedTokens, budget)
  }

  sections.push(`\n---\n_~${estimatedTokens} tokens | Generated ${new Date().toISOString()}_\n`)

  return {
    content: [{ type: 'text', text: sections.join('\n') }],
  }
}

// ── Formatters ──

/**
 * Gotchas as imperative rules: "DO NOT", "ALWAYS", "NEVER".
 * Extracts the actionable part of each memory value.
 */
function formatImperativeSection(title: string, items: Memory[]): string {
  const lines = [`## ${title}\n`]

  for (const item of items) {
    // Extract imperative form: bold the key, then the rule
    const value = item.value
    lines.push(`- **${item.key}**: ${value}`)
    if (item.filePaths?.length) {
      lines.push(`  → \`${item.filePaths.join('`, `')}\``)
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Patterns and execution flows as step-by-step recipes.
 * Highlights file paths as code and uses numbered steps when the value contains them.
 */
function formatRecipeSection(title: string, items: Memory[]): string {
  const lines = [`## ${title}\n`]

  for (const item of items) {
    lines.push(`### ${item.key}`)
    // If value contains arrow sequences or numbered steps, preserve formatting
    const value = item.value
    if (value.includes('→') || value.includes('1.') || value.includes(' then ')) {
      lines.push(value)
    } else {
      lines.push(`- ${value}`)
    }
    if (item.filePaths?.length) {
      lines.push(`_Touch: \`${item.filePaths.join('`, `')}\`_`)
    }
    lines.push('')
  }

  return lines.join('\n') + '\n'
}

/**
 * Conventions as terse rules. Detects code-like content (function names,
 * file paths, tags) and wraps them in backticks for emphasis.
 */
function formatConventionSection(title: string, items: Memory[]): string {
  const lines = [`## ${title}\n`]

  for (const item of items) {
    // Auto-detect and backtick-wrap common code patterns in the value
    const value = highlightCodePatterns(item.value)
    lines.push(`- **${item.key}**: ${value}`)
    if (item.filePaths?.length) {
      lines.push(`  → \`${item.filePaths.join('`, `')}\``)
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Default section format for architecture, decisions, etc.
 */
function formatSection(title: string, items: Memory[]): string {
  const lines = [`## ${title}\n`]

  for (const item of items) {
    lines.push(`- **${item.key}**: ${item.value}`)
    if (item.filePaths?.length) {
      lines.push(`  → \`${item.filePaths.join('`, `')}\``)
    }
  }

  return lines.join('\n') + '\n'
}

/**
 * Detect code-like tokens in convention text and wrap them in backticks.
 * Matches: function names (camelCase with parens), file paths, HTML-like tags,
 * environment variables, and common code identifiers.
 */
function highlightCodePatterns(text: string): string {
  return text
    // File paths: lib/foo.ts, src/bar/baz.ts, data/*.ts
    .replace(/(?<![`\w])([a-zA-Z_][a-zA-Z0-9_]*(?:\/[a-zA-Z0-9_.*-]+)+\.[a-zA-Z]+)(?![`\w])/g, '`$1`')
    // Function calls: functionName(), msg(), rt.item()
    .replace(/(?<![`\w])([a-zA-Z_][a-zA-Z0-9_.]*\(\))(?![`\w])/g, '`$1`')
    // HTML-like tags: <item>, <npc>, <enemy>
    .replace(/(?<!`)(<[a-z_]+>)(?!`)/g, '`$1`')
    // Environment variables: NEXT_PUBLIC_*, TAGES_*
    .replace(/(?<![`\w])([A-Z][A-Z0-9_]{3,}(?:=[a-z]+)?)(?![`\w])/g, '`$1`')
}

/**
 * Append a section if it fits within budget. Returns new token count.
 * If the full section doesn't fit, tries a truncated version (top 3 items).
 */
function appendIfBudget(sections: string[], section: string, currentTokens: number, budget: number): number {
  const tokens = estimateTokens(section)
  if (currentTokens + tokens <= budget) {
    sections.push(section)
    return currentTokens + tokens
  }
  // Budget exceeded — don't add
  return currentTokens
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
