import chalk from 'chalk'
import type { createSupabaseClient } from '@tages/shared'
import { generateChunkEmbeddings, generateEmbedding } from './embedding.js'

/**
 * Give freshly promoted (pending -> live) memories an embedding so semantic
 * recall can find them.
 *
 * Rows staged by `observe`, `session_end`, imports or a seeded test were often
 * written with no embedding. `tages verify` / `tages pending --approve-all`
 * flipped them to live, and then recall's semantic pass (embedding IS NOT
 * NULL) never saw them. This fills only rows whose embedding is still null.
 *
 * Same provider path as `tages remember`: generateChunkEmbeddings' pooled
 * vector, falling back to generateEmbedding, so promoted rows land in the
 * same vector space as everything else. Pooled embedding only: no
 * `memory_chunks` rows (the server backfill and later edits cover those).
 *
 * Rows with `encrypted = true` are skipped: the value is ciphertext here and
 * embedding it would index garbage. The MCP server, which holds the key,
 * embeds those.
 *
 * Never throws. A failure prints one warning and does not undo the approval.
 */
export async function embedPromoted(
  supabase: ReturnType<typeof createSupabaseClient>,
  projectId: string,
  keys: string[],
  opts: { concurrency?: number; supabaseUrl?: string } = {},
): Promise<{ embedded: number; failed: number }> {
  const result = { embedded: 0, failed: 0 }
  if (keys.length === 0) return result

  try {
    const rows: Array<{ key: string; value: string; embedding: unknown; encrypted?: boolean | null }> = []
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100)
      const { data, error } = await supabase
        .from('memories')
        .select('key, value, embedding, encrypted')
        .eq('project_id', projectId)
        .in('key', batch)
      if (error) throw new Error(error.message)
      rows.push(...((data ?? []) as typeof rows))
    }

    const todo = rows.filter((r) => r.embedding == null && !r.encrypted && typeof r.value === 'string' && r.value.length > 0)
    if (todo.length === 0) return result

    const accessToken = await resolveAccessToken(supabase)
    const embedOpts = { supabaseUrl: opts.supabaseUrl, accessToken, projectId }

    const embedOne = async (row: (typeof todo)[number]) => {
      try {
        let vector: number[] | null = null
        try {
          vector = (await generateChunkEmbeddings(row.value, embedOpts))?.pooled ?? null
        } catch {
          vector = null
        }
        if (!vector) vector = await generateEmbedding(row.value)
        if (!vector) {
          result.failed++
          return
        }
        const { data, error } = await supabase
          .from('memories')
          .update({ embedding: `[${vector.join(',')}]` })
          .eq('project_id', projectId)
          .eq('key', row.key)
          .select('id')
        if (error || !Array.isArray(data) || data.length === 0) {
          result.failed++
          return
        }
        result.embedded++
      } catch {
        result.failed++
      }
    }

    const concurrency = Math.max(1, opts.concurrency ?? 4)
    let next = 0
    const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (next < todo.length) {
        const row = todo[next++]
        await embedOne(row)
      }
    })
    await Promise.all(workers)
  } catch (err) {
    // Count whatever was not reached as failed so the caller's warning is honest.
    const reached = result.embedded + result.failed
    result.failed += Math.max(0, keys.length - reached)
    console.error(
      chalk.yellow(`Warning: could not generate embeddings for approved memories: ${(err as Error).message}`),
    )
    return result
  }

  if (result.failed > 0) {
    console.error(
      chalk.yellow(
        `Warning: ${result.failed} approved ${result.failed === 1 ? 'memory has' : 'memories have'} no embedding yet; ` +
          'they are live but semantic recall may miss them until they are re-embedded.',
      ),
    )
  }
  return result
}

async function resolveAccessToken(
  supabase: ReturnType<typeof createSupabaseClient>,
): Promise<string | undefined> {
  if (process.env.TAGES_SERVICE_KEY) return undefined
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? undefined
  } catch {
    return undefined
  }
}
