import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parseCLAUDEmd } from '../importers/claude-md.js'

let dir: string | null = null

function write(content: string): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-claude-md-'))
  const file = path.join(dir, 'CLAUDE.md')
  fs.writeFileSync(file, content)
  return file
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('parseCLAUDEmd', () => {
  it("reads `tages export`'s Don't/Never section back as anti_pattern, not pattern", () => {
    const file = write(
      [
        '## Conventions',
        '- Use pnpm',
        '',
        "## Anti-patterns (Don't / Never)",
        '- Never push to main',
        '',
        '## Patterns',
        '- Repository per aggregate',
      ].join('\n'),
    )
    const byKey = Object.fromEntries(parseCLAUDEmd(file).map((m) => [m.key, m.type]))
    expect(Object.values(byKey)).toEqual(['convention', 'anti_pattern', 'pattern'])
  })

  it('a ## line inside a fenced code block does not start a new section', () => {
    const file = write(
      [
        '## Conventions',
        '- Run the formatter',
        '```md',
        '## not a heading',
        '```',
        '- Keep PRs small',
      ].join('\n'),
    )
    const memories = parseCLAUDEmd(file)
    expect(memories).toHaveLength(1)
    expect(memories[0].type).toBe('convention')
    expect(memories[0].value).toContain('## not a heading')
    expect(memories[0].value).toContain('Keep PRs small')
  })
})
