import {
  writeAuthFile as sharedWriteAuthFile,
  readAuthFile as sharedReadAuthFile,
  type StoredAuth,
} from '@tages/shared'
import { getConfigDir } from '../config/paths.js'

export type { StoredAuth }

/**
 * `auth.json` access for the CLI.
 *
 * The implementation moved to `@tages/shared` when the MCP server had to write
 * this file too: Supabase rotates the refresh token on every refresh and marks
 * the previous one used, so a long-lived server that refreshes without saving
 * the replacement spends the CLI's credential and leaves it permanently
 * invalid. Two independent writers for one credential file is exactly the bug
 * that once left `auth.json` at 0644, so there is one implementation and these
 * wrappers only supply the CLI's own notion of where the config directory is.
 */
export function writeAuthFile(auth: StoredAuth): void {
  sharedWriteAuthFile(auth, { configDir: getConfigDir() })
}

export function readAuthFile(): StoredAuth | null {
  return sharedReadAuthFile({ configDir: getConfigDir() })
}
