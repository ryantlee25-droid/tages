import type { SqliteCache } from '../cache/sqlite'
import { ColdStorage } from './cold-storage'
import { scoreMemory } from '../quality/memory-scorer'
import type { Memory } from '@tages/shared'
import * as path from 'path'
import * as os from 'os'

export interface AutoArchiveResult {
  archived: number
  reasons: Array<{ key: string; reason: string }>
}

export class ArchiveManager {
  private cold: ColdStorage

  constructor(dbBasePath?: string, retentionDays = 90) {
    const archivePath = dbBasePath
      ? dbBasePath.replace('.db', '-archive.db')
      : path.join(os.tmpdir(), 'tages-archive.db')
    this.cold = new ColdStorage(archivePath, retentionDays)
  }

  archiveMemory(memory: Memory, reason: string, cache: SqliteCache): void {
    this.cold.archive(memory, reason)
    cache.archiveMemory(memory.id)
  }

  restoreMemory(
    projectId: string,
    key: string,
    cache: SqliteCache,
  ): Memory | null {
    const entry = this.cold.getArchived(projectId, key)
    if (!entry) return null

    const restored: Memory = {
      ...entry.memory,
      status: 'live',
      updatedAt: new Date().toISOString(),
    }

    cache.upsertMemory(restored, true)
    this.cold.recordRestore(projectId)
    return restored
  }

  listArchived(projectId: string, limit = 50) {
    return this.cold.listArchived(projectId, limit)
  }

  getStats(projectId: string) {
    return this.cold.getStats(projectId)
  }

  /**
   * Auto-archive memories that are stale or low quality.
   * Threshold: quality score < 20 AND not accessed in 60+ days.
   */
  autoArchiveScan(
    projectId: string,
    cache: SqliteCache,
    qualityThreshold = 20,
    stalenessDays = 60,
  ): AutoArchiveResult {
    const memories = cache.getAllForProject(projectId).filter(m => m.status === 'live')
    const archived: Array<{ key: string; reason: string }> = []

    for (const mem of memories) {
      const ageDays = (Date.now() - new Date(mem.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays < stalenessDays) continue

      const accessInfo = cache.getAccessInfo(mem.id)
      const lastAccessDays = accessInfo?.lastAccessedAt
        ? (Date.now() - new Date(accessInfo.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24)
        : ageDays

      if (lastAccessDays < stalenessDays) continue

      const quality = scoreMemory(mem, memories)
      if (quality.total > qualityThreshold) continue

      const reason = `Auto-archived: ${ageDays.toFixed(0)} days old, quality=${quality.total}/100`
      this.archiveMemory(mem, reason, cache)
      archived.push({ key: mem.key, reason })
    }

    return { archived: archived.length, reasons: archived }
  }

  enforceRetention(): number {
    return this.cold.enforceRetention()
  }
}
