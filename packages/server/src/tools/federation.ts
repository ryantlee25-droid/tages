import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'
import { globalFederationManager, type FederationScope } from '../federation/federation-manager'

export async function handlePromote(
  args: { key: string; scope?: string; promotedBy?: string },
  projectId: string,
  cache: SqliteCache,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return { content: [{ type: 'text', text: `Memory "${args.key}" not found.` }] }
  }

  const scope = (args.scope || 'org') as FederationScope
  const entry = globalFederationManager.promoteToFederated(memory, scope, args.promotedBy)

  return {
    content: [{
      type: 'text',
      text: `Promoted "${args.key}" to federated library (scope: ${scope}, version: ${entry.version})`,
    }],
  }
}

export async function handleImportFederated(
  args: { key: string },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const entry = globalFederationManager.importFromFederated(args.key, projectId)
  if (!entry) {
    return { content: [{ type: 'text', text: `No federated memory found for key "${args.key}".` }] }
  }

  const local = {
    ...entry.memory,
    projectId,
    id: `${entry.memory.id}-${projectId}`,
    updatedAt: new Date().toISOString(),
  }
  cache.upsertMemory(local, true)

  if (sync) {
    const ok = await sync.remoteInsert(local)
    if (ok) cache.markSynced([local.id])
  }

  return {
    content: [{
      type: 'text',
      text: `Imported federated memory "${args.key}" into project (version ${entry.version})`,
    }],
  }
}

export async function handleListFederated(
  args: { scope?: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const scope = args.scope as FederationScope | undefined
  const entries = globalFederationManager.listFederatedMemories(scope)

  if (entries.length === 0) {
    return { content: [{ type: 'text', text: 'No federated memories.' }] }
  }

  const lines = entries.map((e, i) =>
    `${i + 1}. [${e.scope}] "${e.memory.key}" (v${e.version}) — ${e.memory.value.slice(0, 60)} [from: ${e.ownerProjectId}]`
  )
  return {
    content: [{
      type: 'text',
      text: `Federated memories (${entries.length}):\n\n${lines.join('\n')}`,
    }],
  }
}

export async function handleResolveOverrides(
  _args: Record<string, never>,
  projectId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const overrides = globalFederationManager.checkForOverrides(projectId)

  if (overrides.length === 0) {
    return { content: [{ type: 'text', text: 'No local overrides of federated memories.' }] }
  }

  const lines = overrides.map((o, i) =>
    `${i + 1}. "${o.federatedKey}" — local overrides federated v${o.federatedMemory.version}`
  )
  return {
    content: [{
      type: 'text',
      text: `Override mappings (${overrides.length}):\n${lines.join('\n')}`,
    }],
  }
}
