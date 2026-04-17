import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import open from 'open'
import type { Memory } from '@tages/shared'
import type { SessionContextMemory } from './session.js'
import { rehydrate_session_context } from './session.js'
import { loadProjectConfig } from '../config/project.js'
import { getCacheDir } from '../config/paths.js'
import { openCliSync } from '../sync/cli-sync.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://app.tages.ai'

interface DashboardOptions {
  project?: string
  localView?: boolean
  installShortcut?: boolean
}

interface ProjectConfig {
  projectId: string
  slug: string
  supabaseUrl?: string
  supabaseAnonKey?: string
  [key: string]: unknown
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderList(title: string, items: string[]): string {
  if (items.length === 0) return ''
  return [
    '<section class="card">',
    `<h2>${escapeHtml(title)}</h2>`,
    '<ul>',
    ...items.map(item => `<li>${item}</li>`),
    '</ul>',
    '</section>',
  ].join('\n')
}

function parseSessionContext(memory: Memory): SessionContextMemory | null {
  if (memory.type !== 'session_context') return null
  try {
    const parsed = JSON.parse(memory.value) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const currentObjective = (parsed.current_objective as string) || (parsed.current_goal as string) || ''
    const workingSummary = (parsed.working_summary as string) || (parsed.working_state_summary as string) || ''
    if (!currentObjective || !workingSummary) return null
    return {
      current_objective: currentObjective,
      active_constraints: Array.isArray(parsed.active_constraints) ? parsed.active_constraints as string[] : [],
      recent_decisions: Array.isArray(parsed.recent_decisions) ? parsed.recent_decisions as string[] : [],
      open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions as string[] : [],
      known_issues: Array.isArray(parsed.known_issues) ? parsed.known_issues as string[] : [],
      working_summary: workingSummary,
      project_label: typeof parsed.project_label === 'string' ? parsed.project_label : undefined,
      optional_tags: Array.isArray(parsed.optional_tags) ? parsed.optional_tags as string[] : undefined,
    }
  } catch {
    return null
  }
}

function detectProvider(memory: Memory, context: SessionContextMemory): string {
  const tags = [...(memory.tags || []), ...(context.optional_tags || [])]
  const tagged = tags.find(t => t.toLowerCase().startsWith('provider:'))
  if (tagged) return tagged.split(':')[1].toLowerCase()

  const merged = [memory.key, memory.agentName || '', tags.join(' ')].join(' ').toLowerCase()
  if (merged.includes('chatgpt')) return 'chatgpt'
  if (merged.includes('claude')) return 'claude'
  if (merged.includes('codex')) return 'codex'
  if (merged.includes('gemini')) return 'gemini'
  return 'generic'
}

function providerUrl(provider: string): string {
  const urls: Record<string, string> = {
    chatgpt: 'https://chatgpt.com',
    claude: 'https://claude.ai/new',
    codex: 'https://chatgpt.com/codex',
    gemini: 'https://gemini.google.com',
    generic: 'https://chatgpt.com',
  }
  return urls[provider] || urls.generic
}

function titleFromKey(key: string): string {
  const cleaned = key
    .replace(/^session-context-?/i, '')
    .replace(/^session-handoff-?/i, '')
  const parts = cleaned.split(/[-_]/).filter(Boolean)
  if (parts.length === 0) return 'Active Session'
  return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function renderProviderBlocks(memories: Memory[]): string {
  const sessionMemories = memories
    .filter(m => m.type === 'session_context')
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  if (sessionMemories.length === 0) {
    return [
      '<section class="card full">',
      '<h2>Session Handoff Blocks</h2>',
      '<p class="muted">No handoff saved yet. Save one with <code>tages session save</code>.</p>',
      '</section>',
    ].join('\n')
  }

  const providerSet = new Set<string>()
  const blocks: string[] = []

  sessionMemories.slice(0, 20).forEach((memory, index) => {
    const context = parseSessionContext(memory)
    if (!context) return

    const provider = detectProvider(memory, context)
    providerSet.add(provider)
    const prompt = rehydrate_session_context(context, 'prompt')
    const jsonView = JSON.stringify(context, null, 2)
    const promptId = `provider-prompt-${index}`

    blocks.push([
      `<article class="provider-card" data-provider="${escapeHtml(provider)}">`,
      `<h3>${escapeHtml(titleFromKey(memory.key))}</h3>`,
      `<p><strong>Provider:</strong> ${escapeHtml(provider.toUpperCase())}</p>`,
      context.project_label ? `<p><strong>Topic:</strong> ${escapeHtml(context.project_label)}</p>` : '',
      `<p><strong>Objective:</strong> ${escapeHtml(context.current_objective)}</p>`,
      `<p class="muted">Updated: ${escapeHtml(new Date(memory.updatedAt).toLocaleString())}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueSession('${escapeHtml(providerUrl(provider))}', '${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPrompt('${promptId}')">Copy Handoff</button>`,
      '</div>',
      `<pre id="${promptId}">${escapeHtml(prompt)}</pre>`,
      '<details>',
      '<summary>Session Handoff JSON</summary>',
      `<pre>${escapeHtml(jsonView)}</pre>`,
      '</details>',
      '</article>',
    ].join('\n'))
  })

  const providers = Array.from(providerSet).sort()
  const pills = [
    '<button class="pill" data-provider="all" onclick="setProvider(\'all\')">All</button>',
    ...providers.map(provider =>
      `<button class="pill" data-provider="${escapeHtml(provider)}" onclick="setProvider('${escapeHtml(provider)}')">${escapeHtml(provider.toUpperCase())}</button>`
    ),
  ]

  return [
    '<section class="card full">',
    '<h2>Session Handoff Blocks</h2>',
    '<p class="muted">Pick provider, pick a handoff block, then hit Continue.</p>',
    `<div class="provider-pills">${pills.join('')}</div>`,
    '<div class="provider-grid">',
    ...blocks,
    '</div>',
    '</section>',
  ].join('\n')
}

function buildGeneralMemoryPrompt(memory: Memory): string {
  const value = memory.value.length > 1200 ? `${memory.value.slice(0, 1197)}...` : memory.value
  const lines = [
    'MEMORY CONTEXT SNAPSHOT',
    `Memory key: ${memory.key}`,
    `Memory type: ${memory.type}`,
    `Source: ${memory.source}`,
    `Context: ${value}`,
  ]

  if (memory.tags && memory.tags.length > 0) {
    lines.push(`Tags: ${memory.tags.join(', ')}`)
  }
  if (memory.filePaths && memory.filePaths.length > 0) {
    lines.push(`Related files: ${memory.filePaths.join(', ')}`)
  }
  lines.push('Instruction: Start from this context in the new session. Ask clarifying questions before assumptions.')
  return lines.join('\n')
}

function renderMemoryLaunchBlocks(memories: Memory[]): string {
  const launchable = memories
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 24)

  if (launchable.length === 0) {
    return [
      '<section class="card full">',
      '<h2>Continue From Any Memory</h2>',
      '<p class="muted">No memories available yet.</p>',
      '</section>',
    ].join('\n')
  }

  const cards = launchable.map((memory, index) => {
    const promptId = `memory-launch-prompt-${index}`
    const prompt = buildGeneralMemoryPrompt(memory)
    const preview = memory.value.length > 120 ? `${memory.value.slice(0, 117)}...` : memory.value
    return [
      '<article class="memory-launch-card">',
      `<h3>${escapeHtml(memory.key)}</h3>`,
      `<p><strong>Type:</strong> ${escapeHtml(memory.type)}</p>`,
      `<p class="muted">${escapeHtml(preview)}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueFromMemory('${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPrompt('${promptId}')">Copy Context</button>`,
      '</div>',
      `<pre id="${promptId}">${escapeHtml(prompt)}</pre>`,
      '</article>',
    ].join('\n')
  })

  return [
    '<section class="card full">',
    '<h2>Continue From Any Memory</h2>',
    '<p class="muted">Pick provider, then click Continue on any memory block.</p>',
    '<div class="provider-select-row">',
    '<label for="memory-provider">Provider:</label>',
    '<select id="memory-provider" class="provider-select">',
    '<option value="chatgpt">CHATGPT</option>',
    '<option value="claude">CLAUDE</option>',
    '<option value="codex">CODEX</option>',
    '<option value="gemini">GEMINI</option>',
    '</select>',
    '</div>',
    '<div class="memory-launch-grid">',
    ...cards,
    '</div>',
    '</section>',
  ].join('\n')
}

function toFileUrl(filePath: string): string {
  let normalized = path.resolve(filePath).replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  return `file://${encodeURI(normalized)}`
}

function createFolderShortcut(config: ProjectConfig, dashboardPath: string): string | null {
  const folder = process.cwd()
  if (!fs.existsSync(folder)) return null

  const safeSlug = config.slug.replace(/[^a-zA-Z0-9-_]/g, '-')
  const fileUrl = toFileUrl(dashboardPath)

  if (process.platform === 'win32') {
    const shortcutPath = path.join(folder, `Tages-${safeSlug}-Memory.url`)
    fs.writeFileSync(shortcutPath, `[InternetShortcut]\nURL=${fileUrl}\n`, 'utf-8')
    return shortcutPath
  }

  if (process.platform === 'darwin') {
    const shortcutPath = path.join(folder, `Tages-${safeSlug}-Memory.command`)
    fs.writeFileSync(shortcutPath, `#!/bin/bash\nopen "${fileUrl}"\n`, 'utf-8')
    fs.chmodSync(shortcutPath, 0o755)
    return shortcutPath
  }

  return null
}

function renderLocalDashboardHtml(config: ProjectConfig, memories: Memory[]): string {
  const typeMap = new Map<string, Memory[]>()
  const agentMap = new Map<string, Memory[]>()
  const links: Array<{ from: string; to: string }> = []

  for (const memory of memories) {
    if (!typeMap.has(memory.type)) typeMap.set(memory.type, [])
    typeMap.get(memory.type)!.push(memory)

    const agent = memory.agentName || 'unattributed'
    if (!agentMap.has(agent)) agentMap.set(agent, [])
    agentMap.get(agent)!.push(memory)

    for (const ref of memory.crossSystemRefs || []) {
      links.push({ from: memory.key, to: ref })
    }
  }

  const byType = Array.from(typeMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, items]) => `<strong>${escapeHtml(type)}</strong>: ${items.length}`)

  const byAgent = Array.from(agentMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([agent, items]) => `<strong>${escapeHtml(agent)}</strong>: ${items.length}`)

  const latest = memories
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 20)
    .map(m => `<strong>${escapeHtml(m.key)}</strong> <span class="type">${escapeHtml(m.type)}</span><br>${escapeHtml(m.value)}`)

  const edgeLines = links.length > 0
    ? links.slice(0, 200).map(e => `${escapeHtml(e.from)} -> ${escapeHtml(e.to)}`)
    : ['No cross-memory links yet.']

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Tages Local Dashboard - ${escapeHtml(config.slug)}</title>`,
    '<style>',
    ':root { --bg:#0f172a; --card:#111827; --text:#e5e7eb; --muted:#9ca3af; --accent:#22d3ee; }',
    'body { margin:0; font-family: Segoe UI, system-ui, -apple-system, sans-serif; background:linear-gradient(160deg, #0f172a, #111827); color:var(--text); }',
    '.wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }',
    'h1 { margin: 0 0 6px; font-size: 28px; }',
    '.muted { color: var(--muted); margin: 0 0 18px; }',
    '.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(300px,1fr)); gap: 16px; }',
    '.card { background: rgba(17,24,39,0.85); border:1px solid rgba(34,211,238,0.25); border-radius: 14px; padding: 14px 16px; }',
    '.full { grid-column: 1 / -1; }',
    '.card h2 { margin:0 0 10px; font-size: 16px; color: var(--accent); }',
    'ul { margin:0; padding-left: 18px; }',
    'li { margin: 6px 0; line-height: 1.35; }',
    '.type { color: var(--accent); font-size: 12px; margin-left: 6px; }',
    '.provider-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: 12px; }',
    '.provider-card { background: rgba(2,6,23,0.55); border:1px solid rgba(56,189,248,0.35); border-radius: 10px; padding: 12px; }',
    '.provider-card h3 { margin:0 0 8px; color:#67e8f9; font-size: 15px; }',
    '.memory-launch-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: 12px; }',
    '.memory-launch-card { background: rgba(2,6,23,0.55); border:1px solid rgba(56,189,248,0.35); border-radius: 10px; padding: 12px; }',
    '.memory-launch-card h3 { margin:0 0 8px; color:#bae6fd; font-size: 14px; }',
    '.provider-actions { display:flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }',
    '.provider-pills { display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 12px; }',
    '.provider-select-row { display:flex; align-items:center; gap:8px; margin-bottom: 12px; color:#cbd5e1; font-size:12px; }',
    '.provider-select { border:1px solid rgba(34,211,238,0.4); background:#0f172a; color:#e5e7eb; border-radius:8px; padding:4px 8px; font-size:12px; }',
    '.pill { border:1px solid rgba(34,211,238,0.4); background:#0f172a; color:#e5e7eb; border-radius:999px; padding:5px 10px; cursor:pointer; font-size:12px; }',
    '.pill.active { background:#164e63; border-color:#67e8f9; }',
    '.btn { display:inline-block; background:#155e75; color:#ecfeff; text-decoration:none; padding:6px 10px; border-radius:7px; border:0; cursor:pointer; font-size:12px; }',
    '.btn.secondary { background:#334155; }',
    'details { margin-top:8px; }',
    'summary { cursor:pointer; color:#7dd3fc; }',
    'pre { margin:0; white-space: pre-wrap; word-break: break-word; color: var(--text); }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    `<h1>${escapeHtml(config.slug)} - Local Memory Dashboard</h1>`,
    `<p class="muted">${memories.length} live memories. Grouped for cross-chat continuity.</p>`,
    '<div class="grid">',
    renderList('Memory Banks by Type', byType),
    renderList('Memory Banks by Agent', byAgent),
    renderList('Latest Memories', latest),
    renderList('Cross-memory Links', edgeLines.map(line => `<code>${line}</code>`)),
    renderMemoryLaunchBlocks(memories.filter(m => m.type !== 'session_context')),
    renderProviderBlocks(memories),
    '</div>',
    '</div>',
    '<script>',
    'function copyPrompt(id) {',
    '  const el = document.getElementById(id);',
    '  if (!el) return Promise.resolve();',
    '  const text = el.textContent || "";',
    '  return navigator.clipboard.writeText(text);',
    '}',
    'function continueSession(providerUrl, promptId) {',
    '  copyPrompt(promptId).finally(() => window.open(providerUrl, "_blank", "noopener"));',
    '}',
    'function providerUrlFromId(provider) {',
    '  const urls = {',
    '    chatgpt: "https://chatgpt.com",',
    '    claude: "https://claude.ai/new",',
    '    codex: "https://chatgpt.com/codex",',
    '    gemini: "https://gemini.google.com",',
    '  };',
    '  return urls[provider] || urls.chatgpt;',
    '}',
    'function continueFromMemory(promptId) {',
    '  const providerEl = document.getElementById("memory-provider");',
    '  const provider = providerEl ? providerEl.value : "chatgpt";',
    '  copyPrompt(promptId).finally(() => window.open(providerUrlFromId(provider), "_blank", "noopener"));',
    '}',
    'function setProvider(provider) {',
    '  document.querySelectorAll(".provider-card").forEach((card) => {',
    '    const p = card.getAttribute("data-provider");',
    '    card.style.display = (provider === "all" || p === provider) ? "block" : "none";',
    '  });',
    '  document.querySelectorAll(".pill").forEach((pill) => {',
    '    const p = pill.getAttribute("data-provider");',
    '    if (p === provider) pill.classList.add("active"); else pill.classList.remove("active");',
    '  });',
    '}',
    'window.addEventListener("DOMContentLoaded", () => {',
    '  if (document.querySelector(".pill[data-provider=\\"chatgpt\\"]")) setProvider("chatgpt");',
    '  else setProvider("all");',
    '});',
    '</script>',
    '</body>',
    '</html>',
  ].join('\n')
}

async function openLocalDashboard(config: ProjectConfig, installShortcut = false) {
  const { cache, close } = await openCliSync(config)
  let memories: Memory[] = []
  try {
    memories = cache
      .getAllForProject(config.projectId)
      .filter((m: Memory) => m.status === 'live')
  } finally {
    close()
  }

  const outDir = getCacheDir()
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${config.slug}-local-dashboard.html`)
  fs.writeFileSync(outPath, renderLocalDashboardHtml(config, memories), 'utf-8')

  if (installShortcut) {
    const shortcut = createFolderShortcut(config, outPath)
    if (shortcut) console.log(chalk.green(`  Shortcut created in folder: ${shortcut}`))
    else console.log(chalk.yellow('  Could not create shortcut on this OS.'))
  }

  console.log(chalk.dim(`  Opening local dashboard ${outPath}...`))
  await open(outPath)
}

export async function dashboardCommand(options: DashboardOptions) {
  const config = loadProjectConfig(options.project) as ProjectConfig | null

  const url = config
    ? `${DASHBOARD_URL}/app/projects/${config.slug}`
    : DASHBOARD_URL

  if (config && (!config.supabaseUrl || options.localView || options.installShortcut)) {
    await openLocalDashboard(config, options.installShortcut)
    return
  }

  console.log(chalk.dim(`  Opening ${url}...`))
  await open(url)
}
