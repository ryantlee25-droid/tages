import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadProjectConfig } from '../config/project.js'

/**
 * Resolution must never silently target the wrong project.
 *
 * Before this suite, `loadProjectConfig` looked for a `.tages/config.json`
 * marker in the CURRENT directory only, then fell back to the first project
 * config file alphabetically. Running `tages remember` from a subdirectory of a
 * linked repo therefore wrote to whatever project sorted first.
 *
 * Precedence under test: `--project` flag > directory marker (found by walking
 * up) > directory-name match (same walk) > a fallback guarded to the case where
 * exactly one project is configured.
 */
describe('project resolution', () => {
  let tmpHome: string
  let projectsDir: string
  let origHome: string | undefined
  let origCwd: string
  let workDirs: string[]

  beforeEach(() => {
    origHome = process.env.HOME
    origCwd = process.cwd()
    workDirs = []
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tages-resolve-home-'))
    process.env.HOME = tmpHome
    projectsDir = path.join(tmpHome, '.config', 'tages', 'projects')
    fs.mkdirSync(projectsDir, { recursive: true })
  })

  afterEach(() => {
    process.chdir(origCwd)
    process.env.HOME = origHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
    for (const d of workDirs) fs.rmSync(d, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  /** Registers a configured project in the temp home. */
  function writeProjectConfig(slug: string, projectId: string): void {
    fs.writeFileSync(
      path.join(projectsDir, `${slug}.json`),
      JSON.stringify({ slug, projectId }),
    )
  }

  /** Creates a tracked temp working directory. */
  function makeWorkDir(prefix: string): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    workDirs.push(d)
    return d
  }

  /** Writes a `tages link` style marker into `dir`. */
  function writeMarker(dir: string, slug: string): void {
    fs.mkdirSync(path.join(dir, '.tages'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.tages', 'config.json'), JSON.stringify({ slug }))
  }

  /**
   * Captures a `process.exit` call. The real implementation never returns, so
   * the stub throws to stop execution the same way.
   */
  function stubExit() {
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`)
    }) as never)
    return { errors, exit }
  }

  it('resolves the linked project when run from the repo root', () => {
    const repoRoot = makeWorkDir('tages-resolve-root-')
    writeMarker(repoRoot, 'phoenix')
    writeProjectConfig('phoenix', 'phoenix-proj')
    writeProjectConfig('docgen-cloud', 'docgen-proj')

    process.chdir(repoRoot)
    const config = loadProjectConfig()

    expect(config).not.toBeNull()
    expect(config.slug).toBe('phoenix')
    expect(config.projectId).toBe('phoenix-proj')
  })

  it('resolves to the SAME project from a nested subdirectory', () => {
    const repoRoot = makeWorkDir('tages-resolve-nested-')
    writeMarker(repoRoot, 'phoenix')
    // `docgen-cloud` sorts first alphabetically — the old fallback picked it.
    writeProjectConfig('docgen-cloud', 'docgen-proj')
    writeProjectConfig('phoenix', 'phoenix-proj')

    const nested = path.join(repoRoot, 'src', 'components', 'deep')
    fs.mkdirSync(nested, { recursive: true })

    process.chdir(nested)
    const config = loadProjectConfig()

    expect(config).not.toBeNull()
    expect(config.slug).toBe('phoenix')
    expect(config.projectId).toBe('phoenix-proj')
  })

  it('does not silently pick a project when two are configured and no marker is found', () => {
    writeProjectConfig('docgen-cloud', 'docgen-proj')
    writeProjectConfig('phoenix', 'phoenix-proj')

    // A directory with no marker anywhere up the tree and a basename that
    // matches no configured project.
    const stray = makeWorkDir('tages-resolve-stray-')
    process.chdir(stray)

    const { errors, exit } = stubExit()

    expect(() => loadProjectConfig()).toThrow('process.exit:1')
    expect(exit).toHaveBeenCalledWith(1)

    const output = errors.join('\n')
    // The message must name the candidates and both escape hatches.
    expect(output).toContain('docgen-cloud')
    expect(output).toContain('phoenix')
    expect(output).toContain('--project')
    expect(output).toContain('tages link')
  })

  it('honors an explicit --project flag over the directory marker', () => {
    const repoRoot = makeWorkDir('tages-resolve-flag-')
    writeMarker(repoRoot, 'phoenix')
    writeProjectConfig('phoenix', 'phoenix-proj')
    writeProjectConfig('docgen-cloud', 'docgen-proj')

    process.chdir(repoRoot)
    const config = loadProjectConfig('docgen-cloud')

    expect(config).not.toBeNull()
    expect(config.slug).toBe('docgen-cloud')
    expect(config.projectId).toBe('docgen-proj')
  })

  it('falls back to the only configured project when exactly one exists', () => {
    writeProjectConfig('solo', 'solo-proj')

    const stray = makeWorkDir('tages-resolve-solo-')
    process.chdir(stray)

    const config = loadProjectConfig()

    expect(config).not.toBeNull()
    expect(config.slug).toBe('solo')
  })

  it('prefers a nearer directory-name match over a more distant marker', () => {
    // Guards the invariant in `project.test.ts`: a basename-configured project
    // sitting under a linked ancestor must not be repointed to the ancestor.
    const repoRoot = makeWorkDir('tages-resolve-nearest-')
    writeMarker(repoRoot, 'ancestor-slug')
    writeProjectConfig('ancestor-slug', 'ancestor-proj')
    writeProjectConfig('mysub', 'basename-proj')

    const subdir = path.join(repoRoot, 'packages', 'mysub')
    fs.mkdirSync(subdir, { recursive: true })

    process.chdir(subdir)
    const config = loadProjectConfig()

    expect(config.slug).toBe('mysub')
    expect(config.projectId).toBe('basename-proj')
  })

  it('stops the walk at the git root instead of escaping to an outer marker', () => {
    const outer = makeWorkDir('tages-resolve-gitroot-')
    writeMarker(outer, 'outer-slug')
    writeProjectConfig('outer-slug', 'outer-proj')
    writeProjectConfig('other', 'other-proj')

    // An inner repo whose root carries `.git` but no marker of its own.
    const innerRepo = path.join(outer, 'inner-repo')
    fs.mkdirSync(path.join(innerRepo, '.git'), { recursive: true })
    const innerSub = path.join(innerRepo, 'src')
    fs.mkdirSync(innerSub, { recursive: true })

    process.chdir(innerSub)

    const { exit } = stubExit()

    // The walk must stop at `inner-repo` and hit the guarded fallback rather
    // than resolving to the outer repo's marker.
    expect(() => loadProjectConfig()).toThrow('process.exit:1')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('ignores a marker whose project is not configured rather than trusting it blindly', () => {
    const repoRoot = makeWorkDir('tages-resolve-stale-')
    writeMarker(repoRoot, 'deleted-project')
    writeProjectConfig('docgen-cloud', 'docgen-proj')
    writeProjectConfig('phoenix', 'phoenix-proj')

    process.chdir(repoRoot)

    const { exit } = stubExit()

    // A stale marker must not resolve, and must not silently fall through to
    // the alphabetically-first project either.
    expect(() => loadProjectConfig()).toThrow('process.exit:1')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
