import type { SqliteCache } from '../cache/sqlite'
import type { SupabaseSync } from '../sync/supabase-sync'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You rewrite AI agent memory entries into imperative form. Rules:
- Start with ALWAYS, NEVER, MUST, or DO NOT
- Keep it one sentence
- Preserve all specific identifiers (file paths, function names, import paths)
- No prose, no explanation — just the rewritten memory value`

async function callHaikuRewrite(key: string, value: string, type: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const userPrompt = `Rewrite this memory entry into imperative form.

Key: ${key}
Type: ${type}
Current value: ${value}

Return only the rewritten value — one sentence starting with ALWAYS, NEVER, MUST, or DO NOT.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Anthropic API returned ${response.status}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  return data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
}

/**
 * Handle the sharpen_memory MCP tool.
 *
 * In preview mode (confirmed=false, default): returns before/after without mutating.
 * In confirmed mode (confirmed=true): rewrites, upserts cache + sync, adds 'sharpened' tag.
 */
export async function handleSharpenMemory(
  args: { key: string; confirmed?: boolean },
  projectId: string,
  cache: SqliteCache,
  sync: SupabaseSync | null,
  callerUserId?: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const memory = cache.getByKey(projectId, args.key)
  if (!memory) {
    return {
      content: [{ type: 'text', text: `Memory "${args.key}" not found.` }],
    }
  }

  const rewritten = await callHaikuRewrite(memory.key, memory.value, memory.type)

  if (!args.confirmed) {
    return {
      content: [{
        type: 'text',
        text: [
          `Preview — sharpen "${args.key}"`,
          '',
          `Before: ${memory.value}`,
          `After:  ${rewritten}`,
          '',
          'Call sharpen_memory again with confirmed=true to apply.',
        ].join('\n'),
      }],
    }
  }

  // Apply the rewrite
  const existingTags = memory.tags ?? []
  const newTags = existingTags.includes('sharpened') ? existingTags : [...existingTags, 'sharpened']

  const updated = {
    ...memory,
    value: rewritten,
    tags: newTags,
    updatedAt: new Date().toISOString(),
    ...(callerUserId ? { updatedBy: callerUserId } : {}),
  }

  cache.upsertMemory(updated, true)
  if (sync) {
    await sync.remoteInsert(updated)
  }

  return {
    content: [{
      type: 'text',
      text: [
        `Sharpened "${args.key}"`,
        '',
        `Before: ${memory.value}`,
        `After:  ${rewritten}`,
      ].join('\n'),
    }],
  }
}
