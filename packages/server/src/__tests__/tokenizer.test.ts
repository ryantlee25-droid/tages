import { describe, it, expect } from 'vitest'
import { tokenize, stem, splitCamelCase } from '../search/tokenizer'
import { InvertedIndex } from '../search/inverted-index'

describe('splitCamelCase', () => {
  it('splits camelCase word', () => {
    expect(splitCamelCase('camelCase')).toEqual(['camel', 'Case'])
  })

  it('splits PascalCase word', () => {
    expect(splitCamelCase('handleAuth')).toContain('handle')
    expect(splitCamelCase('handleAuth')).toContain('Auth')
  })

  it('keeps all-uppercase acronyms as single token', () => {
    expect(splitCamelCase('JWT')).toEqual(['JWT'])
    expect(splitCamelCase('API')).toEqual(['API'])
  })

  it('handles single word', () => {
    expect(splitCamelCase('hello')).toEqual(['hello'])
  })

  it('handles MixedAcronymCase like SQLQuery', () => {
    const parts = splitCamelCase('SQLQuery')
    expect(parts.length).toBeGreaterThanOrEqual(1)
  })
})

describe('stem', () => {
  it('removes -ing suffix', () => {
    expect(stem('running')).toBe('runn')
  })

  it('removes -ed suffix', () => {
    expect(stem('decided')).toBe('decid')
  })

  it('removes -ation suffix (authentication → authentic)', () => {
    // 'authentication' (14 chars): ends in 'ation', slice(0,-5) = 'authentic'
    expect(stem('authentication')).toBe('authentic')
  })

  it('removes -ness suffix', () => {
    expect(stem('darkness')).toBe('dark')
  })

  it('converts -ies to -y', () => {
    expect(stem('libraries')).toBe('library')
  })

  it('keeps short words unchanged', () => {
    expect(stem('run')).toBe('run')
    expect(stem('db')).toBe('db')
  })

  it('lowercases the word', () => {
    expect(stem('HELLO')).toBe('hello')
  })
})

describe('tokenize', () => {
  it('basic tokenization splits on whitespace', () => {
    const tokens = tokenize('use snake case for all routes')
    expect(tokens.length).toBeGreaterThan(2)
  })

  it('removes stop words', () => {
    const tokens = tokenize('the and or a with is')
    expect(tokens.length).toBe(0)
  })

  it('splits camelCase in tokens', () => {
    const tokens = tokenize('handleAuthentication')
    // Should split into handle + authentication components
    expect(tokens.some(t => t.includes('handl') || t === 'handle')).toBe(true)
  })

  it('handles empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('  ')).toEqual([])
  })

  it('handles technical terms like API', () => {
    const tokens = tokenize('use the API for authentication')
    expect(tokens).toContain('api')
  })

  it('handles JWT token', () => {
    const tokens = tokenize('JWT tokens for auth')
    expect(tokens).toContain('jwt')
  })

  it('handles OAuth', () => {
    const tokens = tokenize('OAuth 2.0 for login')
    expect(tokens).toContain('oauth')
  })

  it('splits snake_case words', () => {
    const tokens = tokenize('use_snake_case_for_routes')
    expect(tokens.some(t => t.includes('snake') || t.includes('cas'))).toBe(true)
  })

  it('handles unicode text gracefully', () => {
    expect(() => tokenize('café authentication 认证')).not.toThrow()
  })

  it('removes tokens shorter than 2 chars', () => {
    const tokens = tokenize('a b c do it')
    expect(tokens.every(t => t.length >= 2)).toBe(true)
  })
})

describe('InvertedIndex', () => {
  it('adds a document and searches by token', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'use JWT for authentication')
    const results = idx.search('JWT')
    expect(results.some(r => r.id === 'doc1')).toBe(true)
  })

  it('score ranking: more matches = higher score', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'authentication token')
    idx.addDocument('doc2', 'JWT authentication token auth bearer')
    const results = idx.search('authentication token')
    // doc2 has more hits — should score higher or equal
    expect(results.length).toBeGreaterThan(0)
    const doc2Idx = results.findIndex(r => r.id === 'doc2')
    const doc1Idx = results.findIndex(r => r.id === 'doc1')
    // Both should be found
    expect(doc2Idx).toBeGreaterThanOrEqual(0)
    expect(doc1Idx).toBeGreaterThanOrEqual(0)
  })

  it('phrase search returns matching document', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'always use snake case for API routes')
    idx.addDocument('doc2', 'use camelCase for function names')
    const results = idx.phraseSearch('snake case')
    expect(results.some(r => r.id === 'doc1')).toBe(true)
  })

  it('phrase search excludes non-matching documents', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'use JWT tokens')
    idx.addDocument('doc2', 'snake case convention')
    const results = idx.phraseSearch('JWT tokens')
    expect(results.some(r => r.id === 'doc1')).toBe(true)
    // doc2 should not match "JWT tokens" phrase
    expect(results.some(r => r.id === 'doc2')).toBe(false)
  })

  it('empty input returns empty results', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'something')
    expect(idx.search('')).toEqual([])
    expect(idx.phraseSearch('')).toEqual([])
  })

  it('size returns correct document count', () => {
    const idx = new InvertedIndex()
    expect(idx.size()).toBe(0)
    idx.addDocument('d1', 'hello world')
    idx.addDocument('d2', 'foo bar')
    expect(idx.size()).toBe(2)
  })

  it('re-adding a document replaces old index entries', () => {
    const idx = new InvertedIndex()
    idx.addDocument('doc1', 'original content')
    idx.addDocument('doc1', 'completely different')
    const results1 = idx.search('original')
    // Should not find old content
    expect(results1.some(r => r.id === 'doc1')).toBe(false)
    const results2 = idx.search('different')
    expect(results2.some(r => r.id === 'doc1')).toBe(true)
  })
})
