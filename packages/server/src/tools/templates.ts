import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { TemplateEngine, type FilledTemplate } from '../templates/template-engine'
import { BUILTIN_TEMPLATES } from '../templates/builtin-templates'

// Global template engine with built-ins registered
const engine = new TemplateEngine()
for (const t of BUILTIN_TEMPLATES) engine.registerTemplate(t)

export async function handleListTemplates(
  _args: Record<string, never>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const templates = engine.listTemplates()
  const lines = templates.map((t, i) =>
    `${i + 1}. [${t.id}] ${t.name} — ${t.description}\n   Type: ${t.memoryType} | Fields: ${t.fields.map(f => f.name).join(', ')}`
  )
  return {
    content: [{
      type: 'text',
      text: `Available templates (${templates.length}):\n\n${lines.join('\n\n')}`,
    }],
  }
}

export async function handleMatchTemplates(
  args: { filePaths: string[] },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const matches = engine.matchTemplates(args.filePaths)
  if (matches.length === 0) {
    return { content: [{ type: 'text', text: 'No templates match the given file paths.' }] }
  }

  const lines = matches.map(m =>
    `- [${m.template.id}] ${m.template.name} (matched: ${m.matchedFile})\n  Missing required fields: ${m.missingFields.length > 0 ? m.missingFields.join(', ') : 'none'}`
  )

  return {
    content: [{
      type: 'text',
      text: `${matches.length} template(s) match:\n\n${lines.join('\n\n')}`,
    }],
  }
}

export async function handleApplyTemplate(
  args: { templateId: string; fields: Record<string, string>; filePaths?: string[] },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const template = engine.getTemplate(args.templateId)
  if (!template) {
    return { content: [{ type: 'text', text: `Template "${args.templateId}" not found. Use list_templates to see available templates.` }] }
  }

  const filled: FilledTemplate = { templateId: args.templateId, fields: args.fields }
  const validation = engine.validateFilledTemplate(template, filled)
  if (!validation.valid) {
    return {
      content: [{
        type: 'text',
        text: `Template validation failed:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`,
      }],
    }
  }

  const memory = engine.applyTemplate(template, filled, projectId, args.filePaths ?? [])
  cache.upsertMemory(memory, true)
  cache.logTemplateFill(projectId, args.templateId, memory.key)

  if (sync) {
    const ok = await sync.remoteInsert(memory)
    if (ok) cache.markSynced([memory.id])
  }

  return {
    content: [{
      type: 'text',
      text: `Applied template "${template.name}" — created memory "${memory.key}" (${template.memoryType})`,
    }],
  }
}

export { engine as templateEngine }
