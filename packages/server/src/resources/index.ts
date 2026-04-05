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
}
