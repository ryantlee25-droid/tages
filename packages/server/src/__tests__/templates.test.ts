import { describe, it, expect, beforeEach } from 'vitest'
import { TemplateEngine } from '../templates/template-engine'
import { BUILTIN_TEMPLATES } from '../templates/builtin-templates'
import type { MemoryTemplate, FilledTemplate } from '../templates/template-engine'

const PROJECT = 'templates-test'

function makeTemplate(overrides: Partial<MemoryTemplate> = {}): MemoryTemplate {
  return {
    id: 'test-template',
    name: 'Test Template',
    description: 'A test template',
    memoryType: 'convention',
    filePatterns: [/test-dir\//i],
    fields: [
      { name: 'name', description: 'Name', required: true },
      { name: 'optional_field', description: 'Optional', required: false, default: 'default-val' },
    ],
    keyPrefix: 'test',
    ...overrides,
  }
}

describe('TemplateEngine', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = new TemplateEngine()
  })

  it('registers and retrieves a template', () => {
    const t = makeTemplate()
    engine.registerTemplate(t)
    expect(engine.getTemplate('test-template')).toBe(t)
  })

  it('lists all registered templates', () => {
    engine.registerTemplate(makeTemplate({ id: 'a' }))
    engine.registerTemplate(makeTemplate({ id: 'b' }))
    expect(engine.listTemplates()).toHaveLength(2)
  })

  it('matches template by file path', () => {
    engine.registerTemplate(makeTemplate())
    const matches = engine.matchTemplates(['test-dir/foo.ts'])
    expect(matches).toHaveLength(1)
    expect(matches[0].template.id).toBe('test-template')
  })

  it('returns empty array when no templates match', () => {
    engine.registerTemplate(makeTemplate())
    const matches = engine.matchTemplates(['unrelated/path.ts'])
    expect(matches).toHaveLength(0)
  })

  it('identifies missing required fields', () => {
    engine.registerTemplate(makeTemplate())
    const matches = engine.matchTemplates(['test-dir/foo.ts'])
    expect(matches[0].missingFields).toContain('name')
    expect(matches[0].missingFields).not.toContain('optional_field')
  })

  it('validates filled template — passes with all required fields', () => {
    const t = makeTemplate()
    engine.registerTemplate(t)
    const filled: FilledTemplate = { templateId: 'test-template', fields: { name: 'MyThing' } }
    const result = engine.validateFilledTemplate(t, filled)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('validates filled template — fails with missing required field', () => {
    const t = makeTemplate()
    const filled: FilledTemplate = { templateId: 'test-template', fields: {} }
    const result = engine.validateFilledTemplate(t, filled)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('name')
  })

  it('applies template to create a memory', () => {
    const t = makeTemplate()
    engine.registerTemplate(t)
    const filled: FilledTemplate = { templateId: 'test-template', fields: { name: 'MyComponent' } }
    const memory = engine.applyTemplate(t, filled, PROJECT, ['test-dir/foo.ts'])
    expect(memory.type).toBe('convention')
    expect(memory.projectId).toBe(PROJECT)
    expect(memory.tags).toContain('from-template')
    expect(memory.tags).toContain('test-template')
    expect(memory.value).toContain('MyComponent')
  })

  it('includes default values in applied template', () => {
    const t = makeTemplate()
    engine.registerTemplate(t)
    const filled: FilledTemplate = { templateId: 'test-template', fields: { name: 'Thing' } }
    const memory = engine.applyTemplate(t, filled, PROJECT, [])
    expect(memory.value).toContain('default-val')
  })

  it('registration rejects duplicate template id via overwrite', () => {
    engine.registerTemplate(makeTemplate({ id: 'same' }))
    engine.registerTemplate(makeTemplate({ id: 'same', name: 'Different Name' }))
    expect(engine.getTemplate('same')?.name).toBe('Different Name')
  })
})

describe('BUILTIN_TEMPLATES', () => {
  let engine: TemplateEngine

  beforeEach(() => {
    engine = new TemplateEngine()
    for (const t of BUILTIN_TEMPLATES) engine.registerTemplate(t)
  })

  it('has 5 built-in templates', () => {
    expect(engine.listTemplates()).toHaveLength(5)
  })

  it('matches api-endpoint for routes directory', () => {
    const matches = engine.matchTemplates(['routes/users.ts'])
    const ids = matches.map(m => m.template.id)
    expect(ids).toContain('api-endpoint')
  })

  it('matches react-component for tsx files', () => {
    const matches = engine.matchTemplates(['components/Button.tsx'])
    const ids = matches.map(m => m.template.id)
    expect(ids).toContain('react-component')
  })

  it('matches database-migration for migration files', () => {
    const matches = engine.matchTemplates(['supabase/migrations/0023_new.sql'])
    const ids = matches.map(m => m.template.id)
    expect(ids).toContain('database-migration')
  })

  it('matches test-suite for test files', () => {
    const matches = engine.matchTemplates(['src/__tests__/foo.test.ts'])
    const ids = matches.map(m => m.template.id)
    expect(ids).toContain('test-suite')
  })

  it('matches cli-command for commands directory', () => {
    const matches = engine.matchTemplates(['commands/dedup.ts'])
    const ids = matches.map(m => m.template.id)
    expect(ids).toContain('cli-command')
  })
})
