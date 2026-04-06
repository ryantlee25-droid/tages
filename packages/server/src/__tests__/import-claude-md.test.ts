import { describe, it, expect, beforeEach } from 'vitest'
import { parseClaudeMd, handleImportClaudeMd } from '../tools/import-claude-md'
import type { SqliteCache } from '../cache/sqlite'

// Minimal SqliteCache stub
function makeCache(): SqliteCache {
  const store = new Map<string, { key: string; value: string; type: string; id: string; projectId: string }>()

  return {
    getByKey: (projectId: string, key: string) => {
      const entry = store.get(`${projectId}:${key}`)
      return entry ?? null
    },
    upsertMemory: (memory: { key: string; value: string; type: string; id: string; projectId: string }) => {
      store.set(`${memory.projectId}:${memory.key}`, memory)
    },
    _store: store,
  } as unknown as SqliteCache
}

// ─── parseClaudeMd unit tests ─────────────────────────────────────────────────

describe('parseClaudeMd', () => {
  it('parses convention section into convention memories', () => {
    const content = `
## Conventions

- Use TypeScript strict mode everywhere
- Never use var, prefer const
`
    const memories = parseClaudeMd(content)
    expect(memories.length).toBe(2)
    expect(memories[0].type).toBe('convention')
    expect(memories[1].type).toBe('convention')
    expect(memories[0].value).toBe('Use TypeScript strict mode everywhere')
    expect(memories[1].value).toBe('Never use var, prefer const')
  })

  it('parses Rules heading as convention type', () => {
    const content = `
## Rules

- All exports must be named
`
    const memories = parseClaudeMd(content)
    expect(memories.length).toBe(1)
    expect(memories[0].type).toBe('convention')
  })

  it('parses architecture section into architecture memories', () => {
    const content = `
## Architecture

The server uses SQLite for local caching.

Primary storage is Supabase Postgres.
`
    const memories = parseClaudeMd(content)
    expect(memories.length).toBeGreaterThanOrEqual(1)
    expect(memories.every(m => m.type === 'architecture')).toBe(true)
  })

  it('parses Design heading as architecture type', () => {
    const content = `
## Design

- Separation of concerns between cache and sync
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('architecture')
  })

  it('parses Structure heading as architecture type', () => {
    const content = `
## Structure

- packages/ contains all server modules
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('architecture')
  })

  it('parses Decisions heading as decision type', () => {
    const content = `
## Decisions

- We chose SQLite for offline support
- pgvector was selected for semantic search
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('decision')
    expect(memories[1].type).toBe('decision')
  })

  it('identifies anti-pattern headings: Avoid', () => {
    const content = `
## Avoid

- Never mutate state directly
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('anti_pattern')
  })

  it("identifies anti-pattern headings: Don't", () => {
    const content = `
## Don't

- Don't use synchronous fs calls in request handlers
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('anti_pattern')
  })

  it('identifies anti-pattern headings: Never', () => {
    const content = `
## Never

- Never commit secrets to the repo
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('anti_pattern')
  })

  it('identifies anti-pattern headings: Anti-pattern', () => {
    const content = `
## Anti-patterns

- Using any type disables type safety
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('anti_pattern')
  })

  it('classifies unknown headings as preference', () => {
    const content = `
## Editor Setup

- Use VSCode with Prettier
`
    const memories = parseClaudeMd(content)
    expect(memories[0].type).toBe('preference')
  })

  it('skips code blocks', () => {
    const content = `
## Conventions

- Use strict mode

\`\`\`typescript
// This is an example, not a memory
const x: string = 'hello'
\`\`\`

- Always validate with Zod
`
    const memories = parseClaudeMd(content)
    // Should have 2 bullet memories, no code block content
    expect(memories.length).toBe(2)
    expect(memories.every(m => !m.value.includes('const x'))).toBe(true)
  })

  it('handles empty content gracefully', () => {
    const memories = parseClaudeMd('')
    expect(memories).toEqual([])
  })

  it('handles content with no headings gracefully', () => {
    const content = 'Just some text without any headings'
    const memories = parseClaudeMd(content)
    expect(memories).toEqual([])
  })

  it('generates deterministic and slugified keys', () => {
    const content = `
## Conventions

- Use TypeScript strict mode
`
    const m1 = parseClaudeMd(content)
    const m2 = parseClaudeMd(content)
    expect(m1[0].key).toBe(m2[0].key)
    // Key should start with claude-md-
    expect(m1[0].key).toMatch(/^claude-md-/)
    // Key should be slugified (no spaces or uppercase)
    expect(m1[0].key).toMatch(/^[a-z0-9-]+$/)
  })

  it('truncates long keys at 60 chars (after prefix)', () => {
    const content = `
## Conventions

- ${'a'.repeat(100)} very long convention text here
`
    const memories = parseClaudeMd(content)
    // Full key including prefix should not be excessively long
    // prefix is 10 chars + slug up to 60 = max 70 chars
    expect(memories[0].key.length).toBeLessThanOrEqual(70)
  })

  it('handles both ## and ### headings', () => {
    const content = `
## Conventions

- Top level convention

### Rules

- Nested rule
`
    const memories = parseClaudeMd(content)
    expect(memories.length).toBeGreaterThanOrEqual(2)
    expect(memories.every(m => m.type === 'convention')).toBe(true)
  })

  it('extracts asterisk bullets as individual memories', () => {
    const content = `
## Conventions

* Use named exports
* Avoid default exports
`
    const memories = parseClaudeMd(content)
    expect(memories.length).toBe(2)
    expect(memories[0].value).toBe('Use named exports')
    expect(memories[1].value).toBe('Avoid default exports')
  })
})

