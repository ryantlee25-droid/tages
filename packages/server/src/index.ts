#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createSupabaseClient } from '@tages/shared'
import { z } from 'zod'

import { loadServerConfig } from './config'
import { SqliteCache } from './cache/sqlite'
import { SupabaseSync } from './sync/supabase-sync'
import { SessionTracker } from './tracking'
import { forkBranch, mergeBranch, getBranchMemories, deleteBranch } from './branch/session-branch'
import { computeDecayScore, shouldArchive } from './decay/scoring'
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
import { handleStatsDetail } from './tools/stats-detail'
import { handleMemoryHistory } from './tools/memory-history'
import { handleContextualRecall } from './tools/contextual-recall'
import { handleResolveConflict, handleListConflicts } from './tools/resolve-conflict'
import { handleSuggestions } from './tools/suggestion-engine'
import { handleImport } from './tools/import'
import { handleMemoryGraph } from './tools/memory-graph'
import { QueryLog } from './cache/query-log'
import { handleDetectDuplicates, handleConsolidate } from './tools/dedup'
import { handleImpactAnalysis, handleRiskReport, handleGraphAnalysis } from './tools/impact'
import { handleCheckConvention, handleEnforcementReport } from './tools/enforce'
import { handleMemoryQuality, handleProjectHealth } from './tools/quality'
import { handleListTemplates, handleMatchTemplates, handleApplyTemplate } from './tools/templates'
import { handleArchive, handleRestore, handleListArchived, handleArchiveStats, handleAutoArchive } from './tools/archive-manager'
import { handlePromote, handleImportFederated, handleListFederated, handleResolveOverrides } from './tools/federation'
import { handleSessionReplay, handleAgentMetrics, handleTrends } from './tools/analytics'
import { handleFileRecall } from './tools/file-recall'
import { globalSessionRecorder } from './analytics/session-recorder'
import {
  RememberSchema, RecallSchema, ForgetSchema, ContextSchema, SessionEndSchema, VerifyMemorySchema,
  MemoryHistorySchema, ContextualRecallSchema, ResolveConflictSchema, ImportSchema,
  DedupSchema, ConsolidateSchema, ImpactAnalysisSchema, MemoryQualitySchema,
  MatchTemplatesSchema, ApplyTemplateSchema, ArchiveSchema, RestoreSchema, ListArchivedSchema,
  AutoArchiveSchema, PromoteSchema, ImportFederatedSchema, ListFederatedSchema,
  SessionReplaySchema, AgentMetricsSchema, TrendsSchema, CheckConventionSchema,
  FileRecallSchema,
} from './schemas'

