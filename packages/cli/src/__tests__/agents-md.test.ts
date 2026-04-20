import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { renderAgentsMd, routeMemory, runAudit } from '../commands/agents-md.js'

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
