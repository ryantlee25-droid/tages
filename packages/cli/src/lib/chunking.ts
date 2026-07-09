/**
 * Token-aware chunking for embedding generation.
 *
 * OpenAI's text-embedding-3-small caps input at 8192 tokens. Before this
 * module existed, text over that limit got an HTTP 400 from OpenAI, and
 * because the caller (embeddings.ts / embedding.ts) only handled the
 * `if (res.ok)` branch, the 400 fell straight through to `return null` with
 * the error body never read — the memory silently got NO embedding and
 * dropped out of semantic recall with no error surfaced anywhere (see
 * embeddings.ts's header for the full bug writeup). This module splits
 * over-threshold text into overlapping chunks; the caller embeds each chunk
 * individually and mean-pools + L2-renormalizes the results into a single
 * 1536-dim vector.
 *
 * Chunk-size tuning: chunk size was initially "whatever stays comfortably
 * under the 8192-token API ceiling" (large, tens of thousands of chars). The
 * eval harness referenced in PLAN.md's "Tier-1 Retrieval-Quality Fixes" plan
 * (Task B) found retrieval accuracy peaks (~78%) at a much smaller ~4000-char
 * chunk granularity with ~15% overlap — smaller chunks produce embeddings
 * that are more semantically focused per-chunk, and the overlap keeps a fact
 * that lands near a chunk boundary from losing context on both sides.
 * CHUNK_TARGET_CHARS/CHUNK_OVERLAP_CHARS below reflect that finding.
 *
 * Pooling vs. multi-row chunk storage: the per-chunk vectors are mean-pooled
 * + renormalized into ONE 1536-dim vector per memory row, rather than stored
 * as one row per chunk in a child table with ranker-side aggregation.
 * Pooling was chosen for this pass because it requires zero schema/RPC/
 * ranker changes — every existing recall path (local SQLite cache, Supabase
 * hybrid_recall/semantic_recall RPCs, the ranker's dedup/sort) keeps working
 * completely unmodified, since recall still sees exactly one embedding per
 * memory. The tradeoff: pooling loses some of the eval's per-chunk retrieval
 * precision relative to multi-row storage (which matched the 78%-accuracy
 * result more directly by letting recall match against individual chunks
 * rather than an averaged vector). Multi-row chunk storage is left as a
 * documented follow-on if per-chunk precision proves necessary in practice —
 * it would need a child table, an aggregating RPC, and ranker changes to
 * dedup back to one result per memory, which is a materially bigger change
 * than this module's scope.
 */

// Estimate tokens: ~4 chars per token (conservative for English text).
// Mirrors packages/server/src/search/token-budget.ts's estimateTokens ratio.
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

// OpenAI's real ceiling is 8192 tokens. The char/4 estimate above is only an
// approximation — it can under-count tokens for dense, non-English, or
// code-heavy text — so the safe single-call threshold sits well below the
// real limit rather than right up against it.
export const SAFE_SINGLE_CALL_TOKEN_LIMIT = 6000

// Task B: eval-validated chunk granularity (~4000 chars, ~15% overlap).
export const CHUNK_TARGET_CHARS = 4000
export const CHUNK_OVERLAP_CHARS = 600 // 15% of CHUNK_TARGET_CHARS

export interface ChunkTextOptions {
  /** Maximum characters per chunk. Defaults to CHUNK_TARGET_CHARS. */
  chunkSizeChars?: number
  /** Characters of shared text between adjacent chunks. Defaults to CHUNK_OVERLAP_CHARS. */
  overlapChars?: number
}

/**
 * Split `text` into overlapping chunks no larger than `chunkSizeChars`
 * characters, with `overlapChars` characters of text shared between adjacent
 * chunks.
 *
 * Text that already fits in one chunk is returned as a single-element array
 * equal to the original input — no copying, no splitting. This is what lets
 * generateEmbedding's existing single-call path stay behaviorally unchanged
 * for text under the chunking threshold.
 */
export function chunkText(text: string, opts: ChunkTextOptions = {}): string[] {
  const chunkSizeChars = opts.chunkSizeChars ?? CHUNK_TARGET_CHARS
  const overlapChars = opts.overlapChars ?? CHUNK_OVERLAP_CHARS

  if (text.length <= chunkSizeChars) return [text]

  const stride = Math.max(1, chunkSizeChars - overlapChars)
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(start + chunkSizeChars, text.length)
    chunks.push(text.slice(start, end))
    if (end >= text.length) break
  }
  return chunks
}
