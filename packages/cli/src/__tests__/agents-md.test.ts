import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { renderAgentsMd, routeMemory, runAudit } from '../commands/agents-md.js'

// Direct imports from server source for diff + federate tests.
// Paths are relative from packages/cli/src/__tests__/ up to packages/server/src/agents-md/.
// @ts-ignore
import { computeAgentsMdDiff } from '../../../server/src/agents-md/diff.js'
// @ts-ignore
import { readOwnersMap, writeOwnersMap, setOwner, removeOwner, ownersFilePath } from '../../../server/src/agents-md/federate.js'

describe('renderAgentsMd', () => {
  it('emits all 6 canonical sections even when memory list is empty', () => {
    const md = renderAgentsMd('demo', [])
    expect(md).toContain('## Commands')
    expect(md).toContain('## Testing')
    expect(md).toContain('## Project structure')
    expect(md).toContain('## Code style')
    expect(md).toContain('## Git workflow')
    expect(md).toContain('## Boundaries')
  })

  it('routes conventions into Code style', () => {
    const md = renderAgentsMd('demo', [
      {
        key: 'snake-case-routes',
        value: 'Always use snake_case for API routes',
        type: 'convention',
      },
    ])
    const codeStyle = md.split('## Code style')[1]?.split('## ')[0] ?? ''
    expect(codeStyle).toContain('snake-case-routes')
  })

  it('renders the three-tier Always/Ask/Never structure in Boundaries', () => {
    const md = renderAgentsMd('demo', [
      { key: 'no-default-export', value: 'Never use default exports', type: 'anti_pattern' },
      { key: 'mock-db-careful', value: "Don't mock the database in integration tests", type: 'lesson' },
      { key: 'spaces-not-tabs', value: 'Use 2-space indentation', type: 'preference' },
    ])
    expect(md).toContain('Always do (✅)')
    expect(md).toContain('Ask first (⚠️)')
    expect(md).toContain('Never do (🚫)')
    expect(md).toContain('Never use default exports')
    expect(md).toContain("Don't mock the database")
    expect(md).toContain('Use 2-space indentation')
  })

  it('places execution memories under Commands by default', () => {
    const md = renderAgentsMd('demo', [
      { key: 'run-dev', value: 'Run pnpm dev to start the dashboard', type: 'execution' },
    ])
    const commands = md.split('## Commands')[1]?.split('## ')[0] ?? ''
    expect(commands).toContain('run-dev')
    expect(commands).toContain('pnpm dev')
  })
})

describe('routeMemory', () => {
  it('routes anti_pattern to Boundaries', () => {
    expect(routeMemory({ key: 'x', value: 'y', type: 'anti_pattern' })).toEqual(['Boundaries'])
  })

  it('respects explicit tag override', () => {
    expect(
      routeMemory({ key: 'x', value: 'y', type: 'convention', tags: ['Testing'] }),
    ).toEqual(['Testing'])
  })

  it('routes architecture to Project structure', () => {
    expect(routeMemory({ key: 'x', value: 'y', type: 'architecture' })).toContain('Project structure')
  })

  it('routes git-keyed memory to Git workflow', () => {
    expect(
      routeMemory({ key: 'git-commit-style', value: 'Use imperative mood', type: 'execution' }),
    ).toContain('Git workflow')
  })
})

