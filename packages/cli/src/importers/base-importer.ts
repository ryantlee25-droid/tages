import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { createSupabaseClient } from '@tages/shared'
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

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
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
      await supabase
        .from('memories')
        .update({ value: mem.value, updated_at: now })
        .eq('id', existing.id)
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

      await supabase.from('memories').insert({
        id: memory.id,
        project_id: memory.projectId,
        key: memory.key,
        value: memory.value,
        type: memory.type,
        source: memory.source,
        confidence: memory.confidence,
        file_paths: memory.filePaths,
        tags: memory.tags,
      })
      result.created++
    }
  }

  return result
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
