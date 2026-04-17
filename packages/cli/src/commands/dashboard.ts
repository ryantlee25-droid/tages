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
    '<p class="muted tiny">Manual import always works. Provider topic scan works when a connector exposes scan capability.</p>',
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
    '<h2>First-Run Setup</h2>',
    '<p class="muted" id="setup-subtitle">Refresh status, run a launch test once, then finish setup.</p>',
    '<div id="setup-loading" class="setup-loading">Checking...</div>',
    '<div class="setup-list" id="setup-list">',
    '<div class="setup-step" id="setup-step-connector"><span class="setup-step-title">Connector Reachable</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-permission"><span class="setup-step-title">Clipboard Permission</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-provider"><span class="setup-step-title">Provider Launch Path</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-scan"><span class="setup-step-title">Provider Topic Scan</span><span class="setup-step-status">Checking</span></div>',
    '<div class="setup-step" id="setup-step-helper"><span class="setup-step-title">Optional Helper</span><span class="setup-step-status">Optional</span></div>',
    '</div>',
    '<div class="provider-actions">',
    '<button id="setup-refresh-btn" class="btn" onclick="runSetupFlow()">Refresh Status</button>',
    '<button id="setup-connect-btn" class="btn secondary" onclick="tryExternalConnectorSetup()">Connect Provider</button>',
    '<button id="setup-test-btn" class="btn secondary" onclick="testSetupLaunch()">Run Launch Test</button>',
    '<button id="setup-finish-btn" class="btn secondary" onclick="finishSetup()" disabled>Finish Setup</button>',
    '</div>',
    '<p id="setup-feedback" class="tiny muted">No setup action run yet.</p>',
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
    '<button class="btn" onclick="openSetupFromLaunchTarget()">Open Setup</button>',
    '</div>',
    '</section>',
  ].join('\n')
}

function renderProviderConnectionsPanel(): string {
  const providers = [
    { id: 'chatgpt', label: 'ChatGPT', icon: 'CG' },
    { id: 'claude', label: 'Claude', icon: 'CL' },
    { id: 'grok', label: 'Grok', icon: 'GR' },
    { id: 'gemini', label: 'Gemini', icon: 'GM' },
    { id: 'codex', label: 'Codex', icon: 'CX' },
  ]

  const cards = providers.map(provider => [
    `<article class="provider-connect-card" data-provider-connect="${escapeHtml(provider.id)}">`,
    '<div class="provider-connect-head">',
    `<span class="provider-connect-icon">${escapeHtml(provider.icon)}</span>`,
    `<h3>${escapeHtml(provider.label)}</h3>`,
    '</div>',
    `<p id="provider-connect-status-${escapeHtml(provider.id)}" class="tiny muted">Checking...</p>`,
    '<div class="provider-actions">',
    `<button class="btn" onclick="connectProvider('${escapeHtml(provider.id)}')">Connect</button>`,
    `<button class="btn secondary" onclick="setLaunchTarget('${escapeHtml(provider.id)}')">Use As Target</button>`,
    '</div>',
    '</article>',
  ].join('\n'))

  return [
    '<section class="card full" id="provider-connections-panel">',
    '<h2>Provider Connections</h2>',
    '<p class="muted">Connect each provider for account-aware scanning. Launch fallback still works without external connector access.</p>',
    '<div class="provider-connect-grid">',
    ...cards,
    '</div>',
    '</section>',
  ].join('\n')
}

