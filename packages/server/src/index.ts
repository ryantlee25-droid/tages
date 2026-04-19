#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createSupabaseClient } from '@tages/shared'
import { z } from 'zod'

import * as fs from 'fs'
import * as path from 'path'
import { loadServerConfig, getConfigDir, getCachePath, resolveProject } from './config'
import { shouldHydrate } from './hydration'
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
import { runAutoSaveSweep } from './sync/auto-save'
import { handleVerifyMemory, handlePendingMemories } from './tools/verify'
import { handleStatsDetail } from './tools/stats-detail'
import { handleMemoryHistory } from './tools/memory-history'
import { handleContextualRecall } from './tools/contextual-recall'
import { handleResolveConflict, handleListConflicts } from './tools/resolve-conflict'
import { handleSuggestions } from './tools/suggestion-engine'
import { handleImport } from './tools/import'
import { handleImportClaudeMd } from './tools/import-claude-md'
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
import { handlePreCheck } from './tools/pre-check'
import { handleBrief } from './tools/brief'
import { handleMemoryAudit } from './tools/audit'
import { handleSharpenMemory } from './tools/sharpen'
import { handlePostSession } from './tools/post-session'
import { FREE_TOOLS } from './tier-config'
import { gateCheck } from './tier-gate'
import {
  RememberSchema, RecallSchema, ForgetSchema, ContextSchema, SessionEndSchema, VerifyMemorySchema,
  MemoryHistorySchema, ContextualRecallSchema, ResolveConflictSchema, ImportSchema,
  DedupSchema, ConsolidateSchema, ImpactAnalysisSchema, MemoryQualitySchema,
  MatchTemplatesSchema, ApplyTemplateSchema, ArchiveSchema, RestoreSchema, ListArchivedSchema,
  AutoArchiveSchema, PromoteSchema, ImportFederatedSchema, ListFederatedSchema,
  SessionReplaySchema, AgentMetricsSchema, TrendsSchema, CheckConventionSchema, PreCheckSchema,
  FileRecallSchema, ImportClaudeMdSchema, BriefSchema,
  MemoryAuditSchema, SharpenMemorySchema, PostSessionSchema,
} from './schemas'

const HYDRATION_TTL_MS = 60_000

