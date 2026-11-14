import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { createAuthenticatedClient } from '../auth/session.js'
import type { Memory, MemoryType } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

export interface ImportedMemory {
  key: string
  value: string
  type: MemoryType
}

export interface ImportResult {
  total: number
  created: number
  updated: number
  skipped: number
}

export async function storeImported(
  memories: ImportedMemory[],
  projectSlug?: string,
): Promise<ImportResult> {
  const config = loadProjectConfig(projectSlug)
  if (!config) throw new Error('No project configured. Run `tages init` first.')

  const result: ImportResult = { total: memories.length, created: 0, updated: 0, skipped: 0 }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Import requires cloud connection (no local-only support yet)')
  }

  // Authenticated, not a bare anon client: under RLS the anon client's
  // writes all affected zero rows and every import "succeeded" with nothing stored.
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey, {
    action: 'import memories',
  })
  const now = new Date().toISOString()

  for (const mem of memories) {
    // Check if exists
    const { data: existing } = await supabase
      .from('memories')
      .select('id, value')
      .eq('project_id', config.projectId)
      .eq('key', mem.key)
      .single()

    if (existing) {
      if (existing.value === mem.value) {
        result.skipped++
        continue
      }
      // Update
      const { data: updated, error: updateError } = await supabase
        .from('memories')
        .update({ value: mem.value, updated_at: now })
        .eq('id', existing.id)
        .select('id')
      assertWritten(updated, updateError, `update "${mem.key}"`)
      result.updated++
    } else {
      // Create
      const memory: Partial<Memory> = {
        id: randomUUID(),
        projectId: config.projectId,
        key: mem.key,
        value: mem.value,
        type: mem.type,
        source: 'import',
        confidence: 0.9,
        filePaths: [],
        tags: [],
      }

      const { data: inserted, error: insertError } = await supabase.from('memories').insert({
        id: memory.id,
        project_id: memory.projectId,
        key: memory.key,
        value: memory.value,
        type: memory.type,
        source: memory.source,
        confidence: memory.confidence,
        file_paths: memory.filePaths,
        tags: memory.tags,
      }).select('id')
      assertWritten(inserted, insertError, `create "${mem.key}"`)
      result.created++
    }
  }

  return result
}

/**
 * Throw (this module reports failure by throwing) when a write errored or
 * changed zero rows. RLS turns a read-only member's write into a zero-row
 * success, which used to be counted as created/updated.
 */
function assertWritten(data: unknown[] | null, error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Import failed to ${what}: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      `Permission denied: your role cannot ${what} on this project ` +
        '(read-only members cannot import). Nothing was changed for that memory.',
    )
  }
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
