/**
 * Language-aware tokenizer with Porter stemming, camelCase splitting,
 * stop word removal, and technical term handling.
 */

// Common English stop words (tech-context aware — keep technical abbreviations)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'not', 'no', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'we',
  'you', 'he', 'she', 'they', 'me', 'us', 'him', 'her', 'them',
])

// Preserve these technical terms exactly (don't lowercase or stem)
const TECHNICAL_TERMS = new Set([
  'API', 'JWT', 'OAuth', 'SQL', 'NoSQL', 'REST', 'GraphQL', 'HTTP', 'HTTPS',
  'URL', 'URI', 'JSON', 'XML', 'HTML', 'CSS', 'CLI', 'SDK', 'UI', 'UX',
  'MCP', 'RPC', 'SSE', 'WebSocket', 'CI', 'CD', 'UUID', 'ID',
])

/**
 * Split camelCase or PascalCase words into component tokens.
 * e.g. "camelCase" → ["camel", "Case"], "handleAuth" → ["handle", "Auth"]
 */
export function splitCamelCase(word: string): string[] {
  // Preserve all-uppercase (acronyms) as a single token
  if (/^[A-Z]+$/.test(word)) return [word]
  // Handle mixed: split on uppercase boundaries, but keep acronym runs together
  const parts = word.split(/(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])/)
  return parts.filter(Boolean)
}

/**
 * Simple Porter-inspired stemmer.
 * Handles common English suffixes for codebase documentation text.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word
  const w = word.toLowerCase()

  // Step 1: remove common suffixes
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3)
  if (w.endsWith('ations') && w.length > 7) return w.slice(0, -6)
  if (w.endsWith('ation') && w.length > 6) return w.slice(0, -5)
  if (w.endsWith('tion') && w.length > 6) return w.slice(0, -4)
  if (w.endsWith('ness') && w.length > 5) return w.slice(0, -4)
  if (w.endsWith('ment') && w.length > 5) return w.slice(0, -4)
  if (w.endsWith('ized') && w.length > 5) return w.slice(0, -4) + 'ize'
  if (w.endsWith('ises') && w.length > 5) return w.slice(0, -2)
  if (w.endsWith('izing') && w.length > 6) return w.slice(0, -3)
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('ers') && w.length > 5) return w.slice(0, -2)
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('s') && w.length > 4 && !w.endsWith('ss')) return w.slice(0, -1)

  return w
}

/**
 * Tokenize text into normalized, stemmed tokens.
 *
 * Process:
 * 1. Split on whitespace and punctuation
 * 2. Split camelCase
 * 3. Lowercase and stem
 * 4. Remove stop words and short tokens
 * 5. Preserve technical terms
 */
export function tokenize(text: string): string[] {
  if (!text || text.trim().length === 0) return []

  const tokens: string[] = []

  // Split on non-alphanumeric boundaries (preserve underscores within words)
  const rawWords = text.split(/[\s\-./\\,;:'"!?@#$%^&*()\[\]{}<>|=+`~]+/).filter(Boolean)

  for (const raw of rawWords) {
    // Check if it's a technical term (exact match, case-sensitive)
    if (TECHNICAL_TERMS.has(raw)) {
      tokens.push(raw.toLowerCase())
      continue
    }

    // Split snake_case
    const snakeParts = raw.split('_').filter(Boolean)

    for (const part of snakeParts) {
      // Split camelCase
      const camelParts = splitCamelCase(part)

      for (const word of camelParts) {
        const lower = word.toLowerCase()
        if (lower.length < 2) continue
        if (STOP_WORDS.has(lower)) continue
        const stemmed = stem(lower)
        if (stemmed.length >= 2) {
          tokens.push(stemmed)
        }
      }
    }
  }

  return tokens
}
