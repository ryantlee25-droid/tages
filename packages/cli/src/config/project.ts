import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { getProjectsDir } from './paths.js'

/** Hard bound on the ancestor walk, mirroring the `for (let i = 0; i < 10; i++)`
 *  dist-walk bound in `sync/cli-sync.ts` and `commands/harness.ts`. */
const MAX_WALK_UP_LEVELS = 10

/** Sanitize a directory basename into a candidate project slug. */
function slugFromDirName(dir: string): string {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

/** True when `<projectsDir>/<slug>.json` exists. */
function hasConfigFile(projectsDir: string, slug: string): boolean {
  return !!slug && fs.existsSync(path.join(projectsDir, `${slug}.json`))
}

/** Read the `slug` field out of a `.tages/config.json` marker, if usable. */
function readMarkerSlug(dir: string): string | null {
  const markerPath = path.join(dir, '.tages', 'config.json')
  if (!fs.existsSync(markerPath)) return null
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
    if (marker && typeof marker.slug === 'string' && marker.slug) return marker.slug
  } catch {
    // Marker corrupt — treat as absent and keep looking.
  }
  return null
}

/**
 * Detect the project slug for the current directory by walking UP the directory
 * tree from `process.cwd()`.
 *
 * At each level, in order:
 *   1. a `.tages/config.json` marker (written by `tages link`)
 *   2. the sanitized directory name
 * A candidate is only accepted if `<slug>.json` actually exists in the projects
 * dir, so a stale marker can never resolve to a project that isn't configured.
 *
 * The walk is bounded three ways: `MAX_WALK_UP_LEVELS` levels, the git root
 * (checked inclusively — the repo root is the most likely home of the marker,
 * and `.git` is a file in worktrees and a dir in normal clones, both of which
 * `existsSync` accepts), and the filesystem root.
 *
 * NOTE ON PER-LEVEL ORDERING (nearest-ancestor-wins). Marker beats directory
 * name *at the same level*, but a nearer directory-name match beats a more
 * distant marker. This is deliberate and is what the reverted W2 change got
 * wrong: checking every marker in the ancestry before any directory name
 * silently REPOINTS a basename-configured project that happens to sit in a
 * subdir of a linked repo to the ANCESTOR's slug, misrouting its memory writes.
 * `src/__tests__/project.test.ts` locks that invariant in. Nearest-wins fixes
 * the subdirectory bug without reintroducing it.
 */
function detectSlugFromCwd(projectsDir: string): string | null {
  let dir = path.resolve(process.cwd())

  for (let level = 0; level < MAX_WALK_UP_LEVELS; level++) {
    const markerSlug = readMarkerSlug(dir)
    if (markerSlug && hasConfigFile(projectsDir, markerSlug)) return markerSlug

    const dirSlug = slugFromDirName(dir)
    if (hasConfigFile(projectsDir, dirSlug)) return dirSlug

    // Stop at the git root (already checked above) and at the filesystem root.
    if (fs.existsSync(path.join(dir, '.git'))) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

/** Parse a project config file, exiting with a friendly error if it's corrupt. */
function readConfigOrExit(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    console.error(chalk.red(`Config file corrupted: ${p}`))
    console.error(chalk.dim('Run `tages init` to reconfigure.'))
    process.exit(1)
  }
}

/**
 * Loads a project config from ~/.config/tages/projects/<slug>.json.
 *
 * PRECEDENCE (highest first):
 *   1. An explicit `--project <slug>` flag.
 *   2. A `.tages/config.json` directory marker, found by walking up from cwd.
 *   3. A directory-name match, found by the same walk.
 *      (2 and 3 are evaluated per level — see `detectSlugFromCwd`.)
 *   4. A guarded fallback: the only project config on disk, if there is
 *      exactly one. With two or more and no other signal, this FAILS loudly
 *      instead of guessing.
 *
 * Returns null if no project is configured.
 * Exits with a friendly error if the config file is corrupt, or if resolution
 * is ambiguous.
 */
export function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null

  // 1. Explicit --project flag always wins.
  if (slug) {
    const p = path.join(dir, `${slug}.json`)
    if (!fs.existsSync(p)) return null
    return readConfigOrExit(p)
  }

  // 2 + 3. Directory marker / directory name, nearest ancestor first.
  const detected = detectSlugFromCwd(dir)
  if (detected) return readConfigOrExit(path.join(dir, `${detected}.json`))

  // 4. Guarded fallback. The previous behavior here was "first .json file
  // alphabetically", which silently pointed `remember`/`recall`/`status` at an
  // unrelated project whenever the walk above came up empty — a memory written
  // from an unlinked directory could land in whatever sorts first. Keeping the
  // fallback for a single configured project preserves the ordinary
  // one-project-on-disk case; guessing between several never does.
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  if (files.length === 1) return readConfigOrExit(path.join(dir, files[0]))

  const candidates = files.map(f => f.replace(/\.json$/, ''))
  console.error(chalk.red('Could not determine which project to use.'))
  console.error(
    chalk.dim(
      `No \`.tages/config.json\` marker was found in ${process.cwd()} or its parents, ` +
        'and the directory name matches no configured project.',
    ),
  )
  console.error(chalk.dim(`Configured projects: ${candidates.join(', ')}`))
  console.error('')
  console.error(chalk.dim('Pass `--project <slug>` explicitly, or run `tages link` here.'))
  return process.exit(1)
}
