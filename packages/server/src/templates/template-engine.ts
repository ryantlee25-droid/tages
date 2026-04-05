import type { Memory, MemoryType } from '@tages/shared'

export interface TemplateField {
  name: string
  description: string
  required: boolean
  default?: string
}

export interface MemoryTemplate {
  id: string
  name: string
  description: string
  memoryType: MemoryType
  filePatterns: RegExp[]  // Match against file paths
  contentPatterns?: RegExp[]  // Match against file content
  fields: TemplateField[]
  keyPrefix: string
}

export interface FilledTemplate {
  templateId: string
  fields: Record<string, string>
}

export interface TemplateMatch {
  template: MemoryTemplate
  matchedFile?: string
  missingFields: string[]
}

export class TemplateEngine {
  private templates: Map<string, MemoryTemplate> = new Map()

  registerTemplate(template: MemoryTemplate): void {
    this.templates.set(template.id, template)
  }

  getTemplate(id: string): MemoryTemplate | undefined {
    return this.templates.get(id)
  }

  listTemplates(): MemoryTemplate[] {
    return [...this.templates.values()]
  }

  /**
   * Given a list of file paths, return all templates that match.
   */
  matchTemplates(filePaths: string[]): TemplateMatch[] {
    const matches: TemplateMatch[] = []

    for (const template of this.templates.values()) {
      let matchedFile: string | undefined

      for (const filePath of filePaths) {
        if (template.filePatterns.some(p => p.test(filePath))) {
          matchedFile = filePath
          break
        }
      }

      if (matchedFile) {
        const missingFields = template.fields.filter(f => f.required && !f.default).map(f => f.name)
        matches.push({ template, matchedFile, missingFields })
      }
    }

    return matches
  }

  /**
   * Apply a filled template to create a Memory object.
   */
  applyTemplate(template: MemoryTemplate, filled: FilledTemplate, projectId: string, filePaths: string[]): Memory {
    const now = new Date().toISOString()
    const keySlug = Object.values(filled.fields).slice(0, 1)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30) || 'template'
    const key = `${template.keyPrefix}-${keySlug}-${Date.now().toString(36).slice(-4)}`

    const valueParts: string[] = []
    for (const field of template.fields) {
      const val = filled.fields[field.name] ?? field.default ?? ''
      if (val) valueParts.push(`${field.name}: ${val}`)
    }

    return {
      id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      projectId,
      key,
      value: valueParts.join('. '),
      type: template.memoryType,
      source: 'agent',
      status: 'live',
      confidence: 0.9,
      filePaths,
      tags: ['from-template', template.id],
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Validate a filled template — checks all required fields are present and non-empty.
   */
  validateFilledTemplate(template: MemoryTemplate, filled: FilledTemplate): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    for (const field of template.fields) {
      if (field.required && !filled.fields[field.name] && !field.default) {
        errors.push(`Required field "${field.name}" is missing`)
      }
    }
    return { valid: errors.length === 0, errors }
  }
}
