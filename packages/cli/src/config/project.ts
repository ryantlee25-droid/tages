import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { getProjectsDir } from './paths.js'

/**
 * Detect the project slug from the current directory by checking for a
 * .tages/config.json marker file (written by `tages link`). Falls back
 * to the directory basename if no marker exists.
 */
function detectSlugFromCwd(): string | null {
  // Legacy resolution ONLY: a `.tages/config.json` marker in the CURRENT
  // directory, else the sanitized cwd basename. Deliberately NOT a walk-up.
  //
  // This function backs every slug-dependent CLI command (remember/recall/
  // forget/status via loadProjectConfig). A walk-up here silently REPOINTS a
  // basename-configured project (its own `<basename>.json` exists, no `tages
  // link`) to an ANCESTOR's `.tages` slug whenever it sits in a subdir under
  // one — misrouting memory writes. The harness's own slug resolution keeps a
  // walk-up (harness-claude-code's detectSlug + `tages harness` DB path), which
  // is where F7 needs it; it does NOT depend on this function.
  const markerPath = path.join(process.cwd(), '.tages', 'config.json')
  if (fs.existsSync(markerPath)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'))
      if (marker.slug && typeof marker.slug === 'string') return marker.slug
    } catch {
      // Marker corrupt — fall through to directory name detection
    }
  }
  // Fall back to sanitized directory name
  const dirName = path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return dirName || null
}

/**
 * Loads a project config from ~/.config/tages/projects/<slug>.json.
 *
 * Resolution order when no slug is given:
 *   1. .tages/config.json marker in cwd (written by `tages link`)
 *   2. Sanitized cwd directory name
 *   3. First .json file alphabetically (legacy fallback)
 *
 * Returns null if no project is configured.
 * Exits with a friendly error if the config file is corrupt.
 */
export function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch {
      console.error(chalk.red(`Config file corrupted: ${p}`))
      console.error(chalk.dim('Run `tages init` to reconfigure.'))
      process.exit(1)
    }
  }
  // Auto-detect from cwd marker or directory name
  const detected = detectSlugFromCwd()
  if (detected) {
    const p = `${dir}/${detected}.json`
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'))
      } catch {
        // Fall through to legacy behavior
      }
    }
  }
  // Legacy fallback: first file alphabetically
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  const p = `${dir}/${files[0]}`
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    console.error(chalk.red(`Config file corrupted: ${p}`))
    console.error(chalk.dim('Run `tages init` to reconfigure.'))
    process.exit(1)
  }
}
