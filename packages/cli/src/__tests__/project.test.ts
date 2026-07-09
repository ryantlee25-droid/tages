import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadProjectConfig } from '../config/project.js'

// W2 — the F7 walk-up was mirrored into detectSlugFromCwd (which backs every
// slug-dependent CLI command via loadProjectConfig). That silently repointed a
// basename-configured project sitting in a subdir under an ancestor `.tages`
// marker to the ANCESTOR's slug, misrouting memory writes. The walk-up was
// reverted here; the harness keeps its own walk-up (covered by
// harness-claude-code's detectSlug F7 test), so F7 stays fixed independently.
describe('loadProjectConfig — no ancestor walk-up (W2)', () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    origHome = process.env.HOME
    origCwd = process.cwd()
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-project-w2-'))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.chdir(origCwd)
    process.env.HOME = origHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  function writeProjectConfig(slug: string, extra: Record<string, unknown>): void {
    const projectsDir = path.join(tmpHome, '.config', 'tages', 'projects')
    fs.mkdirSync(projectsDir, { recursive: true })
    fs.writeFileSync(path.join(projectsDir, `${slug}.json`), JSON.stringify({ slug, ...extra }))
  }

  it('a basename-configured project in a subdir under an ancestor `.tages` marker resolves to its BASENAME slug', () => {
    // Ancestor repo carries a `.tages/config.json` marker with its own slug.
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-w2-repo-'))
    fs.mkdirSync(path.join(repoRoot, '.tages'), { recursive: true })
    fs.writeFileSync(
      path.join(repoRoot, '.tages', 'config.json'),
      JSON.stringify({ slug: 'ancestor-slug' }),
    )

    // A nested subdir whose basename ('mysub') is its own configured project,
    // with NO `.tages` marker of its own (basename-configured, never linked).
    const subdir = path.join(repoRoot, 'packages', 'mysub')
    fs.mkdirSync(subdir, { recursive: true })

    // Both configs exist on disk; the walk-up bug would pick 'ancestor-slug'.
    writeProjectConfig('ancestor-slug', { projectId: 'ancestor-proj' })
    writeProjectConfig('mysub', { projectId: 'basename-proj' })

    process.chdir(subdir)
    const config = loadProjectConfig()

    // Must resolve to the subdir's OWN basename project, not the ancestor's.
    expect(config).not.toBeNull()
    expect(config.slug).toBe('mysub')
    expect(config.projectId).toBe('basename-proj')

    fs.rmSync(repoRoot, { recursive: true, force: true })
  })

  it('still honors a `.tages/config.json` marker in the CURRENT directory', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-w2-linked-'))
    fs.mkdirSync(path.join(repoRoot, '.tages'), { recursive: true })
    fs.writeFileSync(
      path.join(repoRoot, '.tages', 'config.json'),
      JSON.stringify({ slug: 'linked-slug' }),
    )
    writeProjectConfig('linked-slug', { projectId: 'linked-proj' })

    process.chdir(repoRoot)
    const config = loadProjectConfig()

    expect(config).not.toBeNull()
    expect(config.slug).toBe('linked-slug')
    expect(config.projectId).toBe('linked-proj')

    fs.rmSync(repoRoot, { recursive: true, force: true })
  })
})
