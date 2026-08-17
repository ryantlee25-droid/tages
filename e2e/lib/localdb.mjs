// Read an identity's local SQLite cache directly.
//
// This exists because of a false pass. Phase 10 originally asserted "the CLI
// pulled a cloud memory into the local store" by running `tages recall --all`
// and checking the output — but `recall --all` is a plain PostgREST
// `from('memories').select()` against Supabase (see the header of
// 0068_recall_service_role_bypass.sql), so it answers from the cloud and never
// touches local state. The check passed while proving nothing.
//
// The only way to prove a pull happened is to open the SQLite file the CLI
// writes and look. Reads are opened read-only so the suite can never perturb
// the state it is measuring.

import { DatabaseSync } from 'node:sqlite'
import * as fs from 'fs'

/**
 * Open an identity's cache read-only and run `fn(db)`. Returns null when the
 * cache does not exist — an absent cache is a legitimate observation, not an
 * error, and callers assert on it.
 */
export function withLocalDb(identity, slug, fn) {
  const path = identity.cachePath(slug)
  if (!fs.existsSync(path)) return null
  let db
  try {
    db = new DatabaseSync(path, { readOnly: true })
    return fn(db)
  } finally {
    try {
      db?.close()
    } catch {
      /* nothing actionable if the handle is already gone */
    }
  }
}

/** Every locally cached memory, as { key, value, dirty }. */
export function localMemories(identity, slug) {
  return (
    withLocalDb(identity, slug, db => {
      // The column set has grown over time; select defensively so a schema
      // addition cannot break the suite.
      const cols = db
        .prepare(`PRAGMA table_info(memories)`)
        .all()
        .map(c => c.name)
      const dirtyCol = cols.includes('dirty') ? 'dirty' : `0 as dirty`
      return db.prepare(`SELECT key, value, ${dirtyCol} FROM memories`).all()
    }) ?? []
  )
}

/** One locally cached memory by key, or null. */
export function localMemory(identity, slug, key) {
  return localMemories(identity, slug).find(m => m.key === key) ?? null
}

/** Rows still awaiting a push. A permanently non-empty set is a stuck sync queue. */
export function localDirty(identity, slug) {
  return localMemories(identity, slug).filter(m => Number(m.dirty) === 1)
}
