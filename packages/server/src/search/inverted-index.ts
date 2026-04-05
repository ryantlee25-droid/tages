/**
 * In-memory Inverted Index for full-text token search.
 *
 * Supports single-token search with TF-IDF-inspired scoring,
 * and phrase search using positional data.
 */
import { tokenize } from './tokenizer'

export interface IndexSearchResult {
  id: string
  score: number
}

interface Posting {
  docId: string
  positions: number[] // positions of this token in the document
  tf: number          // term frequency
}

export class InvertedIndex {
  // token → list of postings
  private index = new Map<string, Posting[]>()
  // docId → total token count (for TF normalization)
  private docLengths = new Map<string, number>()
  // Total number of documents
  private docCount = 0

  /**
   * Add or update a document in the index.
   */
  addDocument(id: string, text: string): void {
    const tokens = tokenize(text)
    if (tokens.length === 0) return

    // Remove old postings for this doc if re-indexing
    this.removeDocument(id)

    this.docLengths.set(id, tokens.length)
    this.docCount++

    // Build position index
    const positionMap = new Map<string, number[]>()
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const positions = positionMap.get(token) || []
      positions.push(i)
      positionMap.set(token, positions)
    }

    // Add to inverted index
    for (const [token, positions] of positionMap) {
      const posting: Posting = {
        docId: id,
        positions,
        tf: positions.length / tokens.length,
      }
      const postings = this.index.get(token) || []
      postings.push(posting)
      this.index.set(token, postings)
    }
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): void {
    if (!this.docLengths.has(id)) return
    this.docLengths.delete(id)
    this.docCount = Math.max(0, this.docCount - 1)

    for (const [token, postings] of this.index) {
      const filtered = postings.filter(p => p.docId !== id)
      if (filtered.length === 0) {
        this.index.delete(token)
      } else {
        this.index.set(token, filtered)
      }
    }
  }

  /**
   * Search for documents matching a query.
   * Uses TF-IDF scoring: high TF + low DF = high score.
   */
  search(query: string): IndexSearchResult[] {
    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const scores = new Map<string, number>()

    for (const token of queryTokens) {
      const postings = this.index.get(token) || []
      if (postings.length === 0) continue

      // IDF = log(N / df + 1), smoothed
      const df = postings.length
      const idf = Math.log((this.docCount + 1) / (df + 1)) + 1

      for (const posting of postings) {
        const tfidf = posting.tf * idf
        scores.set(posting.docId, (scores.get(posting.docId) || 0) + tfidf)
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
  }

  /**
   * Phrase search: require all query tokens to appear in sequence.
   */
  phraseSearch(phrase: string): IndexSearchResult[] {
    const tokens = tokenize(phrase)
    if (tokens.length === 0) return []
    if (tokens.length === 1) return this.search(phrase)

    // Get candidate documents that contain ALL tokens
    let candidates: Set<string> | null = null
    for (const token of tokens) {
      const postings = this.index.get(token) || []
      const docSet = new Set(postings.map(p => p.docId))
      if (candidates === null) {
        candidates = docSet
      } else {
        for (const id of candidates) {
          if (!docSet.has(id)) candidates.delete(id)
        }
      }
    }
    if (!candidates || candidates.size === 0) return []

    // For each candidate, verify sequence positions
    const results: IndexSearchResult[] = []

    for (const docId of candidates) {
      const firstTokenPostings = this.index.get(tokens[0])
      if (!firstTokenPostings) continue
      const firstPosting = firstTokenPostings.find(p => p.docId === docId)
      if (!firstPosting) continue

      // Check if any start position forms a complete sequence
      let matchCount = 0
      for (const startPos of firstPosting.positions) {
        let isSequence = true
        for (let i = 1; i < tokens.length; i++) {
          const tokenPostings = this.index.get(tokens[i]) || []
          const posting = tokenPostings.find(p => p.docId === docId)
          if (!posting || !posting.positions.includes(startPos + i)) {
            isSequence = false
            break
          }
        }
        if (isSequence) matchCount++
      }

      if (matchCount > 0) {
        const docLen = this.docLengths.get(docId) || 1
        results.push({ id: docId, score: matchCount / docLen * tokens.length })
      }
    }

    return results.sort((a, b) => b.score - a.score)
  }

  /**
   * Get the number of indexed documents.
   */
  size(): number {
    return this.docLengths.size
  }
}