async function main() {
  const config = loadServerConfig()

  // Initialize SQLite cache (works even without Supabase)
  const cachePath = config?.cachePath || '/tmp/tages-default.db'
  const cache = new SqliteCache(cachePath)
  const queryLog = new QueryLog(cachePath)
  const projectId = config?.project.projectId || 'local'

  // Initialize Supabase sync if configured
  let sync: SupabaseSync | null = null
  let supabaseClient = null
  const walPath = cachePath.replace('.db', '-wal.db')
  if (config?.project.supabaseUrl && config?.project.supabaseAnonKey) {
    supabaseClient = createSupabaseClient(
      config.project.supabaseUrl,
      config.project.supabaseAnonKey,
    )
    sync = new SupabaseSync(supabaseClient, cache, projectId, walPath)

    // T1: WAL recovery — replay any incomplete sync ops before hydration
    const recovered = await sync.recoverWAL()
    if (recovered > 0) {
      console.error(`[tages] WAL recovery: replayed ${recovered} operations`)
    }

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

  // XL8: Start analytics session recording
  const analyticsSessionId = `session-${Date.now()}`
  globalSessionRecorder.startSession(analyticsSessionId, projectId, process.env.TAGES_AGENT_NAME)

  // T6: Periodic decay check — every 5 minutes, archive stale memories
  const DECAY_INTERVAL_MS = 5 * 60 * 1000
  const decayTimer = setInterval(() => {
    try {
      const staleMemories = cache.getStaleMemories(projectId, 180, 2)
      let archived = 0
      for (const mem of staleMemories) {
        const accessInfo = cache.getAccessInfo(mem.id)
        const score = computeDecayScore(mem, {
          lastAccessedAt: accessInfo?.lastAccessedAt,
          accessCount: accessInfo?.accessCount ?? 0,
        })
        if (shouldArchive(score)) {
          cache.archiveMemory(mem.id)
          archived++
        }
      }
      if (archived > 0) {
        console.error(`[tages] Decay check: archived ${archived} stale memories`)
      }
    } catch (err) {
      console.error('[tages] Decay check error:', (err as Error).message)
    }
  }, DECAY_INTERVAL_MS)

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
      force: RememberSchema.shape.force,
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
      // Log miss for suggestion engine
      if (memories.length === 0) {
        queryLog.logMiss(projectId, args.query)
      }
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

  server.tool(
    'memory_stats_detail',
    'Detailed memory statistics — counts by type and status, average confidence, top 5 agents, and total count',
    {},
    async () => handleStatsDetail(projectId, cache),
  )

  server.tool(
    'memory_history',
    'Get the version history of a memory — shows past values, confidence changes, and who changed it. Optionally revert to a previous version.',
    {
      key: MemoryHistorySchema.shape.key,
      revertToVersion: MemoryHistorySchema.shape.revertToVersion,
    },
    async (args) => handleMemoryHistory(args, projectId, cache, sync),
  )

  server.tool(
    'contextual_recall',
    'Search memories filtered by execution context — current files, agent name, or phase. More precise than recall for context-aware retrieval.',
    {
      query: ContextualRecallSchema.shape.query,
      context: ContextualRecallSchema.shape.context,
      limit: ContextualRecallSchema.shape.limit,
    },
    async (args) => handleContextualRecall(args, projectId, cache, sync),
  )

  server.tool(
    'resolve_conflict',
    'Resolve a detected memory conflict using keep_newer, keep_older, or merge strategies',
    {
      conflictId: ResolveConflictSchema.shape.conflictId,
      strategy: ResolveConflictSchema.shape.strategy,
      mergedValue: ResolveConflictSchema.shape.mergedValue,
      resolvedBy: ResolveConflictSchema.shape.resolvedBy,
    },
    async (args) => handleResolveConflict(args, projectId, cache, sync),
  )

  server.tool(
    'list_conflicts',
    'List unresolved memory conflicts for this project',
    {},
    async () => handleListConflicts(projectId, cache),
  )

  server.tool(
    'suggestions',
    'Get suggestions for memories you should store, based on queries that returned no results',
    {},
    async () => handleSuggestions(projectId, cache, queryLog),
  )

  server.tool(
    'import_memories',
    'Import memories from a JSON array or markdown file content. Handles duplicates with skip/overwrite/merge strategies.',
    {
      content: ImportSchema.shape.content,
      format: ImportSchema.shape.format,
      strategy: ImportSchema.shape.strategy,
    },
    async (args) => {
      const result = await handleImport({ ...args, projectId }, cache, sync)
      return result
    },
  )

  server.tool(
    'memory_graph',
    'Build a relationship graph from crossSystemRefs and output as a Mermaid diagram',
    {},
    async () => handleMemoryGraph(projectId, cache, sync),
  )

  // T7: Session branching tools
  server.tool(
    'fork_branch',
    'Fork current memories into a session branch for experimentation. Branch writes won\'t affect main until merged.',
    {
      sessionId: z.string().min(1).describe('Unique session identifier for this branch'),
    },
    async (args) => {
      const branch = forkBranch(args.sessionId, projectId, cache)
      const count = getBranchMemories(args.sessionId, cache).length
      return {
        content: [{
          type: 'text' as const,
          text: `Forked branch for session "${args.sessionId}" with ${count} memories. Branch ID: ${branch.id}`,
        }],
      }
    },
  )

  server.tool(
    'merge_branch',
    'Merge a session branch back into main memory. Detects conflicts between branch and main changes.',
    {
      sessionId: z.string().min(1).describe('Session ID of the branch to merge'),
      strategy: z.enum(['force', 'skip_conflicts']).describe('force = branch wins; skip_conflicts = skip conflicting keys'),
    },
    async (args) => {
      const result = mergeBranch(args.sessionId, args.strategy, cache)
      const conflictSummary = result.conflicts.length > 0
        ? `\nConflicts (${result.conflicts.length}): ${result.conflicts.map(c => c.key).join(', ')}`
        : ''
      return {
        content: [{
          type: 'text' as const,
          text: `Merged branch for session "${args.sessionId}": ${result.merged} memories promoted.${conflictSummary}`,
        }],
      }
    },
  )

  server.tool(
    'list_branches',
    'List memories in a session branch',
    {
      sessionId: z.string().min(1).describe('Session ID to inspect'),
    },
    async (args) => {
      const mems = getBranchMemories(args.sessionId, cache)
      if (mems.length === 0) {
        return { content: [{ type: 'text' as const, text: `No branch found for session "${args.sessionId}".` }] }
      }
      const lines = mems.map((m, i) => `${i + 1}. [${m.type}] ${m.key}: ${m.value.slice(0, 60)}`)
      return {
        content: [{
          type: 'text' as const,
          text: `Branch memories for "${args.sessionId}" (${mems.length}):\n\n${lines.join('\n')}`,
        }],
      }
    },
  )

  // XL1 — Smart Memory Deduplication
  server.tool(
    'detect_duplicates',
    'Detect near-duplicate memories using Jaccard similarity on key+value tokens',
    { threshold: DedupSchema.shape.threshold },
    async (args) => handleDetectDuplicates(args, projectId, cache),
  )

  server.tool(
    'consolidate_memories',
    'Merge two duplicate memories into one, preserving all metadata',
    {
      survivorKey: ConsolidateSchema.shape.survivorKey,
      victimKey: ConsolidateSchema.shape.victimKey,
      mergedValue: ConsolidateSchema.shape.mergedValue,
    },
    async (args) => handleConsolidate(args, projectId, cache, sync),
  )

  // XL2 — Memory Dependency Graph & Impact Analysis
  server.tool(
    'impact_analysis',
    'Analyze the downstream impact of a memory — how many others depend on it',
    { key: ImpactAnalysisSchema.shape.key },
    async (args) => handleImpactAnalysis(args, projectId, cache),
  )

  server.tool(
    'risk_report',
    'Get project-wide risk ranking — which memories are most dangerous to change',
    {},
    async () => handleRiskReport({} as never, projectId, cache),
  )

  server.tool(
    'graph_analysis',
    'Analyze the memory dependency graph — orphans, critical paths, impact scores',
    {},
    async () => handleGraphAnalysis({} as never, projectId, cache),
  )

  // XL3 — Convention Enforcement
  server.tool(
    'check_convention',
    'Check a memory against all stored conventions — detect conflicts or duplicates before storing',
    {
      key: CheckConventionSchema.shape.key,
      agentName: CheckConventionSchema.shape.agentName,
    },
    async (args) => handleCheckConvention(args, projectId, cache),
  )

  server.tool(
    'enforcement_report',
    'Get per-agent convention compliance stats and recent violations',
    {},
    async () => handleEnforcementReport({} as never, projectId, cache),
  )

  // XL4 — Memory Quality Scoring
  server.tool(
    'memory_quality',
    'Score a specific memory on completeness, freshness, consistency, and usefulness (0-100)',
    { key: MemoryQualitySchema.shape.key },
    async (args) => handleMemoryQuality(args, projectId, cache),
  )

  server.tool(
    'project_health',
    'Get overall project memory health score with dimension breakdown and improvement suggestions',
    {},
    async () => handleProjectHealth({} as never, projectId, cache),
  )

  // XL5 — Memory Templates
  server.tool(
    'list_templates',
    'List available memory templates (api-endpoint, react-component, database-migration, test-suite, cli-command)',
    {},
    async () => handleListTemplates({} as never),
  )

  server.tool(
    'match_templates',
    'Find templates matching given file paths — prompts agent to fill required fields',
    { filePaths: MatchTemplatesSchema.shape.filePaths },
    async (args) => handleMatchTemplates(args),
  )

  server.tool(
    'apply_template',
    'Create a memory from a filled template with automatic key generation',
    {
      templateId: ApplyTemplateSchema.shape.templateId,
      fields: ApplyTemplateSchema.shape.fields,
      filePaths: ApplyTemplateSchema.shape.filePaths,
    },
    async (args) => handleApplyTemplate(args, projectId, cache, sync),
  )

  // XL6 — Memory Archival
  server.tool(
    'archive_memory',
    'Archive a memory to cold storage — removes it from recall but preserves it for restoration',
    {
      key: ArchiveSchema.shape.key,
      reason: ArchiveSchema.shape.reason,
    },
    async (args) => handleArchive(args, projectId, cache),
  )

  server.tool(
    'restore_memory',
    'Restore an archived memory back to live status',
    { key: RestoreSchema.shape.key },
    async (args) => handleRestore(args, projectId, cache, sync),
  )

  server.tool(
    'list_archived',
    'List archived memories with their archive reasons and dates',
    { limit: ListArchivedSchema.shape.limit },
    async (args) => handleListArchived(args, projectId),
  )

  server.tool(
    'archive_stats',
    'Get archive statistics — total archived, restored, expired',
    {},
    async () => handleArchiveStats({} as never, projectId),
  )

  server.tool(
    'auto_archive',
    'Scan for stale low-quality memories and auto-archive them',
    {
      qualityThreshold: AutoArchiveSchema.shape.qualityThreshold,
      stalenessDays: AutoArchiveSchema.shape.stalenessDays,
    },
    async (args) => handleAutoArchive(args, projectId, cache),
  )

  // XL7 — Federation
  server.tool(
    'federate_memory',
    'Promote a project memory to the org-wide federated library',
    {
      key: PromoteSchema.shape.key,
      scope: PromoteSchema.shape.scope,
      promotedBy: PromoteSchema.shape.promotedBy,
    },
    async (args) => handlePromote(args, projectId, cache),
  )

  server.tool(
    'import_federated',
    'Import a federated memory from the shared library into this project',
    { key: ImportFederatedSchema.shape.key },
    async (args) => handleImportFederated(args, projectId, cache, sync),
  )

  server.tool(
    'list_federated',
    'List all memories in the federated library',
    { scope: ListFederatedSchema.shape.scope },
    async (args) => handleListFederated(args),
  )

  server.tool(
    'federation_overrides',
    'Show which federated memories have local project overrides',
    {},
    async () => handleResolveOverrides({} as never, projectId),
  )

  // XL8 — Agent Analytics
  server.tool(
    'session_replay',
    'Replay a session timeline showing all tool calls with metrics',
    { sessionId: SessionReplaySchema.shape.sessionId },
    async (args) => handleSessionReplay(args),
  )

  server.tool(
    'agent_metrics',
    'Get agent effectiveness metrics — recall hit rate, memory creation quality, convention compliance',
    { agentName: AgentMetricsSchema.shape.agentName },
    async (args) => handleAgentMetrics(args, projectId),
  )

  server.tool(
    'trends',
    'Detect performance trends across sessions — improvements and regressions',
    { agentName: TrendsSchema.shape.agentName },
    async (args) => handleTrends(args, projectId),
  )

  server.tool(
    'file_recall',
    'Find memories related to specific file paths — matches by exact path, directory prefix, or reverse prefix. Prioritises anti-pattern and convention memories.',
    {
      filePaths: FileRecallSchema.shape.filePaths,
      limit: FileRecallSchema.shape.limit,
    },
    async (args) => handleFileRecall(args, projectId, cache),
  )

  // Register resources
  registerResources(server, cache, sync)

  // Start stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Cleanup on exit
  process.on('SIGINT', async () => {
    clearInterval(decayTimer)
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