async function main() {
  // Project resolution: env var (backward compat) → auto-detect from cwd
  let config = loadServerConfig(process.env.TAGES_PROJECT_SLUG)
  let detectionMethod = 'env'

  if (!config) {
    const cwd = process.env.TAGES_CWD || process.cwd()
    const resolved = await resolveProject(cwd)
    config = {
      project: resolved.config,
      cachePath: getCachePath(resolved.config.slug),
    }
    detectionMethod = resolved.detectionMethod
  }

  console.error(`[tages] Project '${config.project.slug}' resolved via ${detectionMethod}`)

  // Initialize SQLite cache (works even without Supabase)
  const cachePath = config.cachePath
  const cache = new SqliteCache(cachePath)
  const queryLog = new QueryLog(cachePath)
  const projectId = config.project.projectId
  // plan starts from local config; overridden from DB after Supabase auth (H1)
  let plan = config.project.plan
  // auto-save threshold — fetched from DB; NULL means opt-in is off (review-required)
  let autoSaveThreshold: number | null = null

  // Tier gate helper — wraps pro-only tool handlers
  function withGate<T>(toolName: string, handler: (args: T) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) {
    return async (args: T) => {
      const gate = gateCheck(plan, toolName)
      if (gate) return gate
      return handler(args)
    }
  }

  // Initialize Supabase sync if configured
  let sync: SupabaseSync | null = null
  let supabaseClient = null
  let callerUserId: string | undefined = undefined
  const walPath = cachePath.replace('.db', '-wal.db')
  if (config.project.supabaseUrl && config.project.supabaseAnonKey) {
    supabaseClient = createSupabaseClient(
      config.project.supabaseUrl,
      config.project.supabaseAnonKey,
    )

    // Set user session from auth.json so RLS allows queries
    try {
      const authPath = path.join(getConfigDir(), 'auth.json')
      if (fs.existsSync(authPath)) {
        const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
        if (auth.accessToken && auth.refreshToken) {
          await supabaseClient.auth.setSession({
            access_token: auth.accessToken,
            refresh_token: auth.refreshToken,
          })
        }
      }
    } catch (e) {
      console.error(`[tages] Warning: could not load auth tokens — sync may fail`)
    }

    // Accept any pending team invites for this user; capture callerUserId for authorship
    try {
      const { data: { user } } = await supabaseClient.auth.getUser()
      const email = user?.email || user?.user_metadata?.email
      if (email && user?.id) {
        callerUserId = user.id
        const { data: acceptCount } = await supabaseClient.rpc('accept_pending_invites', {
          user_email: email,
          uid: user.id,
        })
        if (acceptCount && acceptCount > 0) {
          console.error(`[tages] Accepted ${acceptCount} pending team invite(s)`)
        }
      }
    } catch (e) {
      console.error(`[tages] Warning: could not check pending invites — ${(e as Error).message}`)
    }

    // H1: Fetch current plan and auto_save_threshold from DB
    try {
      const { data: projectRow } = await supabaseClient
        .from('projects')
        .select('plan, auto_save_threshold')
        .eq('id', projectId)
        .single()
      if (projectRow?.plan) {
        config.project.plan = projectRow.plan
        plan = projectRow.plan
        console.error(`[tages] Plan loaded from DB: ${plan}`)
      }
      if (projectRow?.auto_save_threshold != null) {
        autoSaveThreshold = projectRow.auto_save_threshold as number
        console.error(`[tages] Auto-save threshold: ${autoSaveThreshold}`)
      }
    } catch (e) {
      console.error(`[tages] Warning: could not fetch plan from DB — using local config`)
    }

    sync = new SupabaseSync(supabaseClient, cache, projectId, walPath)

    // T1: WAL recovery — replay any incomplete sync ops before hydration
    const recovered = await sync.recoverWAL()
    if (recovered > 0) {
      console.error(`[tages] WAL recovery: replayed ${recovered} operations`)
    }

    // Hydrate cache from Supabase (with staleness guard)
    const lastSync = cache.getLastSyncedAt(projectId)
    if (shouldHydrate(lastSync, HYDRATION_TTL_MS)) {
      const count = await sync.hydrate()
      if (count > 0) {
        console.error(`[tages] Hydrated ${count} memories from Supabase`)
      }
    } else {
      const age = lastSync ? Date.now() - new Date(lastSync).getTime() : 0
      console.error(`[tages] Cache fresh (${Math.round(age / 1000)}s old) — skipping hydration`)
    }

    // Start background sync
    sync.startSync()

    // Phase 4: Initial auto-save sweep — promote pending memories that already
    // meet the threshold. Only runs if the project has opted in (threshold != null).
    if (autoSaveThreshold != null) {
      try {
        await runAutoSaveSweep(supabaseClient, projectId, autoSaveThreshold)
      } catch (e) {
        console.error(`[tages] Auto-save sweep failed: ${(e as Error).message}`)
      }
    }
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
      const result = await handleRemember(args, projectId, cache, sync, plan, callerUserId)
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
      observation: z.string().min(1).max(100_000).describe('What you observed, decided, or learned while working'),
    },
    async (args) => handleObserve(args, projectId, cache, sync, callerUserId, autoSaveThreshold),
  )

  server.tool(
    'session_end',
    'End the current session with a summary of what was built, decided, or learned — auto-extracts memories from the summary',
    {
      summary: SessionEndSchema.shape.summary,
      extractMemories: SessionEndSchema.shape.extractMemories,
    },
    async (args) => {
      const result = await handleSessionEnd(args, projectId, cache, sync, callerUserId)
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
    withGate('memory_stats_detail', async () => handleStatsDetail(projectId, cache)),
  )

  server.tool(
    'memory_history',
    'Get the version history of a memory — shows past values, confidence changes, and who changed it. Optionally revert to a previous version.',
    {
      key: MemoryHistorySchema.shape.key,
      revertToVersion: MemoryHistorySchema.shape.revertToVersion,
    },
    async (args) => handleMemoryHistory(args, projectId, cache, sync, callerUserId),
  )

  server.tool(
    'contextual_recall',
    'Search memories filtered by execution context — current files, agent name, or phase. More precise than recall for context-aware retrieval.',
    {
      query: ContextualRecallSchema.shape.query,
      context: ContextualRecallSchema.shape.context,
      limit: ContextualRecallSchema.shape.limit,
    },
    withGate('contextual_recall', async (args) => handleContextualRecall(args, projectId, cache, sync)),
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
    withGate('resolve_conflict', async (args) => handleResolveConflict(args, projectId, cache, sync, callerUserId)),
  )

  server.tool(
    'list_conflicts',
    'List unresolved memory conflicts for this project',
    {},
    withGate('list_conflicts', async () => handleListConflicts(projectId, cache)),
  )

  server.tool(
    'suggestions',
    'Get suggestions for memories you should store, based on queries that returned no results',
    {},
    withGate('suggestions', async () => handleSuggestions(projectId, cache, queryLog)),
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
    withGate('memory_graph', async () => handleMemoryGraph(projectId, cache, sync)),
  )

  // T7: Session branching tools
  server.tool(
    'fork_branch',
    'Fork current memories into a session branch for experimentation. Branch writes won\'t affect main until merged.',
    {
      sessionId: z.string().min(1).describe('Unique session identifier for this branch'),
    },
    withGate('fork_branch', async (args) => {
      const branch = forkBranch(args.sessionId, projectId, cache)
      const count = getBranchMemories(args.sessionId, cache).length
      return {
        content: [{
          type: 'text' as const,
          text: `Forked branch for session "${args.sessionId}" with ${count} memories. Branch ID: ${branch.id}`,
        }],
      }
    }),
  )

  server.tool(
    'merge_branch',
    'Merge a session branch back into main memory. Detects conflicts between branch and main changes.',
    {
      sessionId: z.string().min(1).describe('Session ID of the branch to merge'),
      strategy: z.enum(['force', 'skip_conflicts']).describe('force = branch wins; skip_conflicts = skip conflicting keys'),
    },
    withGate('merge_branch', async (args) => {
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
    }),
  )

  server.tool(
    'list_branches',
    'List memories in a session branch',
    {
      sessionId: z.string().min(1).describe('Session ID to inspect'),
    },
    withGate('list_branches', async (args) => {
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
    }),
  )

  // XL1 — Smart Memory Deduplication
  server.tool(
    'detect_duplicates',
    'Detect near-duplicate memories using Jaccard similarity on key+value tokens',
    { threshold: DedupSchema.shape.threshold },
    withGate('detect_duplicates', async (args) => handleDetectDuplicates(args, projectId, cache)),
  )

  server.tool(
    'consolidate_memories',
    'Merge two duplicate memories into one, preserving all metadata',
    {
      survivorKey: ConsolidateSchema.shape.survivorKey,
      victimKey: ConsolidateSchema.shape.victimKey,
      mergedValue: ConsolidateSchema.shape.mergedValue,
    },
    withGate('consolidate_memories', async (args) => handleConsolidate(args, projectId, cache, sync, callerUserId)),
  )

  // XL2 — Memory Dependency Graph & Impact Analysis
  server.tool(
    'impact_analysis',
    'Analyze the downstream impact of a memory — how many others depend on it',
    { key: ImpactAnalysisSchema.shape.key },
    withGate('impact_analysis', async (args) => handleImpactAnalysis(args, projectId, cache)),
  )

  server.tool(
    'risk_report',
    'Get project-wide risk ranking — which memories are most dangerous to change',
    {},
    withGate('risk_report', async () => handleRiskReport({} as never, projectId, cache)),
  )

  server.tool(
    'graph_analysis',
    'Analyze the memory dependency graph — orphans, critical paths, impact scores',
    {},
    withGate('graph_analysis', async () => handleGraphAnalysis({} as never, projectId, cache)),
  )

  // XL3 — Convention Enforcement
  server.tool(
    'check_convention',
    'Check a memory against all stored conventions — detect conflicts or duplicates before storing',
    {
      key: CheckConventionSchema.shape.key,
      agentName: CheckConventionSchema.shape.agentName,
    },
    withGate('check_convention', async (args) => handleCheckConvention(args, projectId, cache)),
  )

  server.tool(
    'enforcement_report',
    'Get per-agent convention compliance stats and recent violations',
    {},
    withGate('enforcement_report', async () => handleEnforcementReport({} as never, projectId, cache)),
  )

  // XL4 — Memory Quality Scoring
  server.tool(
    'memory_quality',
    'Score a specific memory on completeness, freshness, consistency, and usefulness (0-100)',
    { key: MemoryQualitySchema.shape.key },
    withGate('memory_quality', async (args) => handleMemoryQuality(args, projectId, cache)),
  )

  server.tool(
    'project_health',
    'Get overall project memory health score with dimension breakdown and improvement suggestions',
    {},
    withGate('project_health', async () => handleProjectHealth({} as never, projectId, cache)),
  )

  // XL5 — Memory Templates
  server.tool(
    'list_templates',
    'List available memory templates (api-endpoint, react-component, database-migration, test-suite, cli-command)',
    {},
    withGate('list_templates', async () => handleListTemplates({} as never)),
  )

  server.tool(
    'match_templates',
    'Find templates matching given file paths — prompts agent to fill required fields',
    { filePaths: MatchTemplatesSchema.shape.filePaths },
    withGate('match_templates', async (args) => handleMatchTemplates(args)),
  )

  server.tool(
    'apply_template',
    'Create a memory from a filled template with automatic key generation',
    {
      templateId: ApplyTemplateSchema.shape.templateId,
      fields: ApplyTemplateSchema.shape.fields,
      filePaths: ApplyTemplateSchema.shape.filePaths,
    },
    withGate('apply_template', async (args) => handleApplyTemplate(args, projectId, cache, sync, callerUserId)),
  )

  // XL6 — Memory Archival
  server.tool(
    'archive_memory',
    'Archive a memory to cold storage — removes it from recall but preserves it for restoration',
    {
      key: ArchiveSchema.shape.key,
      reason: ArchiveSchema.shape.reason,
    },
    withGate('archive_memory', async (args) => handleArchive(args, projectId, cache)),
  )

  server.tool(
    'restore_memory',
    'Restore an archived memory back to live status',
    { key: RestoreSchema.shape.key },
    withGate('restore_memory', async (args) => handleRestore(args, projectId, cache, sync)),
  )

  server.tool(
    'list_archived',
    'List archived memories with their archive reasons and dates',
    { limit: ListArchivedSchema.shape.limit },
    withGate('list_archived', async (args) => handleListArchived(args, projectId)),
  )

  server.tool(
    'archive_stats',
    'Get archive statistics — total archived, restored, expired',
    {},
    withGate('archive_stats', async () => handleArchiveStats({} as never, projectId)),
  )

  server.tool(
    'auto_archive',
    'Scan for stale low-quality memories and auto-archive them',
    {
      qualityThreshold: AutoArchiveSchema.shape.qualityThreshold,
      stalenessDays: AutoArchiveSchema.shape.stalenessDays,
    },
    withGate('auto_archive', async (args) => handleAutoArchive(args, projectId, cache)),
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
    withGate('federate_memory', async (args) => handlePromote(args, projectId, cache, sync)),
  )

  server.tool(
    'import_federated',
    'Import a federated memory from the shared library into this project',
    { key: ImportFederatedSchema.shape.key },
    withGate('import_federated', async (args) => handleImportFederated(args, projectId, cache, sync, callerUserId)),
  )

  server.tool(
    'list_federated',
    'List all memories in the federated library',
    { scope: ListFederatedSchema.shape.scope },
    withGate('list_federated', async (args) => handleListFederated(args, sync)),
  )

  server.tool(
    'federation_overrides',
    'Show which federated memories have local project overrides',
    {},
    withGate('federation_overrides', async () => handleResolveOverrides({} as never, projectId)),
  )

  // XL8 — Agent Analytics
  server.tool(
    'session_replay',
    'Replay a session timeline showing all tool calls with metrics',
    { sessionId: SessionReplaySchema.shape.sessionId },
    withGate('session_replay', async (args) => handleSessionReplay(args)),
  )

  server.tool(
    'agent_metrics',
    'Get agent effectiveness metrics — recall hit rate, memory creation quality, convention compliance',
    { agentName: AgentMetricsSchema.shape.agentName },
    withGate('agent_metrics', async (args) => handleAgentMetrics(args, projectId)),
  )

  server.tool(
    'trends',
    'Detect performance trends across sessions — improvements and regressions',
    { agentName: TrendsSchema.shape.agentName },
    withGate('trends', async (args) => handleTrends(args, projectId)),
  )

  // pre_check — Pre-task gotcha check
  server.tool(
    'pre_check',
    'Before starting a task, get a list of gotchas: anti-patterns to avoid, conventions to follow, and lessons learned from past experience',
    {
      taskDescription: PreCheckSchema.shape.taskDescription,
      filePaths: PreCheckSchema.shape.filePaths,
    },
    async (args) => handlePreCheck(args, projectId, cache, sync),
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

  // Project brief — token-budgeted context for system prompt injection
  server.tool(
    'project_brief',
    'Generate a token-budgeted project brief for system prompt injection. Returns gotchas, conventions, architecture, and decisions — prioritized by importance. Use this ONCE at session start instead of calling recall/conventions/architecture individually.',
    {
      task: BriefSchema.shape.task,
      budget: BriefSchema.shape.budget,
    },
    async (args) => handleBrief(args, projectId, cache, sync),
  )

  // CLAUDE.md import
  server.tool(
    'import_claude_md',
    'Parse a CLAUDE.md file and auto-create memories from its sections. Conventions, architecture notes, decisions, and anti-patterns become typed memories.',
    {
      content: ImportClaudeMdSchema.shape.content,
      strategy: ImportClaudeMdSchema.shape.strategy,
    },
    async (args) => handleImportClaudeMd({ ...args, projectId }, cache, sync, callerUserId),
  )

  // Memory Quality Flywheel — F1: memory_audit
  server.tool(
    'memory_audit',
    'Audit project memory coverage and quality: type distribution, brief-critical coverage score, imperative phrasing ratio, and actionable suggestions.',
    {},
    withGate('memory_audit', async () => handleMemoryAudit({} as never, projectId, cache)),
  )

  // Memory Quality Flywheel — F2: sharpen_memory
  server.tool(
    'sharpen_memory',
    'Rewrite a memory value into imperative form (ALWAYS/NEVER/MUST/DO NOT) using Claude Haiku. Returns a before/after preview unless confirmed=true.',
    {
      key: SharpenMemorySchema.shape.key,
      confirmed: SharpenMemorySchema.shape.confirmed,
    },
    withGate('sharpen_memory', async (args) => handleSharpenMemory(args, projectId, cache, sync, callerUserId)),
  )

  // Memory Quality Flywheel — F3: post_session
  server.tool(
    'post_session',
    'End-of-session tool: extract memories from a session summary, optionally regenerate the project brief. Combines session_end + brief regeneration in one call.',
    {
      summary: PostSessionSchema.shape.summary,
      refreshBrief: PostSessionSchema.shape.refreshBrief,
    },
    withGate('post_session', async (args) => handlePostSession(args, projectId, cache, sync)),
  )

  // Register resources
  registerResources(server, cache, sync)

  // Start stdio transport
  console.error('[tages] Connecting stdio transport...')
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[tages] Server ready — listening for MCP requests')

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
