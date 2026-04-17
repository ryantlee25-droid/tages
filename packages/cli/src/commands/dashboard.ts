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
      `<article class="provider-card" data-provider="${escapeHtml(provider)}" data-source-provider="${escapeHtml(provider)}" data-source-type="session_context" data-topic="${escapeHtml(topic)}">`,
      `<h3>${escapeHtml(titleFromKey(memory.key))}</h3>`,
      `<p><strong>Provider:</strong> ${escapeHtml(provider.toUpperCase())}</p>`,
      context.project_label ? `<p><strong>Topic:</strong> ${escapeHtml(context.project_label)}</p>` : '',
      `<p><strong>Objective:</strong> ${escapeHtml(context.current_objective)}</p>`,
      `<p class="muted">Updated: ${escapeHtml(new Date(memory.updatedAt).toLocaleString())}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueSession('${escapeHtml(provider)}', '${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPromptAsPack('${promptId}')">Copy Pack Prompt</button>`,
      `<button class="btn secondary" onclick="exportPromptAsPack('${promptId}')">Export Pack</button>`,
      '</div>',
      '<p class="tiny muted">Portable pack launch: source is this topic, target is selected globally.</p>',
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
    '<h2>Context Packs By Source Provider</h2>',
    '<p class="muted">Pick a source topic pack. Continue launches it into the selected target provider.</p>',
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
    '<h2>Import / Export Context Packs</h2>',
    '<p class="muted">Packs are provider-agnostic JSON files. Import from text, file, or folder.</p>',
    '<p class="muted tiny">Local-only: this dashboard cannot scan or read any provider account for you.</p>',
    '<div class="import-grid">',
    '<label class="field"><span>Source Provider</span><select id="import-source-provider" class="provider-select"><option value="chatgpt">CHATGPT</option><option value="claude">CLAUDE</option><option value="grok">GROK</option><option value="gemini">GEMINI</option><option value="codex">CODEX</option><option value="other">OTHER</option></select></label>',
    '<label class="field"><span>Pack Title</span><input id="import-topic" class="text-input" placeholder="Veil of the Towers" /></label>',
    '<label class="field"><span>Author (optional)</span><input id="import-author" class="text-input" placeholder="Your name" /></label>',
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
    '<div id="imported-context-grid" class="imported-groups"></div>',
    '</section>',
  ].join('\n')
}

function renderSetupPanel(): string {
  return [
    '<section class="card full" id="setup-panel">',
    '<h2>First-Run Setup Check</h2>',
    '<p class="muted" id="setup-subtitle">Checking readiness for one-click daily launch...</p>',
    '<div id="setup-loading" class="setup-loading">Checking...</div>',
    '<div class="setup-list" id="setup-list">',
    '<div class="setup-step" id="setup-step-connector"><span class="setup-step-title">Connector Reachable</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-permission"><span class="setup-step-title">Clipboard Permission</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-provider"><span class="setup-step-title">Provider Launch Path</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-helper"><span class="setup-step-title">Optional Helper</span><span class="setup-step-status">Optional</span></div>',
    '</div>',
    '<div class="provider-actions">',
    '<button class="btn" onclick="runSetupFlow()">Run Setup Check</button>',
    '<button class="btn secondary" onclick="testSetupLaunch()">Test Launch</button>',
    '<button class="btn secondary" onclick="finishSetup()">Finish Setup</button>',
    '</div>',
    '<p id="setup-detail" class="tiny muted">Connector-based scan/injection needs one-time browser permission. Fallback launch still works without connector.</p>',
    '</section>',
  ].join('\n')
}

