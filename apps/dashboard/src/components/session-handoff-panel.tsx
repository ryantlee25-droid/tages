'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from './toast'

interface SessionHandoffMemory {
  current_objective: string
  active_constraints: string[]
  recent_decisions: string[]
  open_questions: string[]
  known_issues: string[]
  working_summary: string
  project_label?: string
  optional_tags?: string[]
}

interface MemoryRow {
  id: string
  key: string
  value: string
  tags: string[] | null
  updated_at: string
}

function splitItems(input: string): string[] {
  return input
    .split(/\n|;/)
    .map(s => s.trim())
    .filter(Boolean)
}

function uniqueList(values: string[], max = 8): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized)
    if (output.length >= max) break
  }
  return output
}

function splitSentences(input: string): string[] {
  return input
    .split(/\n+|(?<=[.!?])\s+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function compressHighSignal(text: string, maxChars = 640): string {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return ''

  const keyword = /\b(next|todo|blocked|risk|must|cannot|because|pending|current|need|issue|fix|question|decision)\b/i
  const scored = sentences.map((sentence, index) => {
    let score = 0
    if (keyword.test(sentence)) score += 3
    if (sentence.includes('?')) score += 2
    if (sentence.length >= 30 && sentence.length <= 180) score += 1
    if (/^(we|i|current|next)/i.test(sentence)) score += 1
    return { sentence, score, index }
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.index - b.index
  })

  const selected: string[] = []
  let length = 0
  for (const item of scored) {
    if (selected.includes(item.sentence)) continue
    if (length + item.sentence.length + 1 > maxChars) continue
    selected.push(item.sentence)
    length += item.sentence.length + 1
    if (selected.length >= 5) break
  }

  if (selected.length === 0) return sentences[0].slice(0, maxChars)
  return selected.join(' ')
}

function parseTaggedNotes(notes: string): {
  objective?: string
  constraints: string[]
  decisions: string[]
  questions: string[]
  issues: string[]
  summaryHint?: string
  label?: string
  remainder: string
} {
  const constraints: string[] = []
  const decisions: string[] = []
  const questions: string[] = []
  const issues: string[] = []
  const remainder: string[] = []
  let objective: string | undefined
  let summaryHint: string | undefined
  let label: string | undefined

  for (const rawLine of notes.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const objectiveMatch = line.match(/^(objective|goal)\s*:\s*(.+)$/i)
    if (objectiveMatch) {
      objective = objectiveMatch[2].trim()
      continue
    }

    const constraintsMatch = line.match(/^(constraint|constraints)\s*:\s*(.+)$/i)
    if (constraintsMatch) {
      constraints.push(constraintsMatch[2].trim())
      continue
    }

    const decisionsMatch = line.match(/^(decision|decisions)\s*:\s*(.+)$/i)
    if (decisionsMatch) {
      decisions.push(decisionsMatch[2].trim())
      continue
    }

    const questionsMatch = line.match(/^(question|questions|open questions?)\s*:\s*(.+)$/i)
    if (questionsMatch) {
      questions.push(questionsMatch[2].trim())
      continue
    }

    const issuesMatch = line.match(/^(issue|issues|known issue)\s*:\s*(.+)$/i)
    if (issuesMatch) {
      issues.push(issuesMatch[2].trim())
      continue
    }

    const summaryMatch = line.match(/^(summary|working summary|state)\s*:\s*(.+)$/i)
    if (summaryMatch) {
      summaryHint = summaryMatch[2].trim()
      continue
    }

    const labelMatch = line.match(/^(label|topic|project label|topic label)\s*:\s*(.+)$/i)
    if (labelMatch) {
      label = labelMatch[2].trim()
      continue
    }

    remainder.push(line)
  }

  return {
    objective,
    constraints,
    decisions,
    questions,
    issues,
    summaryHint,
    label,
    remainder: remainder.join('\n'),
  }
}

function inferListFromSentences(sentences: string[], pattern: RegExp, max = 4): string[] {
  const hits: string[] = []
  for (const sentence of sentences) {
    if (!pattern.test(sentence)) continue
    hits.push(sentence)
    if (hits.length >= max) break
  }
  return hits
}

function inferOpenQuestions(sentences: string[], max = 4): string[] {
  const hits: string[] = []
  for (const sentence of sentences) {
    const lowered = sentence.toLowerCase()
    const startsWithQuestionWord = /^(who|what|when|where|why|how|which)\b/.test(lowered)
    if (!sentence.includes('?') && !startsWithQuestionWord) continue
    hits.push(sentence.endsWith('?') ? sentence : `${sentence}?`)
    if (hits.length >= max) break
  }
  return hits
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function parseStoredHandoff(value: string): SessionHandoffMemory | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
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

function renderRestoreBlock(handoff: SessionHandoffMemory): string {
  const lines: string[] = []
  lines.push('SESSION HANDOFF (SHORT-LIVED)')
  lines.push(`Current objective: ${handoff.current_objective}`)

  if (handoff.project_label) {
    lines.push(`Project/topic: ${handoff.project_label}`)
  }

  if (handoff.active_constraints.length > 0) {
    lines.push('Active constraints:')
    for (const item of handoff.active_constraints) lines.push(`- ${item}`)
  }

  if (handoff.recent_decisions.length > 0) {
    lines.push('Recent decisions:')
    for (const item of handoff.recent_decisions) lines.push(`- ${item}`)
  }

  if (handoff.open_questions.length > 0) {
    lines.push('Open questions:')
    for (const item of handoff.open_questions) lines.push(`- ${item}`)
  }

  if (handoff.known_issues.length > 0) {
    lines.push('Known issues:')
    for (const item of handoff.known_issues) lines.push(`- ${item}`)
  }

  lines.push(`Working summary: ${handoff.working_summary}`)
  lines.push('Instruction: Continue from this handoff. Preserve continuity and ask before making assumptions.')

  return lines.join('\n')
}

export function SessionHandoffPanel({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { toast } = useToast()

  const [objective, setObjective] = useState('')
  const [projectLabel, setProjectLabel] = useState('')
  const [workingNotes, setWorkingNotes] = useState('')
  const [workingSummary, setWorkingSummary] = useState('')
  const [constraintsText, setConstraintsText] = useState('')
  const [decisionsText, setDecisionsText] = useState('')
  const [questionsText, setQuestionsText] = useState('')
  const [issuesText, setIssuesText] = useState('')
  const [loadedKey, setLoadedKey] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  function buildHandoff(): SessionHandoffMemory {
    const parsedNotes = parseTaggedNotes(workingNotes)
    const sentencePool = splitSentences(parsedNotes.remainder)

    const current_objective =
      objective.trim() ||
      parsedNotes.objective ||
      sentencePool[0] ||
      'Continue from current state without losing context.'

    const active_constraints = uniqueList([
      ...splitItems(constraintsText),
      ...parsedNotes.constraints,
      ...inferListFromSentences(sentencePool, /\b(must|cannot|can\'t|never|do not|limit|constraint)\b/i, 5),
    ])

    const recent_decisions = uniqueList([
      ...splitItems(decisionsText),
      ...parsedNotes.decisions,
      ...inferListFromSentences(sentencePool, /\b(decided|chose|selected|opted|approved)\b/i, 5),
    ])

    const open_questions = uniqueList([
      ...splitItems(questionsText),
      ...parsedNotes.questions,
      ...inferOpenQuestions(sentencePool, 5),
    ])

    const known_issues = uniqueList([
      ...splitItems(issuesText),
      ...parsedNotes.issues,
      ...inferListFromSentences(sentencePool, /\b(issue|bug|blocked|failing|risk|unclear|todo)\b/i, 5),
    ])

    const summarySource =
      workingSummary.trim() ||
      parsedNotes.summaryHint ||
      parsedNotes.remainder ||
      [recent_decisions[0], known_issues[0], open_questions[0], active_constraints[0]]
        .filter(Boolean)
        .join(' ')

    const summary = compressHighSignal(summarySource)

    return {
      current_objective: current_objective.slice(0, 240),
      active_constraints,
      recent_decisions,
      open_questions,
      known_issues,
      working_summary: summary,
      project_label: projectLabel.trim() || parsedNotes.label || undefined,
    }
  }

  const handoffPreview = useMemo(() => buildHandoff(), [
    objective,
    projectLabel,
    workingNotes,
    workingSummary,
    constraintsText,
    decisionsText,
    questionsText,
    issuesText,
  ])

  const restoreBlock = useMemo(() => renderRestoreBlock(handoffPreview), [handoffPreview])

  function applyLoadedHandoff(memory: MemoryRow, handoff: SessionHandoffMemory) {
    setLoadedKey(memory.key)
    setLastSavedAt(memory.updated_at)
    setObjective(handoff.current_objective)
    setProjectLabel(handoff.project_label || '')
    setWorkingNotes('')
    setWorkingSummary(handoff.working_summary)
    setConstraintsText(handoff.active_constraints.join('\n'))
    setDecisionsText(handoff.recent_decisions.join('\n'))
    setQuestionsText(handoff.open_questions.join('\n'))
    setIssuesText(handoff.known_issues.join('\n'))
  }

  async function loadLatest() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('memories')
        .select('id, key, value, tags, updated_at')
        .eq('project_id', projectId)
        .eq('type', 'session_context')
        .eq('status', 'live')
        .order('updated_at', { ascending: false })
        .limit(30)

      if (error) throw error
      const rows = (data || []) as MemoryRow[]
      const match = rows
        .map((row) => ({ row, parsed: parseStoredHandoff(row.value) }))
        .find((candidate) => candidate.parsed)

      if (!match || !match.parsed) {
        toast('No saved handoff found for this project yet.', 'info')
        return
      }

      applyLoadedHandoff(match.row, match.parsed)
      toast('Loaded latest handoff.', 'success')
    } catch (err) {
      toast(`Failed to load handoff: ${(err as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  async function saveHandoff() {
    const handoff = buildHandoff()
    const hasExplicitSignal = Boolean(
      objective.trim() ||
      workingNotes.trim() ||
      workingSummary.trim() ||
      constraintsText.trim() ||
      decisionsText.trim() ||
      questionsText.trim() ||
      issuesText.trim(),
    )

    if (!hasExplicitSignal) {
      toast('Add a little context before saving your handoff.', 'error')
      return
    }

    const computedKey = handoff.project_label
      ? `session-handoff-${slugify(handoff.project_label) || 'active'}`
      : 'session-handoff-active'

    setSaving(true)
    try {
      const payload = {
        project_id: projectId,
        key: loadedKey || computedKey,
        value: JSON.stringify({
          ...handoff,
          current_goal: handoff.current_objective,
          working_state_summary: handoff.working_summary,
        }),
        type: 'session_context',
        source: 'manual',
        status: 'live',
        confidence: 1,
        tags: ['session_handoff', ...(handoff.project_label ? [`topic:${handoff.project_label}`] : [])],
        file_paths: [] as string[],
      }

      const { error } = await supabase
        .from('memories')
        .upsert(payload, { onConflict: 'project_id,key' })

      if (error) throw error

      const nowIso = new Date().toISOString()
      setLoadedKey(payload.key)
      setLastSavedAt(nowIso)
      setWorkingSummary(handoff.working_summary)
      toast('Handoff saved.', 'success')
    } catch (err) {
      toast(`Failed to save handoff: ${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function copyRestoreBlock() {
    try {
      await navigator.clipboard.writeText(restoreBlock)
      toast('Restore block copied. Paste it into your new session.', 'success')
    } catch {
      toast('Could not access clipboard in this browser.', 'error')
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Session Handoff</h2>
          <p className="text-xs text-zinc-400">Save where you are, then load/copy context into a fresh AI chat.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveHandoff}
            disabled={saving}
            className="rounded-md bg-[#3BA3C7] px-3 py-1.5 text-xs font-medium text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Handoff'}
          </button>
          <button
            type="button"
            onClick={loadLatest}
            disabled={loading}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load Handoff'}
          </button>
          <button
            type="button"
            onClick={copyRestoreBlock}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Copy Restore Block
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 md:col-span-1">
          <span className="text-xs text-zinc-400">Current objective</span>
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What are you trying to accomplish right now?"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-1">
          <span className="text-xs text-zinc-400">Project/topic label (optional)</span>
          <input
            value={projectLabel}
            onChange={(e) => setProjectLabel(e.target.value)}
            placeholder="Veil of the Towers"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-zinc-400">Working context notes</span>
          <textarea
            value={workingNotes}
            onChange={(e) => setWorkingNotes(e.target.value)}
            rows={4}
            placeholder="Paste the important context from your current chat..."
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </label>

        <details className="md:col-span-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-300">Optional details (constraints, decisions, questions, issues)</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Active constraints (one per line)</span>
              <textarea
                value={constraintsText}
                onChange={(e) => setConstraintsText(e.target.value)}
                rows={3}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Recent decisions (one per line)</span>
              <textarea
                value={decisionsText}
                onChange={(e) => setDecisionsText(e.target.value)}
                rows={3}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Open questions (one per line)</span>
              <textarea
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                rows={3}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Known issues (one per line)</span>
              <textarea
                value={issuesText}
                onChange={(e) => setIssuesText(e.target.value)}
                rows={3}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
              />
            </label>
          </div>
        </details>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs text-zinc-400">Working summary (auto-compressed, editable)</span>
          <textarea
            value={workingSummary || handoffPreview.working_summary}
            onChange={(e) => setWorkingSummary(e.target.value)}
            rows={3}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-zinc-300">Restore block preview</p>
          <p className="text-[11px] text-zinc-500">
            {lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : 'Not saved yet'}
          </p>
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-200">{restoreBlock}</pre>
      </div>
    </section>
  )
}
