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

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3)
}

function compactText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

function sectionForMemoryType(type: Memory['type']): string {
  if (type === 'decision' || type === 'architecture' || type === 'entity' || type === 'environment') return 'Canon'
  if (type === 'convention' || type === 'anti_pattern' || type === 'operational') return 'Constraints'
  if (type === 'execution' || type === 'pattern') return 'Active Threads'
  if (type === 'preference' || type === 'lesson') return 'Tone and Preferences'
  return 'Other'
}

function deriveSessionTokens(memory: Memory, context: SessionContextMemory): string[] {
  const tags = (context.optional_tags || memory.tags || [])
    .filter(tag => !tag.toLowerCase().startsWith('provider:') && !tag.toLowerCase().startsWith('session_'))
    .join(' ')

  const source = [
    context.project_label || '',
    context.current_objective || '',
    context.working_summary || '',
    memory.key,
    tags,
  ].join(' ')

  const unique = new Set<string>(tokenize(source))
  return Array.from(unique).slice(0, 18)
}

function memoryMatchScore(memory: Memory, tokens: string[]): number {
  const haystack = [
    memory.key,
    memory.value.slice(0, 2400),
    (memory.tags || []).join(' '),
    memory.type,
  ].join(' ').toLowerCase()

  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 3
  }

  if (memory.type === 'decision' || memory.type === 'anti_pattern') score += 2
  if (memory.type === 'execution' || memory.type === 'pattern') score += 1
  return score
}