function renderProviderScanPanel(): string {
  return [
    '<section class="card full" id="provider-scan-panel">',
    '<h2>Provider Topic Scan (ChatGPT First)</h2>',
    '<p class="muted">Scan connector-exposed provider contexts, then launch or import them as portable packs.</p>',
    '<div class="provider-select-row">',
    '<label for="scan-source-provider">Source provider:</label>',
    '<select id="scan-source-provider" class="provider-select">',
    '<option value="chatgpt">ChatGPT</option>',
    '<option value="claude">Claude</option>',
    '<option value="grok">Grok</option>',
    '<option value="gemini">Gemini</option>',
    '<option value="codex">Codex</option>',
    '</select>',
    '<button id="scan-topics-btn" class="btn" onclick="scanProviderTopics()">Scan Topics</button>',
    '<button class="btn secondary" onclick="importAllScannedTopics()">Import All</button>',
    '</div>',
    '<p id="scan-status" class="tiny muted">No provider connected. Enable a connector, then scan topics.</p>',
    '<div id="scanned-topic-grid" class="provider-grid"></div>',
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

export function renderLocalDashboardHtml(config: ProjectConfig, memories: Memory[]): string {
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
    '.tiny.ok { color: #86efac; }',
    '.tiny.warn { color: #fcd34d; }',
    '.tiny.info { color: #bae6fd; }',
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
    '.provider-connect-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 12px; }',
    '.provider-connect-card { background: rgba(2,6,23,0.55); border:1px solid rgba(56,189,248,0.35); border-radius: 10px; padding: 12px; }',
    '.provider-connect-head { display:flex; align-items:center; gap:8px; margin-bottom: 6px; }',
    '.provider-connect-head h3 { margin:0; color:#7dd3fc; font-size: 14px; }',
    '.provider-connect-icon { width:24px; height:24px; border-radius:999px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; background:rgba(14,116,144,0.35); color:#cffafe; border:1px solid rgba(34,211,238,0.45); }',
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
    '.btn:disabled { opacity:0.55; cursor:not-allowed; }',
    '.setup-loading { font-size: 12px; color: #bae6fd; margin-bottom: 10px; }',
    '.setup-feedback.ok { color: #86efac; }',
    '.setup-feedback.warn { color: #fcd34d; }',
    '.setup-feedback.info { color: #bae6fd; }',
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
    renderProviderConnectionsPanel(),
    renderProviderScanPanel(),
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
    'let scannedTopics = [];',
    'const CONNECTABLE_PROVIDER_IDS = ["chatgpt", "claude", "grok", "gemini", "codex"];',
    'let setupState = {',
    '  completed: false,',
    '  connectorReachable: false,',
    '  connectorMode: "none",',
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
    'function getScanSourceProviderId() {',
    '  const el = document.getElementById("scan-source-provider");',
    '  return (el && el.value) ? el.value : "chatgpt";',
    '}',
    'function providerConfig(providerId) {',
    '  return PROVIDER_REGISTRY[providerId] || PROVIDER_REGISTRY.chatgpt;',
    '}',
    'function providerLabel(providerId) {',
    '  if (providerId && PROVIDER_REGISTRY[providerId]) return PROVIDER_REGISTRY[providerId].label || providerId;',
    '  const raw = String(providerId || "unknown").trim();',
    '  return raw ? raw.toUpperCase() : "UNKNOWN";',
    '}',
    'function setProviderConnectStatus(providerId, text, tone) {',
    '  const el = document.getElementById("provider-connect-status-" + providerId);',
    '  if (!el) return;',
    '  el.textContent = text;',
    '  el.classList.remove("ok");',
    '  el.classList.remove("warn");',
    '  el.classList.remove("info");',
    '  if (tone) el.classList.add(tone);',
    '}',
    'function setLaunchTarget(providerId) {',
    '  const targetProviderEl = document.getElementById("target-provider");',
    '  if (targetProviderEl && targetProviderEl.value !== providerId) targetProviderEl.value = providerId;',
    '  updateTargetProviderStatus();',
    '  runSetupFlow();',
    '}',
    'function waitMs(ms) {',
    '  return new Promise((resolve) => setTimeout(resolve, ms));',
    '}',
    'async function pingProviderConnection(providerId) {',
    '  const response = await connectorRequest("ping", { provider: providerId }, 850);',
    '  if (!response || response.ok !== true) return { reachable: false, mode: "none" };',
    '  const mode = typeof response.connector_mode === "string" ? response.connector_mode : "external";',
    '  return { reachable: true, mode };',
    '}',
    'async function refreshProviderConnections() {',
    '  for (const providerId of CONNECTABLE_PROVIDER_IDS) {',
    '    const result = await pingProviderConnection(providerId);',
    '    if (!result.reachable) {',
    '      setProviderConnectStatus(providerId, "Not connected", "warn");',
    '      continue;',
    '    }',
    '    if (result.mode === "local_fallback") {',
    '      setProviderConnectStatus(providerId, "Launch-ready (local fallback only)", "info");',
    '      continue;',
    '    }',
    '    setProviderConnectStatus(providerId, "Connected", "ok");',
    '  }',
    '}',
    'async function connectProvider(providerId) {',
    '  const cfg = providerConfig(providerId);',
    '  setProviderConnectStatus(providerId, "Connecting...", "info");',
    '  setSetupFeedback("Trying external connector for " + providerLabel(providerId) + "...", "info");',
    '  if (window.location && window.location.protocol === "file:") {',
    '    setSetupDetail("This dashboard runs from file://. If you use a browser connector extension, enable file URL access in extension settings and approve any prompts.");',
    '  }',
    '  if (cfg && cfg.newChatUrl) window.open(cfg.newChatUrl, "_blank", "noopener");',
    '  for (let attempt = 0; attempt < 8; attempt++) {',
    '    const result = await pingProviderConnection(providerId);',
    '    if (result.reachable && result.mode !== "local_fallback") {',
    '      setProviderConnectStatus(providerId, "Connected", "ok");',
    '      setSetupFeedback("External connector connected for " + providerLabel(providerId) + ".", "ok");',
    '      await runSetupFlow();',
    '      return;',
    '    }',
    '    await waitMs(700);',
    '  }',
    '  const post = await pingProviderConnection(providerId);',
    '  if (post.reachable && post.mode === "local_fallback") {',
    '    setProviderConnectStatus(providerId, "Launch-ready (local fallback only)", "info");',
    '    setSetupFeedback("Connected in local fallback mode. External connector is still required for provider topic scan.", "warn");',
    '  } else {',
    '    setProviderConnectStatus(providerId, "Not connected", "warn");',
    '    setSetupFeedback("External connector not detected for " + providerLabel(providerId) + ".", "warn");',
    '  }',
    '  await runSetupFlow();',
    '}',
    'async function tryExternalConnectorSetup() {',
    '  await connectProvider(getTargetProviderId());',
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
    'function openSetupFromLaunchTarget() {',
    '  showSetupPanel();',
    '  const panel = document.getElementById("setup-panel");',
    '  if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "start" });',
    '  if (!setupState.connectorReachable) setSetupFeedback("Connector not detected. Launch fallback works, but provider scan needs a connector.", "warn");',
    '  else if (setupState.connectorMode === "local_fallback") setSetupFeedback("Local fallback connector is active for launch. External connector is required for provider scan.", "info");',
    '  else setSetupFeedback("Setup panel opened. Refresh status after any connector changes.", "info");',
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
    'function setSetupFeedback(text, tone = "info") {',
    '  const el = document.getElementById("setup-feedback");',
    '  if (!el) return;',
    '  el.textContent = text;',
    '  el.classList.remove("ok");',
    '  el.classList.remove("warn");',
    '  el.classList.remove("info");',
    '  el.classList.add("setup-feedback");',
    '  el.classList.add(tone);',
    '}',
    'function hasLaunchTest() {',
    '  return Boolean(setupState.lastLaunchTestedAt);',
    '}',
    'function updateSetupButtons() {',
    '  const finishBtn = document.getElementById("setup-finish-btn");',
    '  if (finishBtn) finishBtn.disabled = !hasLaunchTest();',
    '}',
    'function updateScanControls() {',
    '  const scanBtn = document.getElementById("scan-topics-btn");',
    '  if (!scanBtn) return;',
    '  const enabled = Boolean(setupState.connectorReachable) && setupState.connectorMode !== "local_fallback";',
    '  scanBtn.disabled = !enabled;',
    '  if (enabled) scanBtn.title = "Scan provider topics from connector.";',
    '  else if (!setupState.connectorReachable) scanBtn.title = "Connector required for provider topic scan.";',
    '  else scanBtn.title = "Local fallback connector is launch-only. External connector required for scan.";',
    '}',
    'function setScanStatus(text) {',
    '  const el = document.getElementById("scan-status");',
    '  if (el) el.textContent = text;',
    '}',
    'function launchWithAdapter(pack, targetProviderId) {',
    '  const cfg = providerConfig(targetProviderId);',
    '  const adapter = (cfg.enabled && LAUNCH_ADAPTERS[targetProviderId]) ? LAUNCH_ADAPTERS[targetProviderId] : LAUNCH_ADAPTERS.fallback;',
    '  adapter.launch(pack, cfg);',
    '}',
    'function installLocalConnectorFallback() {',
    '  if (window.__tagesLocalConnectorInstalled) return;',
    '  window.__tagesLocalConnectorInstalled = true;',
    '  window.addEventListener(CONNECTOR_REQUEST_EVENT, (event) => {',
    '    const detail = event && event.detail;',
    '    if (!detail || !detail.requestId || !detail.action) return;',
    '    const requestId = detail.requestId;',
    '    let cancelled = false;',
    '    const cancelIfAnswered = (respEvent) => {',
    '      const resp = respEvent && respEvent.detail;',
    '      if (resp && resp.requestId === requestId) cancelled = true;',
    '    };',
    '    window.addEventListener(CONNECTOR_RESPONSE_EVENT, cancelIfAnswered);',
    '    setTimeout(() => {',
    '      window.removeEventListener(CONNECTOR_RESPONSE_EVENT, cancelIfAnswered);',
    '      if (cancelled) return;',
    '      const action = detail.action;',
    '      const payload = detail.payload || {};',
    '      if (action === "ping") {',
    '        window.dispatchEvent(new CustomEvent(CONNECTOR_RESPONSE_EVENT, { detail: { requestId, ok: true, connector_mode: "local_fallback", capabilities: { launch: true, scan_topics: false, helper_running: false, provider_access: false, local_fallback: true } } }));',
    '        return;',
    '      }',
    '      if (action === "launch") {',
    '        const targetProviderId = payload.provider || getTargetProviderId();',
    '        const pack = payload.pack || {};',
    '        launchWithAdapter(pack, targetProviderId);',
    '        window.dispatchEvent(new CustomEvent(CONNECTOR_RESPONSE_EVENT, { detail: { requestId, ok: true, connector_mode: "local_fallback", launched: true } }));',
    '        return;',
    '      }',
    '      if (action === "scan_topics") {',
    '        window.dispatchEvent(new CustomEvent(CONNECTOR_RESPONSE_EVENT, { detail: { requestId, ok: false, code: "scan_not_supported", connector_mode: "local_fallback" } }));',
    '      }',
    '    }, 520);',
    '  });',
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
    '  if (!response || response.ok !== true) return { reachable: false, capabilities: {}, mode: "none" };',
    '  const capabilities = response.capabilities && typeof response.capabilities === "object" ? response.capabilities : {};',
    '  const mode = typeof response.connector_mode === "string" ? response.connector_mode : "external";',
    '  return { reachable: true, capabilities, mode };',
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
    '  const scanReady = Boolean(connector.reachable && connector.capabilities && (connector.capabilities.scan_topics === true || connector.capabilities.scan === true || connector.capabilities.list_contexts === true));',
    '  return {',
    '    connectorReachable: connector.reachable,',
    '    connectorMode: connector.mode || "none",',
    '    clipboardPermission,',
    '    providerReady: Boolean(target && target.newChatUrl),',
    '    scanReady,',
    '    helperRunning,',
    '  };',
    '}',
    'function setupReadyForDaily(status) {',
    '  return Boolean(status.providerReady) && status.clipboardPermission !== "denied" && Boolean(setupState.lastLaunchTestedAt);',
    '}',
    'async function runSetupFlow() {',
    '  setSetupLoading(true, "Refreshing setup status...");',
    '  setSetupFeedback("Checking setup state...", "info");',
    '  const status = await collectSetupStatus();',
    '  setupState.connectorReachable = status.connectorReachable;',
    '  setupState.connectorMode = status.connectorMode;',
    '  setupState.clipboardPermission = status.clipboardPermission;',
    '  setupState.helperRunning = status.helperRunning;',
    '  setupState.lastCheckedAt = new Date().toISOString();',
    '  const connectorLabel = status.connectorReachable ? (status.connectorMode === "local_fallback" ? "Ready (local fallback)" : "Ready") : "Missing (optional)";',
    '  updateSetupStep("setup-step-connector", status.connectorReachable, connectorLabel);',
    '  updateSetupStep("setup-step-permission", status.clipboardPermission !== "denied", status.clipboardPermission === "denied" ? "Denied" : (status.clipboardPermission || "Unknown"));',
    '  updateSetupStep("setup-step-provider", status.providerReady, status.providerReady ? "Ready" : "Missing");',
    '  updateSetupStep("setup-step-scan", status.scanReady ? true : (status.connectorReachable ? false : null), status.scanReady ? "Ready" : (status.connectorReachable ? "Not supported" : "No provider connected"));',
    '  updateSetupStep("setup-step-helper", status.helperRunning ? true : null, status.helperRunning ? "Running" : "Optional");',
    '  const launchReady = setupReadyForDaily(status);',
    '  if (launchReady) {',
    '    const testedAt = new Date(setupState.lastLaunchTestedAt).toLocaleString();',
    '    if (setupState.completed) setSetupSubtitle(status.connectorReachable ? (status.connectorMode === "local_fallback" ? "Setup complete for local fallback launch. Provider scan still needs an external connector." : "Setup complete. Daily flow is one-click from tiles.") : "Setup complete for launch fallback. Provider scan still needs a connector.");',
    '    else setSetupSubtitle("Launch test passed. Click Finish Setup to close this panel.");',
    '    setSetupDetail(status.connectorReachable ? (status.connectorMode === "local_fallback" ? "Local fallback connector is active: launch works without provider account access. Provider scan needs an external connector." : (status.scanReady ? "Connector launch and provider scan are active." : "Connector launch active. Provider scan is not exposed by the connector.")) : "Fallback path active: opens provider and copies prompt. Provider scan needs connector.");',
    '    setSetupFeedback(setupState.completed ? ("Completed on " + testedAt + ".") : ("Launch test passed at " + testedAt + ". Click Finish Setup."), "ok");',
    '    if (setupState.completed) hideSetupPanel(); else showSetupPanel();',
  '  } else {',
    '    setupState.completed = false;',
    '    showSetupPanel();',
    '    setSetupSubtitle("One-time setup is still needed.");',
    '    setSetupDetail(status.connectorReachable ? (status.connectorMode === "local_fallback" ? "Local fallback connector detected for launch. Provider scan needs an external connector." : (status.scanReady ? "Connector detected for launch and scan. Run Launch Test once to finish setup." : "Connector detected for launch. Scan support is not exposed.")) : "Connector not detected. Daily fallback still works after Launch Test.");',
    '    setSetupFeedback(hasLaunchTest() ? "Re-run Launch Test if launch behavior changed." : "Run Launch Test once to unlock Finish Setup.", "warn");',
    '  }',
    '  updateSetupButtons();',
    '  updateScanControls();',
    '  saveSetupState();',
    '  updateTargetProviderStatus();',
    '  refreshProviderConnections();',
    '  setSetupLoading(false);',
    '}',
    'function finishSetup() {',
    '  if (!hasLaunchTest()) {',
    '    setSetupFeedback("Run Launch Test once before finishing setup.", "warn");',
    '    updateSetupButtons();',
    '    return;',
    '  }',
    '  setupState.completed = true;',
    '  saveSetupState();',
    '  hideSetupPanel();',
    '  updateSetupButtons();',
    '  updateTargetProviderStatus();',
    '}',
    'async function testSetupLaunch() {',
    '  setSetupFeedback("Running launch test...", "info");',
    '  const sample = createPack({',
    '    title: "Setup Test Pack",',
    '    summary: "Checks provider handoff path",',
    '    prompt: "SETUP TEST: If you see this, handoff launch is working.",',
    '    source_provider: "local",',
    '    source_type: "setup_test",',
    '    tags: ["setup-test"],',
    '  });',
    '  try {',
    '    await launchPack(sample);',
    '    setupState.lastLaunchTestedAt = new Date().toISOString();',
    '    saveSetupState();',
    '    setSetupFeedback("Launch test sent. Confirmed path is now ready to finish.", "ok");',
    '  } catch {',
    '    setSetupFeedback("Launch test failed to run. Check browser popup settings and try again.", "warn");',
    '  }',
    '  updateSetupButtons();',
    '  runSetupFlow();',
    '}',
    'function updateTargetProviderStatus() {',
    '  const el = document.getElementById("target-provider-status");',
    '  if (!el) return;',
    '  const target = providerConfig(getTargetProviderId());',
    '  const mode = setupState.connectorReachable ? (setupState.connectorMode === "local_fallback" ? "local fallback connector" : "connector handoff") : "copy + open fallback";',
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
    '  return (response && response.ok === true) ? response : null;',
    '}',
    'async function launchPack(pack, explicitTargetProvider) {',
    '  const targetProviderId = explicitTargetProvider || getTargetProviderId();',
    '  const launchResponse = await connectorLaunchPack(pack, targetProviderId);',
    '  if (launchResponse) {',
    '    setupState.connectorReachable = true;',
    '    if (typeof launchResponse.connector_mode === "string") setupState.connectorMode = launchResponse.connector_mode;',
    '    saveSetupState();',
    '    updateScanControls();',
    '    updateTargetProviderStatus();',
    '    return;',
    '  }',
    '  launchWithAdapter(pack, targetProviderId);',
    '}',
    'function normalizeScannedPack(raw, fallbackSourceProvider) {',
    '  if (!raw || typeof raw !== "object") return null;',
    '  const title = String(raw.title || raw.topic || raw.name || raw.id || "Provider Topic").trim();',
    '  const summary = String(raw.summary || raw.preview || raw.description || "").trim();',
    '  const promptText = String(raw.prompt || raw.handoff || raw.context || "").trim();',
    '  const hasContextBody = Boolean(promptText);',
    '  const prompt = promptText || [',
    '    "PROVIDER TOPIC (METADATA ONLY)",',
    '    "Topic: " + title,',
    '    summary ? ("Summary: " + summary) : "",',
    '    "Connector did not return a full context body for this topic.",',
    '    "Instruction: Open the provider topic and confirm context details before proceeding.",',
    '  ].filter(Boolean).join("\\n");',
    '  const metadata = raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {};',
    '  if (typeof raw.id === "string" && raw.id) metadata.provider_context_id = raw.id;',
    '  metadata.topic_only = !hasContextBody;',
    '  const tags = Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === "string") : [];',
    '  if (typeof raw.id === "string" && raw.id) tags.push("provider-context-id:" + raw.id);',
    '  return createPack({',
    '    title,',
    '    summary: summary || compactLine(prompt, 220),',
    '    prompt,',
    '    tags,',
    '    source_provider: raw.source_provider || raw.provider || fallbackSourceProvider || "unknown",',
    '    source_type: raw.source_type || raw.sourceType || "provider_scan_topic",',
    '    author: typeof raw.author === "string" ? raw.author : "",',
    '    notes: typeof raw.notes === "string" ? raw.notes : "",',
    '    metadata,',
    '  });',
    '}',
    'function parseScannedTopics(response, sourceProvider) {',
    '  if (!response || typeof response !== "object") return [];',
    '  const list = Array.isArray(response.topics) ? response.topics : (Array.isArray(response.contexts) ? response.contexts : (Array.isArray(response.packs) ? response.packs : []));',
    '  return list.map((item) => normalizeScannedPack(item, sourceProvider)).filter(Boolean);',
    '}',
    'function renderScannedTopics() {',
    '  const container = document.getElementById("scanned-topic-grid");',
    '  if (!container) return;',
    '  if (!scannedTopics.length) {',
    '    container.innerHTML = "<p class=\\"muted\\">No scanned provider topics yet.</p>";',
    '    return;',
    '  }',
    '  const html = scannedTopics.map((pack, index) => {',
    '    const title = escapeHtmlClient(pack.title || "Provider Topic");',
    '    const summary = escapeHtmlClient(pack.summary || "");',
    '    const source = escapeHtmlClient(providerLabel(pack.source_provider || "unknown"));',
    '    const prompt = escapeHtmlClient(pack.prompt || "");',
    '    const topicOnly = Boolean(pack.metadata && pack.metadata.topic_only === true);',
    '    return [',
    '      "<article class=\\"memory-launch-card scanned-topic-card\\">",',
    '      "<h3>" + title + "</h3>",',
    '      "<p><strong>Source:</strong> " + source + "</p>",',
    '      (summary ? "<p class=\\"muted tiny\\">" + summary + "</p>" : ""),',
    '      (topicOnly ? "<p class=\\"muted tiny\\">Metadata only: connector did not return full context text.</p>" : ""),',
    '      "<div class=\\"provider-actions\\">",',
    '      "<button class=\\"btn\\" onclick=\\"continueScannedTopic(" + index + ")\\">Continue</button>",',
    '      "<button class=\\"btn secondary\\" onclick=\\"importScannedTopic(" + index + ")\\">Import</button>",',
    '      "<button class=\\"btn secondary\\" onclick=\\"exportScannedTopic(" + index + ")\\">Export</button>",',
    '      "</div>",',
    '      "<details><summary>View Prompt</summary><pre>" + prompt + "</pre></details>",',
    '      "</article>",',
    '    ].join("");',
    '  }).join("");',
    '  container.innerHTML = html;',
    '}',
    'async function scanProviderTopics() {',
    '  const sourceProvider = getScanSourceProviderId();',
    '  if (!setupState.connectorReachable) {',
    '    setScanStatus("No provider connected. Enable a connector, then click Refresh Status.");',
    '    setSetupFeedback("Connector is required for Scan Topics.", "warn");',
    '    updateScanControls();',
    '    return;',
    '  }',
    '  setScanStatus("Scanning " + providerLabel(sourceProvider) + " topics...");',
    '  const response = await connectorRequest("scan_topics", { provider: sourceProvider }, 2800);',
    '  if (!response) {',
    '    scannedTopics = [];',
    '    renderScannedTopics();',
    '    setScanStatus("No provider connected. Scan unavailable because connector did not respond. Manual import and local packs still work.");',
    '    return;',
    '  }',
    '  if (response.ok !== true) {',
    '    scannedTopics = [];',
    '    renderScannedTopics();',
    '    if (response.code === "scan_not_supported") setScanStatus("Connector is reachable, but provider topic scan is not supported in this connector mode.");',
    '    else setScanStatus("Scan failed for " + providerLabel(sourceProvider) + ". Try Refresh Status and run again.");',
    '    return;',
    '  }',
    '  setupState.connectorReachable = true;',
    '  saveSetupState();',
    '  scannedTopics = parseScannedTopics(response, sourceProvider).slice(0, 60);',
    '  renderScannedTopics();',
    '  if (!scannedTopics.length) {',
    '    setScanStatus("Connector responded but returned no topics for " + providerLabel(sourceProvider) + ".");',
    '    return;',
    '  }',
    '  const topicOnlyCount = scannedTopics.filter((entry) => Boolean(entry.metadata && entry.metadata.topic_only === true)).length;',
    '  if (topicOnlyCount > 0) setScanStatus("Scanned " + scannedTopics.length + " topic(s) from " + providerLabel(sourceProvider) + ". " + topicOnlyCount + " are metadata-only (no full context text).");',
    '  else setScanStatus("Scanned " + scannedTopics.length + " topic(s) from " + providerLabel(sourceProvider) + ".");',
    '}',
    'async function continueScannedTopic(index) {',
    '  const item = scannedTopics[Number(index)];',
    '  if (!item) return;',
    '  await launchPack(item);',
    '}',
    'function importScannedTopic(index) {',
    '  const item = scannedTopics[Number(index)];',
    '  if (!item) return;',
    '  const enriched = { id: sanitizeImportedId(`${Date.now()}-${Math.random().toString(16).slice(2)}`), ...item, updatedAt: new Date().toISOString() };',
    '  importedEntries = [enriched, ...importedEntries].slice(0, 120);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'function importAllScannedTopics() {',
    '  if (!scannedTopics.length) return;',
    '  const now = new Date().toISOString();',
    '  const enriched = scannedTopics.map((item) => ({ id: sanitizeImportedId(`${Date.now()}-${Math.random().toString(16).slice(2)}`), ...item, updatedAt: now }));',
    '  importedEntries = [...enriched, ...importedEntries].slice(0, 120);',
    '  saveImported();',
    '  renderImported();',
    '}',
    'function exportScannedTopic(index) {',
    '  const item = scannedTopics[Number(index)];',
    '  if (!item) return;',
    '  const safeTitle = slugifyClient(item.title || "scanned-pack");',
    '  downloadJson(`${safeTitle}-pack.json`, item);',
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
    '  installLocalConnectorFallback();',
    '  const targetProviderEl = document.getElementById("target-provider");',
    '  if (targetProviderEl) targetProviderEl.addEventListener("change", () => { updateTargetProviderStatus(); runSetupFlow(); });',
    '  const scanSourceEl = document.getElementById("scan-source-provider");',
    '  if (scanSourceEl) scanSourceEl.addEventListener("change", () => { setScanStatus("Source changed. Click Scan Topics to refresh."); });',
    '  loadSetupState();',
    '  updateSetupButtons();',
    '  updateScanControls();',
    '  updateTargetProviderStatus();',
    '  refreshProviderConnections();',
    '  if (!setupState.completed) showSetupPanel(); else hideSetupPanel();',
    '  runSetupFlow().then(() => {',
    '    if (setupState.connectorReachable && setupState.connectorMode !== "local_fallback") scanProviderTopics();',
    '    else {',
    '      renderScannedTopics();',
    '      if (!setupState.connectorReachable) setScanStatus("No provider connected. Enable a connector, then scan topics.");',
    '      else setScanStatus("Local fallback connector is active for launch. External connector is required for provider topic scan.");',
    '    }',
    '  });',
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
