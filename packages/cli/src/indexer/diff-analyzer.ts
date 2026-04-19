import { execFileSync } from 'child_process'
import { isOllamaAvailable, analyzeWithOllama } from './ollama-client.js'
import { analyzeWithHaiku } from './haiku-client.js'

export interface ExtractedMemory {
  key: string
  value: string
  type: string
  files_affected: string[]
}

export type AnalyzerMode = 'ollama' | 'haiku' | 'dumb'

export async function detectMode(): Promise<AnalyzerMode> {
  if (await isOllamaAvailable()) return 'ollama'
  if (process.env.ANTHROPIC_API_KEY) return 'haiku'
  return 'dumb'
}

export async function analyzeDiff(diff: string, stat: string, mode: AnalyzerMode): Promise<ExtractedMemory[]> {
  // Skip if only lock files changed
  const statLines = stat.trim().split('\n')
  const nonLockFiles = statLines.filter(
    (line) => !line.includes('lock') && !line.includes('Lock'),
  )
  if (nonLockFiles.length === 0) return []

  if (mode === 'dumb') {
    return extractFromStat(stat)
  }

  try {
    // Truncate diff to avoid token limits
    const truncated = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff

    if (mode === 'ollama') {
      return await analyzeWithOllama(truncated)
    } else {
      return await analyzeWithHaiku(truncated)
    }
  } catch (err) {
    console.error(`[tages] LLM analysis failed: ${(err as Error).message}`)
    return extractFromStat(stat)
  }
}

function extractFromStat(stat: string): ExtractedMemory[] {
  const files = stat
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^\s*(.+?)\s*\|/)
      return match ? match[1].trim() : null
    })
    .filter(Boolean) as string[]

  if (files.length === 0) return []

  return [{
    key: `files-changed-${Date.now()}`,
    value: `Files changed: ${files.join(', ')}`,
    type: 'architecture',
    files_affected: files,
  }]
}

export function getGitDiff(since?: string): { diff: string; stat: string } {
  const ref = since || 'HEAD~1'
  try {
    const stat = execFileSync('git', ['diff', ref, '--stat'], { encoding: 'utf-8' })
    const diff = execFileSync('git', ['diff', ref], { encoding: 'utf-8' })
    return { diff, stat }
  } catch {
    return { diff: '', stat: '' }
  }
}

export function getCommitsSince(since: string): string[] {
  try {
    const output = execFileSync('git', ['log', `--since=${since}`, '--format=%H'], { encoding: 'utf-8' })
    return output.trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}
