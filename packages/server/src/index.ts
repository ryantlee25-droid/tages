#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createSupabaseClient } from '@tages/shared'
import { z } from 'zod'

import { loadServerConfig } from './config'
import { SqliteCache } from './cache/sqlite'
import { SupabaseSync } from './sync/supabase-sync'
import { SessionTracker } from './tracking'
import { registerResources } from './resources'
import { handleRemember } from './tools/remember'
import { handleRecall } from './tools/recall'
import { handleForget } from './tools/forget'
import { handleConventions } from './tools/conventions'
import { handleArchitecture } from './tools/architecture'
import { handleDecisions } from './tools/decisions'
import { handleContext } from './tools/context'
import { handleStaleness } from './tools/staleness'
import { handleConflicts } from './tools/conflicts'
import { handleStats } from './tools/stats'
import { handleSessionEnd } from './tools/session-end'
import { handleObserve } from './tools/observe'
import { handleVerifyMemory, handlePendingMemories } from './tools/verify'
import { RememberSchema, RecallSchema, ForgetSchema, ContextSchema, SessionEndSchema, VerifyMemorySchema } from './schemas'

async function main() {
  const config = loadServerConfig()

  // Initialize SQLite cache (works even without Supabase)
  const cachePath = config?.cachePath || '/tmp/tages-default.db'
  const cache = new SqliteCache(cachePath)
  const projectId = config?.project.projectId || 'local'

  // Initialize Supabase sync if configured
  let sync: SupabaseSync | null = null
  let supabaseClient = null
  if (config?.project.supabaseUrl && config?.project.supabaseAnonKey) {
    supabaseClient = createSupabaseClient(
      config.project.supabaseUrl,
      config.project.supabaseAnonKey,
    )
    sync = new SupabaseSync(supabaseClient, cache, projectId)

    // Hydrate cache from Supabase
    const count = await sync.hydrate()
    if (count > 0) {
      console.error(`[tages] Hydrated ${count} memories from Supabase`)
    }

    // Start background sync
    sync.startSync()
  } else {
    console.error('[tages] No Supabase config found — running in local-only mode')
  }

  // Initialize session tracker
  const tracker = new SessionTracker(supabaseClient, projectId)
  await tracker.startSession()

  const server = new McpServer({
    name: 'tages',
    version: '0.1.0',
  })

  // Register tools
  server.tool(
    'remember',
    'Store a memory about this codebase — conventions, decisions, architecture, patterns, or lessons learned',
    {
      key: RememberSchema.shape.key,
      value: RememberSchema.shape.value,
      type: RememberSchema.shape.type,
      filePaths: RememberSchema.shape.filePaths,
      tags: RememberSchema.shape.tags,
      conditions: RememberSchema.shape.conditions,
      phases: RememberSchema.shape.phases,
      crossSystemRefs: RememberSchema.shape.crossSystemRefs,
      examples: RememberSchema.shape.examples,
      executionFlow: RememberSchema.shape.executionFlow,
    },
    async (args) => {
      const result = await handleRemember(args, projectId, cache, sync)
      // Track the memory creation
      const mem = cache.getByKey(projectId, args.key)
      if (mem) await tracker.logCreate(mem.id)
      return result
    },
  )

  server.tool(
    'recall',
    'Search codebase memories by fuzzy query — finds conventions, decisions, patterns, and lessons',
    {
      query: RecallSchema.shape.query,
      type: RecallSchema.shape.type,
      limit: RecallSchema.shape.limit,
    },
    async (args) => {
      const result = await handleRecall(args, projectId, cache, sync)
      // Track recall access
      const memories = cache.queryMemories(projectId, args.query, undefined, args.limit || 5)
      await tracker.logRecall(
        memories.map(m => m.id),
        args.query,
        [], // similarities not available from cache
      )
      return result
    },
  )

  server.tool(
    'forget',
    'Delete a memory by its key',
    {
      key: ForgetSchema.shape.key,
    },
    async (args) => {
      const mem = cache.getByKey(projectId, args.key)
      const result = await handleForget(args, projectId, cache, sync)
      if (mem) await tracker.logDelete(mem.id)
      return result
    },
  )

  server.tool(
    'conventions',
    'List all coding conventions for this project',
    {},
    async () => handleConventions(projectId, cache, sync),
  )

  server.tool(
    'architecture',
    'List all architecture notes and module boundaries',
    {},
    async () => handleArchitecture(projectId, cache, sync),
  )

  server.tool(
    'decisions',
    'List the decision log — why things were built the way they are',
    {},
    async () => handleDecisions(projectId, cache, sync),
  )

  server.tool(
    'context',
    'Get all memories related to a specific file path',
    {
      filePath: ContextSchema.shape.filePath,
    },
    async (args) => handleContext(args, projectId, cache, sync),
  )

  server.tool(
    'staleness',
    'Check for stale memories that may be outdated or no longer relevant',
    {},
    async () => handleStaleness(projectId, cache, sync),
  )

  server.tool(
    'conflicts',
    'Detect potential conflicts between memories — overlapping or contradictory entries',
    {},
    async () => handleConflicts(projectId, cache, sync),
  )

  server.tool(
    'stats',
    'Show memory usage statistics — counts by type, recall hit rate, agent sessions, most/least accessed',
    {},
    async () => handleStats(projectId, cache, sync),
  )

  server.tool(
    'observe',
    'Report what you are doing or learning — Tages silently extracts memories from your observations. Call this naturally as you work, no need to format.',
    {
      observation: z.string().min(1).describe('What you observed, decided, or learned while working'),
    },
    async (args) => handleObserve(args, projectId, cache, sync),
  )

  server.tool(
    'session_end',
    'End the current session with a summary of what was built, decided, or learned — auto-extracts memories from the summary',
    {
      summary: SessionEndSchema.shape.summary,
      extractMemories: SessionEndSchema.shape.extractMemories,
    },
    async (args) => {
      const result = await handleSessionEnd(args, projectId, cache, sync)
      await tracker.endSession()
      return result
    },
  )

  server.tool(
    'verify_memory',
    'Verify a pending auto-extracted memory — promotes it to live so it appears in recall results',
    {
      key: VerifyMemorySchema.shape.key,
    },
    async (args) => handleVerifyMemory(args, projectId, cache, sync),
  )

  server.tool(
    'pending_memories',
    'List auto-extracted memories that need verification before they appear in recall',
    {},
    async () => handlePendingMemories(projectId, cache),
  )

  // Register resources
  registerResources(server, cache, sync)

  // Start stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Cleanup on exit
  process.on('SIGINT', async () => {
    await tracker.endSession()
    if (sync) {
      await sync.flush()
      sync.stopSync()
    }
    cache.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[tages] Fatal error:', err)
  process.exit(1)
})
