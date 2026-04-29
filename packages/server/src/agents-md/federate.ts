/**
 * agents-md federate — owner-map management
 *
 * Manages `.tages/agents-md-owners.json`, a JSON file that maps canonical
 * AGENTS.md section names to team slugs.  This map is used by
 * `tages agents-md write` to filter which memories appear under each section
 * (federation by section ownership).
 *
 * Schema gap note:
 * The Tages `memories` table (migrations 0001–0053) does NOT carry a `team_id`
 * column.  Consequently, "filter memories by team" is currently a no-op at
 * query time — the owner map is stored correctly and the write command reads it,
 * but memory rows cannot yet be filtered by team.  When the schema adds
 * `team_id`, update `agentsMdWriteCommand` in cli/src/commands/agents-md.ts to
 * add a `.eq('team_id', teamSlug)` clause per section.
 */

import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'

// ------------------------------------------------------------
// Schema
// ------------------------------------------------------------

/**
 * The owners map schema: `{ "<section name>": "<team slug>" }`.
 * Section names should be one of the 6 canonical AGENTS.md sections, but the
 * schema accepts any string to allow forward-compatible custom sections.
 */
export const OwnersMapSchema = z.record(z.string(), z.string())
export type OwnersMap = z.infer<typeof OwnersMapSchema>

// ------------------------------------------------------------
// File path helper
// ------------------------------------------------------------

/**
 * Resolve the owners file path.
 * @param projectRoot  Project root directory (defaults to cwd).
 */
export function ownersFilePath(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), '.tages', 'agents-md-owners.json')
}

// ------------------------------------------------------------
// Read / Write helpers
// ------------------------------------------------------------

/**
 * Read the owners map from disk.
 * Returns an empty object if the file does not exist.
 * Throws if the file is present but not valid JSON matching the schema.
 */
export function readOwnersMap(projectRoot?: string): OwnersMap {
  const filePath = ownersFilePath(projectRoot)
  if (!fs.existsSync(filePath)) return {}

  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${String(err)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${filePath} is not valid JSON.`)
  }

  const result = OwnersMapSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `${filePath} has an unexpected shape: ${result.error.message}`,
    )
  }

  return result.data
}

/**
 * Write the owners map to disk, creating `.tages/` if absent.
 */
export function writeOwnersMap(map: OwnersMap, projectRoot?: string): void {
  const filePath = ownersFilePath(projectRoot)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(map, null, 2) + '\n', 'utf-8')
}

/**
 * Set (or overwrite) one section→team mapping.
 */
export function setOwner(section: string, team: string, projectRoot?: string): OwnersMap {
  const map = readOwnersMap(projectRoot)
  map[section] = team
  writeOwnersMap(map, projectRoot)
  return map
}

/**
 * Remove one section mapping.  Silently does nothing if absent.
 * Returns the updated map.
 */
export function removeOwner(section: string, projectRoot?: string): OwnersMap {
  const map = readOwnersMap(projectRoot)
  delete map[section]
  writeOwnersMap(map, projectRoot)
  return map
}