function buildDeepSessionPrompt(
  sessionMemory: Memory,
  context: SessionContextMemory,
  allMemories: Memory[],
): string {
  const base = rehydrate_session_context(context, 'prompt')
  const tokens = deriveSessionTokens(sessionMemory, context)
  const longTermLive = allMemories.filter(m => m.type !== 'session_context' && m.status === 'live')

  const matched = longTermLive
    .map(m => ({ memory: m, score: memoryMatchScore(m, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.memory.confidence !== a.memory.confidence) return b.memory.confidence - a.memory.confidence
      return Date.parse(b.memory.updatedAt) - Date.parse(a.memory.updatedAt)
    })
    .slice(0, 14)
    .map(item => item.memory)

  const fallbackRecent = longTermLive
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 10)

  const related = matched.length > 0 ? matched : fallbackRecent

  if (related.length === 0) return base

  const grouped = new Map<string, string[]>()
  for (const memory of related) {
    const section = sectionForMemoryType(memory.type)
    if (!grouped.has(section)) grouped.set(section, [])
    grouped.get(section)!.push(`- ${memory.key}: ${compactText(memory.value)}`)
  }

  const orderedSections = ['Canon', 'Constraints', 'Active Threads', 'Tone and Preferences', 'Other']
  const lines: string[] = [base, '', 'RELATED PROJECT MEMORY']
  for (const section of orderedSections) {
    const bullets = grouped.get(section)
    if (!bullets || bullets.length === 0) continue
    lines.push(`${section}:`)
    lines.push(...bullets)
  }
  lines.push('')
  lines.push('Instruction: Use both the session handoff and related project memory as canonical context.')
  return lines.join('\n')
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
    const prompt = buildDeepSessionPrompt(memory, context, memories)
    const jsonView = JSON.stringify(context, null, 2)
    const promptId = `provider-prompt-${index}`
    const topic = context.project_label || titleFromKey(memory.key)

    blocks.push([
      `<article class="provider-card" data-provider="${escapeHtml(provider)}" data-topic="${escapeHtml(topic)}">`,
      `<h3>${escapeHtml(titleFromKey(memory.key))}</h3>`,
      `<p><strong>Provider:</strong> ${escapeHtml(provider.toUpperCase())}</p>`,
      context.project_label ? `<p><strong>Topic:</strong> ${escapeHtml(context.project_label)}</p>` : '',
      `<p><strong>Objective:</strong> ${escapeHtml(context.current_objective)}</p>`,
      `<p class="muted">Updated: ${escapeHtml(new Date(memory.updatedAt).toLocaleString())}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueSession('${escapeHtml(provider)}', '${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPrompt('${promptId}')">Copy Deep Context</button>`,
      `<button class="btn secondary" onclick="exportPrompt('${promptId}')">Export</button>`,
      '</div>',
      '<p class="tiny muted">Continue copies a deep handoff (session + related canon memory).</p>',
      '<details>',
      '<summary>View Deep Context</summary>',
      `<pre id="${promptId}">${escapeHtml(prompt)}</pre>`,
      '</details>',
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
    '<h2>Topics By Provider</h2>',
    '<p class="muted">Pick provider and topic. Continue opens a fresh chat and copies deep context.</p>',
    `<div class="provider-pills">${pills.join('')}</div>`,
    '<div class="provider-grid">',
    ...blocks,
    '</div>',
    '</section>',
  ].join('\n')
}

function renderImportExportPanel(): string {
  return [
    '<section class="card full">',
    '<h2>Import / Export Memory Context</h2>',
    '<p class="muted">Import context files from a folder or paste transcript text. Imported tiles show up below.</p>',
    '<div class="import-grid">',
    '<label class="field"><span>Provider</span><select id="import-provider" class="provider-select"><option value="chatgpt">CHATGPT</option><option value="claude">CLAUDE</option><option value="codex">CODEX</option><option value="gemini">GEMINI</option></select></label>',
    '<label class="field"><span>Topic label</span><input id="import-topic" class="text-input" placeholder="Veil of the Towers" /></label>',
    '<label class="field wide"><span>Paste transcript or handoff text</span><textarea id="import-text" rows="4" class="text-area" placeholder="Paste chat notes, transcript, or exported memory JSON..."></textarea></label>',
    '<div class="import-controls">',
    '<input id="import-file" type="file" class="file-input" accept=".json,.txt,.md" />',
    '<input id="import-dir" type="file" class="file-input" webkitdirectory directory multiple />',
    '<button class="btn" onclick="importFromTextarea()">Import Text</button>',
    '<button class="btn secondary" onclick="importFromFilePicker()">Import File</button>',
    '<button class="btn secondary" onclick="importFromDirectoryPicker()">Import Directory</button>',
    '<button class="btn secondary" onclick="exportImportedAll()">Export Imported</button>',
    '</div>',
    '</div>',
    '<div id="imported-context-grid" class="imported-grid"></div>',
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
      `<article class="memory-launch-card" data-topic="${escapeHtml(memory.key)}">`,
      `<h3>${escapeHtml(memory.key)}</h3>`,
      `<p><strong>Type:</strong> ${escapeHtml(memory.type)}</p>`,
      `<p class="muted">${escapeHtml(preview)}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueFromMemory('${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPrompt('${promptId}')">Copy Context</button>`,
      `<button class="btn secondary" onclick="exportPrompt('${promptId}')">Export</button>`,
      '</div>',
      '<details>',
      '<summary>View Context</summary>',
      `<pre id="${promptId}">${escapeHtml(prompt)}</pre>`,
      '</details>',
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

function createShareableDashboardCopy(config: ProjectConfig, sourceDashboardPath: string): string | null {
  const folder = process.cwd()
  if (!fs.existsSync(folder)) return null

  const safeSlug = config.slug.replace(/[^a-zA-Z0-9-_]/g, '-')
  const shareablePath = path.join(folder, `Tages-${safeSlug}-local-dashboard.html`)
  fs.copyFileSync(sourceDashboardPath, shareablePath)
  return shareablePath
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
    '.tiny { font-size: 11px; margin: 6px 0 0; }',
    '.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(300px,1fr)); gap: 16px; }',
    '.card { background: rgba(17,24,39,0.85); border:1px solid rgba(34,211,238,0.25); border-radius: 14px; padding: 14px 16px; }',
    '.full { grid-column: 1 / -1; }',
    '.card h2 { margin:0 0 10px; font-size: 16px; color: var(--accent); }',
    '.focus-note { background: rgba(14,116,144,0.18); border: 1px solid rgba(34,211,238,0.35); border-radius: 10px; padding: 10px 12px; font-size: 12px; color: #d9f3fb; margin-bottom: 14px; }',
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
    '.import-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 10px; }',
    '.field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:#cbd5e1; }',
    '.field.wide { grid-column: 1 / -1; }',
    '.text-input, .text-area, .file-input { border:1px solid rgba(148,163,184,0.35); background:#0f172a; color:#e5e7eb; border-radius:8px; padding:8px; font-size:12px; }',
    '.import-controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }',
    '.imported-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:12px; margin-top:12px; }',
    '.imported-card { background: rgba(2,6,23,0.55); border:1px solid rgba(125,211,252,0.35); border-radius: 10px; padding: 12px; }',
    '.imported-card h3 { margin:0 0 8px; color:#a5f3fc; font-size: 14px; }',
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
    `<p class="muted">${memories.length} live memories. Built for fast session handoff.</p>`,
    '<div class="focus-note">Flow: pick provider/topic tile -> Continue -> new chat opens with context copied and prefill attempted.</div>',
    '<div class="grid">',
    renderProviderBlocks(memories),
    renderImportExportPanel(),
    renderMemoryLaunchBlocks(memories.filter(m => m.type !== 'session_context')),
    [
      '<section class="card full">',
      '<details>',
      '<summary>Advanced View (Raw Memory Banks)</summary>',
      '<div class="grid" style="margin-top:12px;">',
      renderList('Memory Banks by Type', byType),
      renderList('Memory Banks by Agent', byAgent),
      renderList('Latest Memories', latest),
      renderList('Cross-memory Links', edgeLines.map(line => `<code>${line}</code>`)),
      '</div>',
      '</details>',
      '</section>',
    ].join('\n'),
    '</div>',
    '</div>',
    '<script>',
    'const IMPORTED_STORAGE_KEY = "tages.imported.context.v1";',
    'let importedEntries = [];',
    'function escapeHtmlClient(input) {',
    '  return String(input || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '}',
    'function slugifyClient(input) {',
    '  const base = String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");',
    '  return (base || "memory-context").slice(0, 48);',
    '}',
    'function readPrompt(id) {',
    '  const el = document.getElementById(id);',
    '  return el ? (el.textContent || "") : "";',
    '}',
    'function copyText(text) {',
    '  return navigator.clipboard.writeText(text);',
    '}',
    'function copyPrompt(id) {',
    '  const text = readPrompt(id);',
    '  if (!text) return Promise.resolve();',
    '  return copyText(text);',
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
    'function providerUrlWithPrefill(provider, prompt) {',
    '  const base = providerUrlFromId(provider);',
    '  const separator = base.includes("?") ? "&" : "?";',
    '  return `${base}${separator}q=${encodeURIComponent(prompt)}`;',
    '}',
    'function continueWithPrompt(provider, prompt) {',
    '  const destination = providerUrlWithPrefill(provider, prompt);',
    '  copyText(prompt).finally(() => window.open(destination, "_blank", "noopener"));',
    '}',
    'function continueSession(provider, promptId) {',
    '  const prompt = readPrompt(promptId);',
    '  if (!prompt) return;',
    '  continueWithPrompt(provider, prompt);',
    '}',
    'function continueFromMemory(promptId) {',
    '  const providerEl = document.getElementById("memory-provider");',
    '  const provider = providerEl ? providerEl.value : "chatgpt";',
    '  const prompt = readPrompt(promptId);',
    '  if (!prompt) return;',
    '  continueWithPrompt(provider, prompt);',
    '}',
    'function downloadJson(filename, payload) {',
    '  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });',
    '  const url = URL.createObjectURL(blob);',
    '  const a = document.createElement("a");',
    '  a.href = url;',
    '  a.download = filename;',
    '  document.body.appendChild(a);',
    '  a.click();',
    '  a.remove();',
    '  URL.revokeObjectURL(url);',
    '}',
    'function exportPrompt(promptId) {',
    '  const prompt = readPrompt(promptId);',
    '  if (!prompt) return;',
    '  const pre = document.getElementById(promptId);',
    '  const card = pre ? pre.closest("[data-topic]") : null;',
    '  const topic = card ? card.getAttribute("data-topic") : "memory-context";',
    '  const provider = card ? (card.getAttribute("data-provider") || "chatgpt") : "chatgpt";',
    '  const safeTopic = slugifyClient(topic || "memory-context");',
    '  downloadJson(`${safeTopic}-memory-context.json`, { provider, topic, prompt, exported_at: new Date().toISOString() });',
    '}',
    'function parseJsonPromptObject(obj) {',
    '  const objective = obj.current_objective || obj.current_goal || obj.objective || "Continue from imported context.";',
    '  const summary = obj.working_summary || obj.working_state_summary || obj.summary || "";',
    '  const constraints = Array.isArray(obj.active_constraints) ? obj.active_constraints : [];',
    '  const decisions = Array.isArray(obj.recent_decisions) ? obj.recent_decisions : [];',
    '  const questions = Array.isArray(obj.open_questions) ? obj.open_questions : [];',
    '  const issues = Array.isArray(obj.known_issues) ? obj.known_issues : [];',
    '  const topic = obj.project_label || obj.topic || "";',
    '  const lines = ["SESSION HANDOFF (SHORT-LIVED)", `Current objective: ${objective}`];',
    '  if (topic) lines.push(`Project/topic: ${topic}`);',
    '  if (constraints.length) { lines.push("Active constraints:"); constraints.forEach((v) => lines.push(`- ${v}`)); }',
    '  if (decisions.length) { lines.push("Recent decisions:"); decisions.forEach((v) => lines.push(`- ${v}`)); }',
    '  if (questions.length) { lines.push("Open questions:"); questions.forEach((v) => lines.push(`- ${v}`)); }',
    '  if (issues.length) { lines.push("Known issues:"); issues.forEach((v) => lines.push(`- ${v}`)); }',
    '  if (summary) lines.push(`Working summary: ${summary}`);',
    '  lines.push("Instruction: Continue from this handoff. Preserve continuity and ask before making assumptions.");',
    '  return { prompt: lines.join("\\n"), topic };',
    '}',
    'function parseImportedPayload(raw, fallbackProvider, fallbackTopic) {',
    '  const cleaned = String(raw || "").trim();',
    '  let provider = fallbackProvider || "chatgpt";',
    '  let topic = fallbackTopic || "";',
    '  let prompt = cleaned;',
    '  try {',
    '    const parsed = JSON.parse(cleaned);',
    '    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {',
    '      const built = parseJsonPromptObject(parsed[0]);',
    '      prompt = built.prompt;',
    '      topic = topic || built.topic;',
    '    } else if (parsed && typeof parsed === "object") {',
    '      if (typeof parsed.provider === "string") provider = parsed.provider.toLowerCase();',
    '      if (typeof parsed.topic === "string") topic = topic || parsed.topic;',
    '      if (typeof parsed.prompt === "string") prompt = parsed.prompt;',
      '      else {',
    '        const built = parseJsonPromptObject(parsed);',
    '        prompt = built.prompt;',
    '        topic = topic || built.topic;',
    '      }',
    '    }',
    '  } catch {}',
    '  return { provider, topic: topic || "Imported Context", prompt };',
    '}',
    'function saveImported() {',
    '  localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(importedEntries));',
    '}',
    'function loadImported() {',
    '  try {',
    '    const raw = localStorage.getItem(IMPORTED_STORAGE_KEY);',
    '    importedEntries = raw ? JSON.parse(raw) : [];',
    '  } catch {',
    '    importedEntries = [];',
    '  }',
    '}',
    'function removeImported(id) {',
    '  importedEntries = importedEntries.filter((entry) => entry.id !== id);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'function continueImported(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  continueWithPrompt(found.provider || "chatgpt", found.prompt || "");',
    '}',
    'function copyImported(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  copyText(found.prompt || "");',
    '}',
    'function exportImportedOne(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  const safeTopic = slugifyClient(found.topic || "imported-context");',
    '  downloadJson(`${safeTopic}-memory-context.json`, { provider: found.provider, topic: found.topic, prompt: found.prompt, exported_at: new Date().toISOString() });',
    '}',
    'function renderImported() {',
    '  const container = document.getElementById("imported-context-grid");',
    '  if (!container) return;',
    '  if (!importedEntries.length) {',
    '    container.innerHTML = "<p class=\\"muted\\">No imported contexts yet.</p>";',
    '    return;',
    '  }',
    '  container.innerHTML = importedEntries.map((entry) => {',
    '    const provider = escapeHtmlClient(entry.provider || "chatgpt");',
    '    const topic = escapeHtmlClient(entry.topic || "Imported Context");',
    '    const prompt = escapeHtmlClient(entry.prompt || "");',
    '    const updated = escapeHtmlClient(new Date(entry.updatedAt || Date.now()).toLocaleString());',
    '    return [',
    '      `<article class=\\"imported-card\\" data-provider=\\"${provider}\\" data-topic=\\"${topic}\\">`,',
    '      `<h3>${topic}</h3>`,',
    '      `<p><strong>Provider:</strong> ${provider.toUpperCase()}</p>`,',
    '      `<p class=\\"muted tiny\\">Imported: ${updated}</p>`,',
    '      "<div class=\\"provider-actions\\">",',
    '      `<button class=\\"btn\\" onclick=\\"continueImported(\\\'${entry.id}\\\')\\">Continue</button>`,',
    '      `<button class=\\"btn secondary\\" onclick=\\"copyImported(\\\'${entry.id}\\\')\\">Copy</button>`,',
    '      `<button class=\\"btn secondary\\" onclick=\\"exportImportedOne(\\\'${entry.id}\\\')\\">Export</button>`,',
    '      `<button class=\\"btn secondary\\" onclick=\\"removeImported(\\\'${entry.id}\\\')\\">Remove</button>`,',
    '      "</div>",',
    '      "<details><summary>View Context</summary>",',
    '      `<pre>${prompt}</pre>`,',
    '      "</details>",',
    '      "</article>",',
    '    ].join("");',
    '  }).join("");',
    '}',
    'function addImported(raw, provider, topic) {',
    '  const parsed = parseImportedPayload(raw, provider, topic);',
    '  if (!parsed.prompt || !parsed.prompt.trim()) return;',
    '  importedEntries.unshift({',
    '    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,',
    '    provider: parsed.provider || "chatgpt",',
    '    topic: parsed.topic || "Imported Context",',
    '    prompt: parsed.prompt,',
    '    updatedAt: new Date().toISOString(),',
    '  });',
    '  importedEntries = importedEntries.slice(0, 60);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'function importFromTextarea() {',
    '  const provider = (document.getElementById("import-provider") || {}).value || "chatgpt";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  const text = (document.getElementById("import-text") || {}).value || "";',
    '  if (!String(text).trim()) return;',
    '  addImported(text, provider, topic);',
    '}',
    'function importFromFilePicker() {',
    '  const input = document.getElementById("import-file");',
    '  const provider = (document.getElementById("import-provider") || {}).value || "chatgpt";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  if (!input || !input.files || !input.files.length) return;',
    '  const file = input.files[0];',
    '  const reader = new FileReader();',
    '  reader.onload = () => addImported(String(reader.result || ""), provider, topic || file.name);',
    '  reader.readAsText(file);',
    '}',
    'function importFromDirectoryPicker() {',
    '  const input = document.getElementById("import-dir");',
    '  const provider = (document.getElementById("import-provider") || {}).value || "chatgpt";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  if (!input || !input.files || !input.files.length) return;',
    '  Array.from(input.files).slice(0, 80).forEach((file) => {',
    '    const reader = new FileReader();',
    '    reader.onload = () => addImported(String(reader.result || ""), provider, topic || file.name);',
    '    reader.readAsText(file);',
    '  });',
    '}',
    'function exportImportedAll() {',
    '  if (!importedEntries.length) return;',
    '  downloadJson(`imported-memory-contexts-${new Date().toISOString().slice(0, 10)}.json`, importedEntries);',
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
    '  loadImported();',
    '  renderImported();',
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
  let openPath = outPath

  if (installShortcut) {
    const shareablePath = createShareableDashboardCopy(config, outPath)
    if (!shareablePath) {
      console.log(chalk.yellow('  Could not create shareable dashboard copy in current folder.'))
    } else {
      openPath = shareablePath
      console.log(chalk.green(`  Shareable dashboard file created: ${shareablePath}`))
      const shortcut = createFolderShortcut(config, shareablePath)
      if (shortcut) console.log(chalk.green(`  Shortcut created in folder: ${shortcut}`))
      else console.log(chalk.yellow('  Could not create shortcut on this OS.'))
    }
  }

  console.log(chalk.dim(`  Opening local dashboard ${openPath}...`))
  await open(openPath)
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