function renderTargetProviderBar(): string {
  return [
    '<section class="card full">',
    '<h2>Launch Target</h2>',
    '<p class="muted">Choose where packs should launch. Source and target stay separate.</p>',
    '<div class="provider-select-row">',
    '<label for="target-provider">Target provider:</label>',
    '<select id="target-provider" class="provider-select">',
    '<option value="chatgpt">ChatGPT (Enabled)</option>',
    '<option value="claude">Claude (Adapter Ready)</option>',
    '<option value="grok">Grok (Adapter Ready)</option>',
    '<option value="gemini">Gemini (Adapter Ready)</option>',
    '<option value="codex">Codex (Adapter Ready)</option>',
    '</select>',
    '<span id="target-provider-status" class="tiny muted"></span>',
    '<button class="btn secondary" onclick="showSetupPanel()">Setup</button>',
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
      `<article class="memory-launch-card" data-topic="${escapeHtml(memory.key)}" data-source-provider="local" data-source-type="${escapeHtml(memory.type)}">`,
      `<h3>${escapeHtml(memory.key)}</h3>`,
      `<p><strong>Type:</strong> ${escapeHtml(memory.type)}</p>`,
      `<p class="muted">${escapeHtml(preview)}</p>`,
      '<div class="provider-actions">',
      `<button class="btn" onclick="continueFromMemory('${promptId}')">Continue</button>`,
      `<button class="btn secondary" onclick="copyPromptAsPack('${promptId}')">Copy Pack Prompt</button>`,
      `<button class="btn secondary" onclick="exportPromptAsPack('${promptId}')">Export Pack</button>`,
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
    '<h2>Memory-Derived Packs</h2>',
    '<p class="muted">Universal packs generated from local memories.</p>',
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
    '.imported-groups { margin-top:12px; }',
    '.imported-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap:12px; margin-top:12px; }',
    '.imported-card { background: rgba(2,6,23,0.55); border:1px solid rgba(125,211,252,0.35); border-radius: 10px; padding: 12px; }',
    '.imported-card h3 { margin:0 0 8px; color:#a5f3fc; font-size: 14px; }',
    '.group-title { margin: 10px 0 4px; font-size: 12px; color: #7dd3fc; letter-spacing: 0.05em; text-transform: uppercase; }',
    '.pill { border:1px solid rgba(34,211,238,0.4); background:#0f172a; color:#e5e7eb; border-radius:999px; padding:5px 10px; cursor:pointer; font-size:12px; }',
    '.pill.active { background:#164e63; border-color:#67e8f9; }',
    '.btn { display:inline-block; background:#155e75; color:#ecfeff; text-decoration:none; padding:6px 10px; border-radius:7px; border:0; cursor:pointer; font-size:12px; }',
    '.btn.secondary { background:#334155; }',
    '.setup-loading { font-size: 12px; color: #bae6fd; margin-bottom: 10px; }',
    '.setup-list { display:grid; gap:8px; margin-bottom: 10px; }',
    '.setup-step { display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(148,163,184,0.25); border-radius:8px; padding:8px; font-size:12px; background: rgba(15,23,42,0.6); }',
    '.setup-step.ok { border-color: rgba(74,222,128,0.5); }',
    '.setup-step.missing { border-color: rgba(251,191,36,0.5); }',
    '.setup-step-title { color:#cbd5e1; }',
    '.setup-step-status { color:#e2e8f0; font-weight:600; }',
    'details { margin-top:8px; }',
    'summary { cursor:pointer; color:#7dd3fc; }',
    'pre { margin:0; white-space: pre-wrap; word-break: break-word; color: var(--text); }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="wrap">',
    `<h1>${escapeHtml(config.slug)} - Local Memory Dashboard</h1>`,
    `<p class="muted">${memories.length} live memories. Portable context launcher workflow.</p>`,
    '<div class="focus-note">Flow: first run auto-checks setup, then daily use is open app -> click tile -> continue. Packs stay provider-agnostic.</div>',
    '<div class="grid">',
    renderSetupPanel(),
    renderTargetProviderBar(),
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
    'const PACK_SCHEMA_VERSION = "memory-pack.v1";',
    'const IMPORTED_STORAGE_KEY = "tages.imported.packs.v1";',
    'const SETUP_STORAGE_KEY = "tages.setup_state_v1";',
    'const CONNECTOR_REQUEST_EVENT = "tages_connector_request";',
    'const CONNECTOR_RESPONSE_EVENT = "tages_connector_response";',
    'const PROVIDER_REGISTRY = {',
    '  chatgpt: { id: "chatgpt", label: "ChatGPT", newChatUrl: "https://chatgpt.com", prefillParam: "q", enabled: true },',
    '  claude: { id: "claude", label: "Claude", newChatUrl: "https://claude.ai/new", prefillParam: "q", enabled: false },',
    '  grok: { id: "grok", label: "Grok", newChatUrl: "https://grok.com", prefillParam: "q", enabled: false },',
    '  gemini: { id: "gemini", label: "Gemini", newChatUrl: "https://gemini.google.com", prefillParam: "q", enabled: false },',
    '  codex: { id: "codex", label: "Codex", newChatUrl: "https://chatgpt.com/codex", prefillParam: "q", enabled: false },',
    '};',
    'const LAUNCH_ADAPTERS = {',
    '  chatgpt: { launch: (pack, provider) => {',
    '    const sep = provider.newChatUrl.includes("?") ? "&" : "?";',
    '    const url = provider.newChatUrl + sep + (provider.prefillParam || "q") + "=" + encodeURIComponent(pack.prompt || "");',
    '    copyText(pack.prompt || "").finally(() => window.open(url, "_blank", "noopener"));',
    '  } },',
    '  fallback: { launch: (pack, provider) => {',
    '    copyText(pack.prompt || "").finally(() => window.open(provider.newChatUrl, "_blank", "noopener"));',
    '    window.alert("Provider adapter is scaffolded but not enabled yet. Prompt was copied.");',
    '  } },',
    '};',
    'let importedEntries = [];',
    'let setupState = {',
    '  completed: false,',
    '  connectorReachable: false,',
    '  clipboardPermission: "unknown",',
    '  helperRunning: false,',
    '  lastLaunchTestedAt: "",',
    '  lastCheckedAt: "",',
    '};',
    'function escapeHtmlClient(input) {',
    '  return String(input || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");',
    '}',
    'function slugifyClient(input) {',
    '  const base = String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");',
    '  return (base || "memory-context").slice(0, 48);',
    '}',
    'function compactLine(input, max = 200) {',
    '  const normalized = String(input || "").replace(/\\s+/g, " ").trim();',
    '  if (normalized.length <= max) return normalized;',
    '  return normalized.slice(0, max - 3) + "...";',
    '}',
    'function getTargetProviderId() {',
    '  const el = document.getElementById("target-provider");',
    '  return (el && el.value) ? el.value : "chatgpt";',
    '}',
    'function providerConfig(providerId) {',
    '  return PROVIDER_REGISTRY[providerId] || PROVIDER_REGISTRY.chatgpt;',
    '}',
    'function providerLabel(providerId) {',
    '  const cfg = providerConfig(providerId);',
    '  return cfg.label || providerId;',
    '}',
    'function loadSetupState() {',
    '  try {',
    '    const raw = localStorage.getItem(SETUP_STORAGE_KEY);',
    '    if (!raw) return;',
    '    const parsed = JSON.parse(raw);',
    '    if (!parsed || typeof parsed !== "object") return;',
    '    setupState = { ...setupState, ...parsed };',
    '  } catch {}',
    '}',
    'function saveSetupState() {',
    '  localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(setupState));',
    '}',
    'function showSetupPanel() {',
    '  const panel = document.getElementById("setup-panel");',
    '  if (panel) panel.style.display = "block";',
    '}',
    'function hideSetupPanel() {',
    '  const panel = document.getElementById("setup-panel");',
    '  if (panel) panel.style.display = "none";',
    '}',
    'function updateSetupStep(stepId, ready, label) {',
    '  const row = document.getElementById(stepId);',
    '  if (!row) return;',
    '  row.classList.remove("ok");',
    '  row.classList.remove("missing");',
    '  if (ready === true) row.classList.add("ok");',
    '  if (ready === false) row.classList.add("missing");',
    '  const status = row.querySelector(".setup-step-status");',
    '  if (status) status.textContent = label;',
    '}',
    'function setSetupSubtitle(text) {',
    '  const el = document.getElementById("setup-subtitle");',
    '  if (el) el.textContent = text;',
    '}',
    'function setSetupDetail(text) {',
    '  const el = document.getElementById("setup-detail");',
    '  if (el) el.textContent = text;',
    '}',
    'function setSetupLoading(active, text) {',
    '  const el = document.getElementById("setup-loading");',
    '  if (!el) return;',
    '  el.style.display = active ? "block" : "none";',
    '  if (text) el.textContent = text;',
    '}',
    'function connectorRequest(action, payload, timeoutMs = 900) {',
    '  return new Promise((resolve) => {',
    '    const requestId = "req-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);',
    '    let done = false;',
    '    const cleanup = () => {',
    '      if (done) return;',
    '      done = true;',
    '      clearTimeout(timer);',
    '      window.removeEventListener(CONNECTOR_RESPONSE_EVENT, onResponse);',
    '    };',
    '    const onResponse = (event) => {',
    '      const detail = event && event.detail;',
    '      if (!detail || detail.requestId !== requestId) return;',
    '      cleanup();',
    '      resolve(detail);',
    '    };',
    '    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);',
    '    window.addEventListener(CONNECTOR_RESPONSE_EVENT, onResponse);',
    '    window.dispatchEvent(new CustomEvent(CONNECTOR_REQUEST_EVENT, { detail: { requestId, action, payload } }));',
    '  });',
    '}',
    'async function detectConnector() {',
    '  const response = await connectorRequest("ping", { provider: getTargetProviderId() }, 700);',
    '  if (!response || response.ok !== true) return { reachable: false, capabilities: {} };',
    '  const capabilities = response.capabilities && typeof response.capabilities === "object" ? response.capabilities : {};',
    '  return { reachable: true, capabilities };',
    '}',
    'async function detectClipboardPermission() {',
    '  if (navigator.permissions && navigator.permissions.query) {',
    '    try {',
    '      const result = await navigator.permissions.query({ name: "clipboard-write" });',
    '      if (result && typeof result.state === "string") return result.state;',
    '    } catch {}',
    '  }',
    '  return "unknown";',
    '}',
    'async function collectSetupStatus() {',
    '  const connector = await detectConnector();',
    '  const clipboardPermission = await detectClipboardPermission();',
    '  const target = providerConfig(getTargetProviderId());',
    '  const helperRunning = Boolean(connector.reachable && connector.capabilities && connector.capabilities.helper_running === true);',
    '  return {',
    '    connectorReachable: connector.reachable,',
    '    clipboardPermission,',
    '    providerReady: Boolean(target && target.newChatUrl),',
    '    helperRunning,',
    '  };',
    '}',
    'function setupReadyForDaily(status) {',
    '  return Boolean(status.providerReady) && status.clipboardPermission !== "denied" && Boolean(setupState.lastLaunchTestedAt);',
    '}',
    'async function runSetupFlow() {',
    '  setSetupLoading(true, "Checking...");',
    '  const status = await collectSetupStatus();',
    '  setupState.connectorReachable = status.connectorReachable;',
    '  setupState.clipboardPermission = status.clipboardPermission;',
    '  setupState.helperRunning = status.helperRunning;',
    '  setupState.lastCheckedAt = new Date().toISOString();',
    '  updateSetupStep("setup-step-connector", status.connectorReachable, status.connectorReachable ? "Ready" : "Missing (optional)");',
    '  updateSetupStep("setup-step-permission", status.clipboardPermission !== "denied", status.clipboardPermission === "denied" ? "Denied" : (status.clipboardPermission || "Unknown"));',
    '  updateSetupStep("setup-step-provider", status.providerReady, status.providerReady ? "Ready" : "Missing");',
    '  updateSetupStep("setup-step-helper", status.helperRunning ? true : null, status.helperRunning ? "Running" : "Optional");',
    '  if (setupReadyForDaily(status)) {',
    '    setupState.completed = true;',
    '    setSetupSubtitle("Setup complete. Daily flow is one-click from tiles.");',
    '    setSetupDetail(status.connectorReachable ? "Connector path active for launch/injection where supported." : "Fallback path active: opens provider and copies prompt.");',
    '    hideSetupPanel();',
    '  } else {',
    '    setupState.completed = false;',
    '    showSetupPanel();',
    '    setSetupSubtitle("One-time setup is still needed. Run Test Launch once to finish.");',
    '    setSetupDetail(status.connectorReachable ? "Connector detected. Run Test Launch to confirm daily flow." : "Connector not detected. Daily fallback still works after Test Launch.");',
    '  }',
    '  saveSetupState();',
    '  updateTargetProviderStatus();',
    '  setSetupLoading(false);',
    '}',
    'function finishSetup() {',
    '  if (!setupState.lastLaunchTestedAt) {',
    '    window.alert("Run Test Launch once before finishing setup.");',
    '    return;',
    '  }',
    '  setupState.completed = true;',
    '  saveSetupState();',
    '  runSetupFlow();',
    '}',
    'async function testSetupLaunch() {',
    '  const sample = createPack({',
    '    title: "Setup Test Pack",',
    '    summary: "Checks provider handoff path",',
    '    prompt: "SETUP TEST: If you see this, handoff launch is working.",',
    '    source_provider: "local",',
    '    source_type: "setup_test",',
    '    tags: ["setup-test"],',
    '  });',
    '  await launchPack(sample);',
    '  setupState.lastLaunchTestedAt = new Date().toISOString();',
    '  saveSetupState();',
    '  runSetupFlow();',
    '}',
    'function updateTargetProviderStatus() {',
    '  const el = document.getElementById("target-provider-status");',
    '  if (!el) return;',
    '  const target = providerConfig(getTargetProviderId());',
    '  const mode = setupState.connectorReachable ? "connector handoff" : "copy + open fallback";',
    '  el.textContent = providerLabel(target.id) + " ready via " + mode + ".";',
    '}',
    'function createPack(data) {',
    '  const prompt = String(data.prompt || "").trim();',
    '  return {',
    '    version: PACK_SCHEMA_VERSION,',
    '    title: String(data.title || "Untitled Pack").trim(),',
    '    summary: String(data.summary || compactLine(prompt, 220)),',
    '    prompt,',
    '    tags: Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === "string") : [],',
    '    source_provider: String(data.source_provider || "unknown"),',
    '    source_type: String(data.source_type || "context"),',
    '    created_at: String(data.created_at || new Date().toISOString()),',
    '    author: typeof data.author === "string" ? data.author : "",',
    '    notes: typeof data.notes === "string" ? data.notes : "",',
    '    metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},',
    '  };',
    '}',
    'function readPrompt(id) {',
    '  const el = document.getElementById(id);',
    '  return el ? (el.textContent || "") : "";',
    '}',
    'function copyText(text) {',
    '  const value = String(text || "");',
    '  if (!value) return Promise.resolve();',
    '  if (navigator.clipboard && navigator.clipboard.writeText) {',
    '    return navigator.clipboard.writeText(value).catch(() => {',
    '      const area = document.createElement("textarea");',
    '      area.value = value;',
    '      area.setAttribute("readonly", "true");',
    '      area.style.position = "fixed";',
    '      area.style.opacity = "0";',
    '      document.body.appendChild(area);',
    '      area.select();',
    '      try { document.execCommand("copy"); } catch {}',
    '      area.remove();',
    '    });',
    '  }',
    '  const area = document.createElement("textarea");',
    '  area.value = value;',
    '  area.setAttribute("readonly", "true");',
    '  area.style.position = "fixed";',
    '  area.style.opacity = "0";',
    '  document.body.appendChild(area);',
    '  area.select();',
    '  try { document.execCommand("copy"); } catch {}',
    '  area.remove();',
    '  return Promise.resolve();',
    '}',
    'async function connectorLaunchPack(pack, targetProviderId) {',
    '  const response = await connectorRequest("launch", { provider: targetProviderId, pack }, 1200);',
    '  return Boolean(response && response.ok === true);',
    '}',
    'async function launchPack(pack, explicitTargetProvider) {',
    '  const targetProviderId = explicitTargetProvider || getTargetProviderId();',
    '  const cfg = providerConfig(targetProviderId);',
    '  const launchedByConnector = await connectorLaunchPack(pack, targetProviderId);',
    '  if (launchedByConnector) {',
    '    setupState.connectorReachable = true;',
    '    saveSetupState();',
    '    updateTargetProviderStatus();',
    '    return;',
    '  }',
    '  const adapter = (cfg.enabled && LAUNCH_ADAPTERS[targetProviderId]) ? LAUNCH_ADAPTERS[targetProviderId] : LAUNCH_ADAPTERS.fallback;',
    '  adapter.launch(pack, cfg);',
    '}',
    'function packFromPromptNode(promptId, fallbackSourceProvider, fallbackSourceType) {',
    '  const prompt = readPrompt(promptId);',
    '  if (!prompt) return null;',
    '  const pre = document.getElementById(promptId);',
    '  const card = pre ? pre.closest("[data-topic]") : null;',
    '  const title = card && card.getAttribute("data-topic") ? card.getAttribute("data-topic") : "Untitled Pack";',
    '  const sourceProvider = card && card.getAttribute("data-source-provider") ? card.getAttribute("data-source-provider") : (fallbackSourceProvider || "unknown");',
    '  const sourceType = card && card.getAttribute("data-source-type") ? card.getAttribute("data-source-type") : (fallbackSourceType || "context");',
    '  return createPack({',
    '    title,',
    '    prompt,',
    '    source_provider: sourceProvider,',
    '    source_type: sourceType,',
    '    tags: [ "portable-pack", "dashboard-export" ],',
    '    metadata: { exported_from: "local_dashboard" },',
    '  });',
    '}',
    'async function continueSession(provider, promptId) {',
    '  const pack = packFromPromptNode(promptId, provider || "unknown", "session_context");',
    '  if (!pack) return;',
    '  await launchPack(pack);',
    '}',
    'async function continueFromMemory(promptId) {',
    '  const pack = packFromPromptNode(promptId, "local", "memory_snapshot");',
    '  if (!pack) return;',
    '  await launchPack(pack);',
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
    'function copyPromptAsPack(promptId) {',
    '  const pack = packFromPromptNode(promptId, "local", "context");',
    '  if (!pack) return;',
    '  copyText(pack.prompt);',
    '}',
    'function exportPromptAsPack(promptId) {',
    '  const pack = packFromPromptNode(promptId, "local", "context");',
    '  if (!pack) return;',
    '  const safeTitle = slugifyClient(pack.title || "context-pack");',
    '  downloadJson(`${safeTitle}-pack.json`, pack);',
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
    '  return { prompt: lines.join("\\n"), title: topic || "Imported Session Context", summary };',
    '}',
    'function normalizePack(raw, fallbackProvider, fallbackTitle, fallbackAuthor) {',
    '  if (!raw || typeof raw !== "object") return null;',
    '  if (typeof raw.version === "string" && typeof raw.prompt === "string") {',
    '    return createPack({',
    '      title: raw.title || fallbackTitle || "Imported Pack",',
    '      summary: raw.summary || "",',
    '      prompt: raw.prompt || "",',
    '      tags: raw.tags || [],',
    '      source_provider: raw.source_provider || raw.provider || fallbackProvider || "unknown",',
    '      source_type: raw.source_type || raw.sourceType || "imported_pack",',
    '      created_at: raw.created_at || new Date().toISOString(),',
    '      author: raw.author || fallbackAuthor || "",',
    '      notes: raw.notes || "",',
    '      metadata: raw.metadata || {},',
    '    });',
    '  }',
    '  if (typeof raw.prompt === "string") {',
    '    return createPack({',
    '      title: raw.topic || raw.title || fallbackTitle || "Imported Pack",',
    '      summary: raw.summary || "",',
    '      prompt: raw.prompt,',
    '      source_provider: raw.provider || fallbackProvider || "unknown",',
    '      source_type: "legacy_prompt_object",',
    '      author: raw.author || fallbackAuthor || "",',
    '      metadata: { imported_from: "legacy_prompt_object" },',
    '    });',
    '  }',
    '  const built = parseJsonPromptObject(raw);',
    '  if (!built.prompt) return null;',
    '  return createPack({',
    '    title: fallbackTitle || built.title || "Imported Session Context",',
    '    summary: built.summary || "",',
    '    prompt: built.prompt,',
    '    source_provider: fallbackProvider || "unknown",',
    '    source_type: "session_like_import",',
    '    author: fallbackAuthor || "",',
    '    metadata: { imported_from: "session_like" },',
    '  });',
    '}',
    'function parseImportedPayload(raw, fallbackProvider, fallbackTitle, fallbackAuthor) {',
    '  const cleaned = String(raw || "").trim();',
    '  if (!cleaned) return [];',
    '  try {',
    '    const parsed = JSON.parse(cleaned);',
    '    if (parsed && typeof parsed === "object" && Array.isArray(parsed.packs)) {',
    '      return parsed.packs.map((item) => normalizePack(item, fallbackProvider, fallbackTitle, fallbackAuthor)).filter(Boolean);',
    '    }',
    '    if (Array.isArray(parsed)) {',
    '      return parsed.map((item) => normalizePack(item, fallbackProvider, fallbackTitle, fallbackAuthor)).filter(Boolean);',
    '    }',
    '    const single = normalizePack(parsed, fallbackProvider, fallbackTitle, fallbackAuthor);',
    '    return single ? [single] : [];',
    '  } catch {',
    '    return [createPack({',
    '      title: fallbackTitle || "Imported Text Pack",',
    '      summary: compactLine(cleaned, 220),',
    '      prompt: cleaned,',
    '      source_provider: fallbackProvider || "unknown",',
    '      source_type: "plain_text_import",',
    '      author: fallbackAuthor || "",',
    '      metadata: { imported_from: "plain_text" },',
    '    })];',
    '  }',
    '}',
    'function sanitizeImportedId(value) {',
    '  const cleaned = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");',
    '  return cleaned || ("pack-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10));',
    '}',
    'function saveImported() {',
    '  localStorage.setItem(IMPORTED_STORAGE_KEY, JSON.stringify(importedEntries));',
    '}',
    'function loadImported() {',
    '  try {',
    '    const raw = localStorage.getItem(IMPORTED_STORAGE_KEY);',
    '    const parsed = raw ? JSON.parse(raw) : [];',
    '    importedEntries = Array.isArray(parsed) ? parsed.map((entry) => ({',
    '      ...entry,',
    '      id: sanitizeImportedId(entry && entry.id),',
    '    })) : [];',
    '  } catch {',
    '    importedEntries = [];',
    '  }',
    '}',
    'function removeImported(id) {',
    '  importedEntries = importedEntries.filter((entry) => entry.id !== id);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'async function continueImported(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  await launchPack(found);',
    '}',
    'function copyImported(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  copyText(found.prompt || "");',
    '}',
    'function exportImportedOne(id) {',
    '  const found = importedEntries.find((entry) => entry.id === id);',
    '  if (!found) return;',
    '  const safeTitle = slugifyClient(found.title || "imported-pack");',
    '  downloadJson(`${safeTitle}-pack.json`, found);',
    '}',
    'function renderImported() {',
    '  const container = document.getElementById("imported-context-grid");',
    '  if (!container) return;',
    '  if (!importedEntries.length) {',
    '    container.innerHTML = "<p class=\\"muted\\">No imported packs yet.</p>";',
    '    return;',
    '  }',
    '  const groups = {};',
    '  importedEntries.forEach((entry) => {',
    '    const source = entry.source_provider || "unknown";',
    '    if (!groups[source]) groups[source] = [];',
    '    groups[source].push(entry);',
    '  });',
    '  const html = Object.keys(groups).sort().map((source) => {',
    '    const cards = groups[source].map((entry) => {',
    '      const title = escapeHtmlClient(entry.title || "Imported Pack");',
    '      const summary = escapeHtmlClient(entry.summary || "");',
    '      const prompt = escapeHtmlClient(entry.prompt || "");',
    '      const tags = Array.isArray(entry.tags) && entry.tags.length ? escapeHtmlClient(entry.tags.join(", ")) : "";',
    '      const updated = escapeHtmlClient(new Date(entry.updatedAt || entry.created_at || Date.now()).toLocaleString());',
    '      return [',
    '        "<article class=\\"imported-card\\">",',
    '        "<h3>" + title + "</h3>",',
    '        "<p><strong>Source:</strong> " + escapeHtmlClient(providerLabel(entry.source_provider || "unknown")) + " (" + escapeHtmlClient(entry.source_type || "context") + ")</p>",',
    '        (summary ? "<p class=\\"muted tiny\\">" + summary + "</p>" : ""),',
    '        "<p class=\\"muted tiny\\">Imported: " + updated + "</p>",',
    '        (tags ? "<p class=\\"muted tiny\\">Tags: " + tags + "</p>" : ""),',
    '        "<div class=\\"provider-actions\\">",',
    '        "<button class=\\"btn\\" onclick=\\"continueImported(\\\'" + entry.id + "\\\')\\">Continue</button>",',
    '        "<button class=\\"btn secondary\\" onclick=\\"copyImported(\\\'" + entry.id + "\\\')\\">Copy</button>",',
    '        "<button class=\\"btn secondary\\" onclick=\\"exportImportedOne(\\\'" + entry.id + "\\\')\\">Export</button>",',
    '        "<button class=\\"btn secondary\\" onclick=\\"removeImported(\\\'" + entry.id + "\\\')\\">Remove</button>",',
    '        "</div>",',
    '        "<details><summary>View Prompt</summary><pre>" + prompt + "</pre></details>",',
    '        "</article>",',
    '      ].join("");',
    '    }).join("");',
    '    return "<div class=\\"group-title\\">Source: " + escapeHtmlClient(providerLabel(source)) + "</div><div class=\\"imported-grid\\">" + cards + "</div>";',
    '  }).join("");',
    '  container.innerHTML = html;',
    '}',
    'function addImported(raw, sourceProvider, topic, author) {',
    '  const packs = parseImportedPayload(raw, sourceProvider, topic, author);',
    '  if (!packs.length) return;',
    '  const enriched = packs.map((pack) => ({ id: sanitizeImportedId(`${Date.now()}-${Math.random().toString(16).slice(2)}`), ...pack, updatedAt: new Date().toISOString() }));',
    '  importedEntries = [...enriched, ...importedEntries].slice(0, 120);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'function importFromTextarea() {',
    '  const provider = (document.getElementById("import-source-provider") || {}).value || "unknown";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  const author = (document.getElementById("import-author") || {}).value || "";',
    '  const text = (document.getElementById("import-text") || {}).value || "";',
    '  if (!String(text).trim()) return;',
    '  addImported(text, provider, topic, author);',
    '}',
    'function importFromFilePicker() {',
    '  const input = document.getElementById("import-file");',
    '  const provider = (document.getElementById("import-source-provider") || {}).value || "unknown";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  const author = (document.getElementById("import-author") || {}).value || "";',
    '  if (!input || !input.files || !input.files.length) return;',
    '  const file = input.files[0];',
    '  const reader = new FileReader();',
    '  reader.onload = () => addImported(String(reader.result || ""), provider, topic || file.name, author);',
    '  reader.readAsText(file);',
    '}',
    'function importFromDirectoryPicker() {',
    '  const input = document.getElementById("import-dir");',
    '  const provider = (document.getElementById("import-source-provider") || {}).value || "unknown";',
    '  const topic = (document.getElementById("import-topic") || {}).value || "";',
    '  const author = (document.getElementById("import-author") || {}).value || "";',
    '  if (!input || !input.files || !input.files.length) return;',
    '  Array.from(input.files).slice(0, 80).forEach((file) => {',
    '    const reader = new FileReader();',
    '    reader.onload = () => addImported(String(reader.result || ""), provider, topic || file.name, author);',
    '    reader.readAsText(file);',
    '  });',
    '}',
    'function exportImportedAll() {',
    '  if (!importedEntries.length) return;',
    '  downloadJson(`context-pack-collection-${new Date().toISOString().slice(0, 10)}.json`, { version: PACK_SCHEMA_VERSION, packs: importedEntries });',
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
    '  const targetProviderEl = document.getElementById("target-provider");',
    '  if (targetProviderEl) targetProviderEl.addEventListener("change", () => { updateTargetProviderStatus(); runSetupFlow(); });',
    '  loadSetupState();',
    '  updateTargetProviderStatus();',
    '  if (!setupState.completed) showSetupPanel(); else hideSetupPanel();',
    '  runSetupFlow();',
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
