import { describe, it, expect } from 'vitest'
import { RememberSchema, RecallSchema, ForgetSchema, ContextSchema, SessionEndSchema, MemoryTypeSchema } from '../schemas'

describe('Schemas', () => {
  describe('MemoryTypeSchema', () => {
    it('accepts valid types', () => {
      for (const type of ['convention', 'decision', 'architecture', 'entity', 'lesson', 'preference', 'pattern']) {
        expect(MemoryTypeSchema.parse(type)).toBe(type)
      }
    })

    it('rejects invalid types', () => {
      expect(() => MemoryTypeSchema.parse('invalid')).toThrow()
    })
  })

  describe('RememberSchema', () => {
    it('validates valid input', () => {
      const result = RememberSchema.parse({
        key: 'test-key',
        value: 'test-value',
        type: 'convention',
      })
      expect(result.key).toBe('test-key')
    })

    it('rejects empty key', () => {
      expect(() => RememberSchema.parse({ key: '', value: 'v', type: 'convention' })).toThrow()
    })

    it('accepts optional filePaths and tags', () => {
      const result = RememberSchema.parse({
        key: 'k',
        value: 'v',
        type: 'convention',
        filePaths: ['lib/auth.ts'],
        tags: ['auth'],
      })
      expect(result.filePaths).toEqual(['lib/auth.ts'])
      expect(result.tags).toEqual(['auth'])
    })
  })

  describe('RecallSchema', () => {
    it('validates valid input with defaults', () => {
      const result = RecallSchema.parse({ query: 'auth' })
      expect(result.query).toBe('auth')
      expect(result.limit).toBe(5) // default
    })

    it('rejects empty query', () => {
      expect(() => RecallSchema.parse({ query: '' })).toThrow()
    })

    it('rejects limit > 50', () => {
      expect(() => RecallSchema.parse({ query: 'q', limit: 100 })).toThrow()
    })
  })

  describe('ForgetSchema', () => {
    it('validates valid input', () => {
      const result = ForgetSchema.parse({ key: 'to-delete' })
      expect(result.key).toBe('to-delete')
    })
  })

  describe('ContextSchema', () => {
    it('validates file path', () => {
      const result = ContextSchema.parse({ filePath: 'lib/auth.ts' })
      expect(result.filePath).toBe('lib/auth.ts')
    })
  })

  describe('SessionEndSchema', () => {
    it('validates summary', () => {
      const result = SessionEndSchema.parse({ summary: 'Built the auth flow' })
      expect(result.summary).toBe('Built the auth flow')
    })

    it('accepts optional extractMemories', () => {
      const result = SessionEndSchema.parse({ summary: 'test', extractMemories: false })
      expect(result.extractMemories).toBe(false)
    })
  })
})
