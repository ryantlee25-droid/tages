import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

export function registerResources(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  cache: SqliteCache,
  sync: SupabaseSync | null,
) {
  // memory://project/{id}/conventions
  server.resource(
    'conventions',
    new ResourceTemplate('memory://project/{id}/conventions', { list: undefined }),
    { description: 'All coding conventions for this project' },
    async (uri, params) => {
      const projectId = params.id as string
      const memories = cache.getByType(projectId, 'convention')
      const text = memories.length > 0
        ? memories.map(m => `## ${m.key}\n${m.value}`).join('\n\n')
        : 'No conventions recorded.'

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // memory://project/{id}/architecture
  server.resource(
    'architecture',
    new ResourceTemplate('memory://project/{id}/architecture', { list: undefined }),
    { description: 'Architecture notes and module boundaries' },
    async (uri, params) => {
      const projectId = params.id as string
      const memories = cache.getByType(projectId, 'architecture')
      const text = memories.length > 0
        ? memories.map(m => `## ${m.key}\n${m.value}`).join('\n\n')
        : 'No architecture notes recorded.'

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // memory://project/{id}/decisions
  server.resource(
    'decisions',
    new ResourceTemplate('memory://project/{id}/decisions', { list: undefined }),
    { description: 'Decision log — why things were built the way they are' },
    async (uri, params) => {
      const projectId = params.id as string
      const memories = cache.getByType(projectId, 'decision')
      const text = memories.length > 0
        ? memories.map(m => `## ${m.key}\n${m.value}`).join('\n\n')
        : 'No decisions recorded.'

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // memory://project/{id}/entities
  server.resource(
    'entities',
    new ResourceTemplate('memory://project/{id}/entities', { list: undefined }),
    { description: 'Key entities, modules, and components in this project' },
    async (uri, params) => {
      const projectId = params.id as string
      const memories = cache.getByType(projectId, 'entity')
      const text = memories.length > 0
        ? memories.map(m => `## ${m.key}\n${m.value}`).join('\n\n')
        : 'No entities recorded.'

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )

  // memory://project/{id}/documentation_context
  // Bundled payload optimized for doc generators (DocGen, etc.)
  server.resource(
    'documentation_context',
    new ResourceTemplate('memory://project/{id}/documentation_context', { list: undefined }),
    { description: 'Complete project context bundled for documentation generation — conventions, architecture, decisions, entities, patterns, and lessons in one payload' },
    async (uri, params) => {
      const projectId = params.id as string
      const all = cache.getAllForProject(projectId)

      const grouped: Record<string, typeof all> = {}
      for (const m of all) {
        if (!grouped[m.type]) grouped[m.type] = []
        grouped[m.type].push(m)
      }

      const sections: string[] = []

      sections.push('# Project Documentation Context')
      sections.push(`> Generated from ${all.length} memories across ${Object.keys(grouped).length} types`)
      sections.push('')

      // Conventions — critical for doc tone/naming
      if (grouped.convention?.length) {
        sections.push('## Conventions')
        for (const m of grouped.convention) {
          sections.push(`### ${m.key}`)
          sections.push(m.value)
          if (m.filePaths?.length) sections.push(`_Files: ${m.filePaths.join(', ')}_`)
          sections.push('')
        }
      }

      // Architecture — module structure for diagrams
      if (grouped.architecture?.length) {
        sections.push('## Architecture')
        for (const m of grouped.architecture) {
          sections.push(`### ${m.key}`)
          sections.push(m.value)
          if (m.filePaths?.length) sections.push(`_Files: ${m.filePaths.join(', ')}_`)
          sections.push('')
        }
      }

      // Decisions — rationale for design docs
      if (grouped.decision?.length) {
        sections.push('## Decisions')
        for (const m of grouped.decision) {
          sections.push(`### ${m.key}`)
          sections.push(m.value)
          sections.push('')
        }
      }

      // Entities — key components for reference docs
      if (grouped.entity?.length) {
        sections.push('## Key Entities')
        for (const m of grouped.entity) {
          sections.push(`- **${m.key}**: ${m.value}`)
        }
        sections.push('')
      }

      // Patterns — reusable patterns for code docs
      if (grouped.pattern?.length) {
        sections.push('## Patterns')
        for (const m of grouped.pattern) {
          sections.push(`### ${m.key}`)
          sections.push(m.value)
          sections.push('')
        }
      }

      // Lessons — known issues for troubleshooting docs
      if (grouped.lesson?.length) {
        sections.push('## Lessons & Known Issues')
        for (const m of grouped.lesson) {
          sections.push(`- **${m.key}**: ${m.value}`)
        }
        sections.push('')
      }

      const text = sections.join('\n')

      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
      }
    },
  )
}