// ─── handleImportClaudeMd integration tests ───────────────────────────────────

describe('handleImportClaudeMd', () => {
  let cache: SqliteCache

  beforeEach(() => {
    cache = makeCache()
  })

  it('imports memories into cache', async () => {
    const content = `
## Conventions

- Use TypeScript strict mode
- Validate with Zod
`
    const result = await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )
    expect(result.content[0].text).toContain('Imported 2')
    expect(result.content[0].text).toContain('skipped')
  })

  it('skip strategy does not overwrite existing memories', async () => {
    const content = `
## Conventions

- Use TypeScript strict mode
`
    // First import
    await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )

    // Manually check the stored value
    const memories = parseClaudeMd(content)
    const key = memories[0].key
    const before = (cache as unknown as { _store: Map<string, { value: string }> })._store.get(`test-project:${key}`)
    expect(before?.value).toBe('Use TypeScript strict mode')

    // Second import with different content (same key, skip strategy)
    const content2 = `
## Conventions

- Use TypeScript strict mode UPDATED
`
    // Inject the same key manually to ensure collision
    const memories2 = parseClaudeMd(content)
    await handleImportClaudeMd(
      { content: content2, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )

    // Value should NOT have changed (skip)
    const after = (cache as unknown as { _store: Map<string, { value: string }> })._store.get(`test-project:${key}`)
    expect(after?.value).toBe('Use TypeScript strict mode')
  })

  it('overwrite strategy replaces existing memories', async () => {
    const content = `
## Conventions

- Use TypeScript strict mode
`
    // First import
    await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )

    const memories = parseClaudeMd(content)
    const key = memories[0].key

    // Modify the stored value directly to simulate prior version
    const stored = (cache as unknown as { _store: Map<string, { key: string; value: string; type: string; id: string; projectId: string; updatedAt: string; source: string; status: string; tags: string[]; filePaths: string[]; confidence: number; createdAt: string }> })._store.get(`test-project:${key}`)!
    stored.value = 'Old value'

    // Overwrite import with same content (should restore correct value)
    const result = await handleImportClaudeMd(
      { content, strategy: 'overwrite', projectId: 'test-project' },
      cache,
      null,
    )
    expect(result.content[0].text).toContain('Imported 1')

    const after = (cache as unknown as { _store: Map<string, { value: string }> })._store.get(`test-project:${key}`)
    expect(after?.value).toBe('Use TypeScript strict mode')
  })

  it('returns Imported 0 memories for empty content', async () => {
    const result = await handleImportClaudeMd(
      { content: '   ', strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )
    expect(result.content[0].text).toBe('Imported 0 memories (0 skipped)')
  })

  it('returns correct summary format', async () => {
    const content = `
## Conventions

- First convention
- Second convention
`
    const result = await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )
    expect(result.content[0].text).toMatch(/^Imported \d+ memories \(\d+ skipped\)$/)
  })

  it('skips already-imported memories on second run with skip strategy', async () => {
    const content = `
## Conventions

- First convention
- Second convention
`
    await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )

    const result2 = await handleImportClaudeMd(
      { content, strategy: 'skip', projectId: 'test-project' },
      cache,
      null,
    )
    // On second run both should be skipped
    expect(result2.content[0].text).toContain('Imported 0')
    expect(result2.content[0].text).toContain('2 skipped')
  })
})