describe('runAudit', () => {
  it('passes a well-formed AGENTS.md fixture', () => {
    const content = `# AGENTS.md

## Commands
- **install** — run \`pnpm install\`
- **test** — run \`pnpm test\`

## Testing
- Tests live in \`__tests__/\` — run \`pytest -v\`

## Project structure
- React 18 with TypeScript 5.4 and Vite 5

## Code style
- Always use snake_case for API routes

## Git workflow
- Branch naming: \`feat/\`, \`fix/\`, \`chore/\`

## Boundaries
**Always do (✅)**
- Commit after every green test run

**Ask first (⚠️)**
- Don't mock the database

**Never do (🚫)**
- Never force-push to main
`
    const report = runAudit('AGENTS.md', content)
    expect(report.passed).toBe(true)
    expect(report.findings.filter((f) => f.severity === 'error')).toHaveLength(0)
  })

  it('fails a deliberately vague fixture', () => {
    const content = `# AGENTS.md

You are a helpful coding assistant. Follow best practices. Test your changes and format code properly.

## Project structure
Just a React project.
`
    const report = runAudit('AGENTS.md', content)
    expect(report.passed).toBe(false)
    const rules = report.findings.map((f) => f.rule)
    expect(rules).toContain('missing-section') // several
    expect(rules).toContain('vagueness')
    expect(report.findings.filter((f) => f.severity === 'error').length).toBeGreaterThan(0)
  })

  it('flags missing Commands runnable snippets', () => {
    const content = `# AGENTS.md

## Commands
Just talk about commands, don't actually name any.

## Testing
- Tests run with pytest

## Project structure
- React 18.3 with TypeScript 5.4

## Code style
- snake_case routes

## Git workflow
- feat/ branches

## Boundaries
**Always do (✅)** — commit after green tests
**Never do (🚫)** — don't force push
`
    const report = runAudit('AGENTS.md', content)
    const missing = report.findings.find((f) => f.rule === 'missing-commands')
    expect(missing).toBeTruthy()
  })

  it('extracts the LAST section without requiring a trailing header or literal "Z" (regression for \\Z bug)', () => {
    // If the last section's body is never extracted, missing-commands on a
    // trailing "## Commands" section would silently not fire. This test locks
    // the fix in place.
    const content = `# AGENTS.md

## Project structure
Just a React project with no version numbers.

## Commands
No runnable invocations here.`
    const report = runAudit('AGENTS.md', content)
    // Must fire on BOTH last-section aware rules:
    const rules = report.findings.map((f) => f.rule)
    expect(rules).toContain('missing-commands') // Commands section is last; body must be extracted
    expect(rules).toContain('missing-tech-versions') // Project structure is middle; also extracted
  })

  it('writes and reads via a real tmp file round-trip', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-agents-md-'))
    const tmpFile = path.join(tmpDir, 'AGENTS.md')
    const content = renderAgentsMd('tmp', [
      { key: 'run-dev', value: 'pnpm dev', type: 'execution' },
    ])
    fs.writeFileSync(tmpFile, content, 'utf-8')
    const report = runAudit(tmpFile, fs.readFileSync(tmpFile, 'utf-8'))
    expect(report.path).toBe(tmpFile)
    expect(report.findings.some((f) => f.rule === 'missing-section' && f.section === 'Boundaries')).toBe(false) // Boundaries is always emitted
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

// ------------------------------------------------------------
// diff tests
// ------------------------------------------------------------

describe('computeAgentsMdDiff', () => {
  it('returns clean when AGENTS.md fully reflects memory', () => {
    // A memory whose value appears verbatim in the file
    const memories = [
      { key: 'use-snake-case', value: 'Always use snake_case for API routes', type: 'convention' },
    ]
    const content = `# AGENTS.md

## Commands
- run pnpm install

## Testing
- pytest -v

## Project structure
- Node 20

## Code style
- **use-snake-case** — Always use snake_case for API routes

## Git workflow
- feat/ branches

## Boundaries
**Always do (✅)**
- commit after green tests
**Ask first (⚠️)**
- ask before big refactor
**Never do (🚫)**
- Never force-push to main
`
    const report = computeAgentsMdDiff('AGENTS.md', content, memories)
    expect(report.clean).toBe(true)
    expect(report.driftCount).toBe(0)
  })

  it('reports stale when memory not reflected in AGENTS.md section', () => {
    const memories = [
      { key: 'important-rule', value: 'Always use TypeScript strict mode for all new files', type: 'convention' },
    ]
    // Code style section exists but doesn't mention the memory
    const content = `# AGENTS.md

## Commands
- run pnpm install

## Testing
- run pytest

## Project structure
- Node 20

## Code style
- Use 2-space indentation

## Git workflow
- feat/ branches

## Boundaries
**Always do (✅)**
- commit after green tests
**Ask first (⚠️)**
- ask before refactor
**Never do (🚫)**
- Never force push
`
    const report = computeAgentsMdDiff('AGENTS.md', content, memories)
    expect(report.clean).toBe(false)
    expect(report.driftCount).toBeGreaterThan(0)
    const staleItem = report.items.find((i: { kind: string }) => i.kind === 'stale')
    expect(staleItem).toBeTruthy()
    expect(staleItem?.memoryKey).toBe('important-rule')
  })

  it('reports missing when AGENTS.md section heading is absent but memories exist', () => {
    const memories = [
      { key: 'commit-style', value: 'Use imperative mood in commit messages', type: 'convention', tags: ['Git workflow'] },
    ]
    // Git workflow section is missing
    const content = `# AGENTS.md

## Commands
- pnpm install

## Testing
- pytest

## Project structure
- Node 20

## Code style
- snake_case

## Boundaries
**Always do (✅)**
- commit
**Ask first (⚠️)**
- ask
**Never do (🚫)**
- never
`
    const report = computeAgentsMdDiff('AGENTS.md', content, memories)
    expect(report.clean).toBe(false)
    const missingItem = report.items.find((i: { kind: string }) => i.kind === 'missing')
    expect(missingItem).toBeTruthy()
    expect(missingItem?.section).toBe('Git workflow')
  })

  it('reports contradicting when AGENTS.md negates a memory', () => {
    const memories = [
      { key: 'default-exports', value: 'Use default exports for React components', type: 'convention' },
    ]
    // Code style section directly contradicts the memory
    const content = `# AGENTS.md

## Commands
- pnpm install

## Testing
- pytest

## Project structure
- Node 20

## Code style
- Never use default exports for React components. Always use named exports.

## Git workflow
- feat/ branches

## Boundaries
**Always do (✅)**
- commit
**Ask first (⚠️)**
- ask
**Never do (🚫)**
- never
`
    const report = computeAgentsMdDiff('AGENTS.md', content, memories)
    expect(report.clean).toBe(false)
    const contradictingItem = report.items.find((i: { kind: string }) => i.kind === 'contradicting')
    expect(contradictingItem).toBeTruthy()
    expect(contradictingItem?.section).toBe('Code style')
  })

  it('exits with driftCount > 0 and items populated for any drift', () => {
    const memories = [
      { key: 'use-zod', value: 'Validate all inputs with Zod schemas', type: 'convention' },
    ]
    const content = `# AGENTS.md

## Code style
- No validation needed.
`
    const report = computeAgentsMdDiff('fixture.md', content, memories)
    // At minimum: many sections are missing, generating missing drift items
    expect(report.driftCount).toBeGreaterThan(0)
    expect(report.items.length).toBe(report.driftCount)
    expect(report.filePath).toBe('fixture.md')
  })
})

// ------------------------------------------------------------
// federate tests
// ------------------------------------------------------------

describe('federate owner-map', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-federate-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('readOwnersMap returns empty object when file does not exist', () => {
    const map = readOwnersMap(tmpDir)
    expect(map).toEqual({})
  })

  it('setOwner writes valid JSON and readOwnersMap reads it back', () => {
    const result = setOwner('Security', 'security', tmpDir)
    expect(result).toEqual({ Security: 'security' })

    // Verify file is valid JSON
    const filePath = ownersFilePath(tmpDir)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed).toEqual({ Security: 'security' })

    // Round-trip read
    const mapBack = readOwnersMap(tmpDir)
    expect(mapBack).toEqual({ Security: 'security' })
  })

  it('setOwner accumulates multiple section mappings', () => {
    setOwner('Security', 'security', tmpDir)
    setOwner('Testing', 'platform', tmpDir)
    const map = readOwnersMap(tmpDir)
    expect(map).toEqual({ Security: 'security', Testing: 'platform' })
  })

  it('removeOwner deletes the entry and leaves others intact', () => {
    setOwner('Security', 'security', tmpDir)
    setOwner('Testing', 'platform', tmpDir)
    const updated = removeOwner('Security', tmpDir)
    expect(updated).toEqual({ Testing: 'platform' })

    const mapBack = readOwnersMap(tmpDir)
    expect(mapBack).not.toHaveProperty('Security')
    expect(mapBack).toHaveProperty('Testing', 'platform')
  })

  it('removeOwner is a no-op when section does not exist', () => {
    setOwner('Testing', 'platform', tmpDir)
    const updated = removeOwner('NonExistent', tmpDir)
    expect(updated).toEqual({ Testing: 'platform' })
  })

  it('ownersFilePath returns a path ending with agents-md-owners.json inside .tages/', () => {
    const p = ownersFilePath(tmpDir)
    expect(p).toContain('.tages')
    expect(p).toContain('agents-md-owners.json')
  })

  it('writeOwnersMap creates .tages/ directory if absent', () => {
    const nestedDir = path.join(tmpDir, 'nested-project')
    fs.mkdirSync(nestedDir)
    writeOwnersMap({ Commands: 'devex' }, nestedDir)
    const filePath = ownersFilePath(nestedDir)
    expect(fs.existsSync(filePath)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual({ Commands: 'devex' })
  })
})

// ------------------------------------------------------------
// write + owners map integration
// ------------------------------------------------------------

describe('renderAgentsMd with federation awareness', () => {
  it('renderAgentsMd output is deterministic regardless of owner map (no memory filtering yet — team_id schema gap)', () => {
    // Since team_id is absent from the schema, renderAgentsMd output should be
    // identical whether or not an owner map exists.  This test documents the
    // current behaviour and will need updating when team_id lands.
    const memories = [
      { key: 'use-snake-case', value: 'Always snake_case routes', type: 'convention' },
      { key: 'run-tests', value: 'pnpm test', type: 'execution', tags: ['Testing'] },
    ]
    const withoutOwners = renderAgentsMd('demo', memories)
    // Simulate owner map existing (rendering does not change — gap documented)
    const withOwners = renderAgentsMd('demo', memories)
    expect(withoutOwners).toEqual(withOwners)
    // Both should contain the memory regardless of owner map
    expect(withoutOwners).toContain('use-snake-case')
    expect(withoutOwners).toContain('run-tests')
  })
})
