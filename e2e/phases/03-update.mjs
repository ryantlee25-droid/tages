// Phase 03 — UPDATE: correcting a memory replaces the fact, and the old
// version is retained rather than lost.
//
// This is the phase most likely to expose a real defect, and the one no
// previous harness covered. `remember` on an existing key is an upsert keyed on
// (project_id, key). Three ways that can go wrong, each of which looks fine
// from the CLI's green output:
//
//   - a second row is inserted, so the project now holds two contradictory
//     answers and recall picks whichever ranks higher;
//   - the row updates but the embedding does not, so semantic recall keeps
//     matching the retracted text and returns the corrected value under it;
//   - the update lands with no version snapshot, so a wrong correction is
//     unrecoverable.

import { poll, pollDetail, head, tail } from '../lib/harness.mjs'
import { cli } from '../lib/cli.mjs'

export const id = '03-update'
export const title = '03 · UPDATE — a corrected memory replaces the old fact and keeps its history'

export async function run(ctx) {
  const { api, report, bins, project, ids, state } = ctx
  const A = ids.A

  const before = (await api.memoryByKey(project.id, state.keyA, 'id,value,embedding,updated_at', { token: A.token }))[0]
  if (!before) {
    report.check('baseline memory exists before update', false, 'phase 01 did not leave a row to update — update assertions cannot run')
    return
  }
  state.valueAOriginal = before.value
  const embeddingBefore = JSON.stringify(before.embedding ?? null)

  // The corrected text deliberately shares no distinctive phrase with the
  // original. That disjointness is what lets the final assertion below tell
  // "recall returns the correction" apart from "recall returns both".
  state.valueAUpdated =
    'The staging deploy gate blocks on a stale migration lock; the lock now clears itself after 90 seconds, so wait it out instead of forcing anything.'
  state.markerOld = 'migration list --linked'
  state.markerNew = 'clears itself after 90 seconds'

  const update = cli(bins.cliBin, A, ['remember', state.keyA, state.valueAUpdated, '--type', 'lesson'])
  report.check('re-`remember` on an existing key exits 0', update.code === 0, tail(update.out, 2))

  const settled = await poll(
    async () => {
      const rows = await api.memoryByKey(project.id, state.keyA, 'id,value,embedding,updated_at', { token: A.token })
      const hit = rows.find(r => r.value === state.valueAUpdated)
      return hit ? { rows, hit } : null
    },
    { timeoutMs: 45000, label: 'updated value reaches Supabase' },
  )
  report.check('the new value reaches Supabase', settled.ok, pollDetail(settled))

  const rows = settled.value?.rows ?? (await api.memoryByKey(project.id, state.keyA, 'id,value,embedding,updated_at', { token: A.token }))
  const after = settled.value?.hit ?? rows[0]

  // ---- the update must replace, not accumulate ---------------------------
  report.check(
    'the key still resolves to exactly one row (an update, not a duplicate insert)',
    rows.length === 1,
    rows.length === 1
      ? 'one row'
      : `${rows.length} rows share key "${state.keyA}" — the project now holds contradictory answers to the same question and recall ranks between them`,
  )
  report.check(
    'the row keeps its original id (references and version history stay attached)',
    after?.id === before.id,
    after?.id === before.id ? `id ${before.id}` : `id changed ${before.id} -> ${after?.id}`,
  )
  report.check('the stored value is the corrected one', after?.value === state.valueAUpdated, head(after?.value ?? '', 1))
  report.check(
    'updated_at advanced',
    after?.updated_at && before.updated_at && new Date(after.updated_at) > new Date(before.updated_at),
    `${before.updated_at} -> ${after?.updated_at}`,
  )

  // ---- the embedding must follow the text --------------------------------
  const embeddingAfter = JSON.stringify(after?.embedding ?? null)
  report.check(
    'the embedding was regenerated for the new text',
    after?.embedding != null && embeddingAfter !== embeddingBefore,
    after?.embedding == null
      ? 'embedding is NULL after update'
      : embeddingAfter === embeddingBefore
        ? 'embedding is unchanged — semantic recall still matches the retracted wording and will surface the correction only by accident'
        : 'embedding changed with the text',
  )

  // ---- history must be retained ------------------------------------------
  const versions = await api.rest(
    `/memory_versions?memory_id=eq.${before.id}&select=version,value,changed_by,created_at&order=version.desc`,
    { as: { token: A.token } },
  )
  const versionRows = Array.isArray(versions.body) ? versions.body : []
  const keptOld = versionRows.some(v => v.value === state.valueAOriginal)
  report.check(
    'the superseded value is retained as a version snapshot (a bad correction is recoverable)',
    keptOld,
    keptOld
      ? `${versionRows.length} version row(s); v${versionRows[0]?.version} holds the prior text`
      : `no snapshot of the prior value found (${versionRows.length} version rows) — an incorrect edit permanently destroys the original`,
  )

  const history = await api.rpc('memory_history', { p_memory_id: before.id }, { as: { token: A.token } })
  report.check(
    '`memory_history` RPC exposes that history to a client',
    Array.isArray(history.body) && history.body.length > 0,
    Array.isArray(history.body) ? `${history.body.length} version(s)` : `status ${history.status}`,
  )

  // ---- retrieval must reflect the correction -----------------------------
  const recall = cli(bins.cliBin, A, ['recall', 'stale migration lock deploy gate'])
  report.check('recall returns the corrected value', recall.out.includes(state.markerNew), head(recall.out, 4))
  report.check(
    'recall no longer surfaces the superseded text',
    !recall.out.includes(state.markerOld),
    recall.out.includes(state.markerOld)
      ? `retracted guidance "${state.markerOld}" is still being returned as a live answer — an agent reading this gets advice the author already withdrew`
      : 'superseded text is gone from live results',
  )
}
