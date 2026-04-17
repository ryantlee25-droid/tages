import { describe, it, expect } from 'vitest'
import type { Memory } from '@tages/shared'
import { renderHandoff } from '../commands/handoff.js'

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  const now = new Date().toISOString()
  return {
    id: overrides.id || 'm1',
    projectId: overrides.projectId || 'project-1',
    key: overrides.key || 'default-key',
    value: overrides.value || 'default value',
    type: overrides.type || 'convention',
    source: overrides.source || 'manual',
    status: overrides.status || 'live',
    confidence: overrides.confidence ?? 1,
    tags: overrides.tags || [],
    filePaths: overrides.filePaths || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    agentName: overrides.agentName,
    conditions: overrides.conditions,
    phases: overrides.phases,
    crossSystemRefs: overrides.crossSystemRefs,
    examples: overrides.examples,
    executionFlow: overrides.executionFlow,
  }
}

describe('renderHandoff', () => {
  it('renders a ChatGPT paste block grouped by continuity sections', () => {
    const text = renderHandoff([
      makeMemory({ key: 'canon-city', type: 'entity', value: 'Campaign starts in Waterdeep.' }),
      makeMemory({ key: 'no-retcon', type: 'anti_pattern', value: 'Never rewrite past outcomes.' }),
      makeMemory({ key: 'quest-thread', type: 'execution', value: 'Find the missing archivist in Dock Ward.' }),
    ], 'dnd-campaign', 'chatgpt')

    expect(text).toContain('Copy/paste the block below')
    expect(text).toContain('### Canon Facts')
    expect(text).toContain('### Hard Constraints')
    expect(text).toContain('### Active Threads')
    expect(text).toContain('canon-city')
    expect(text).toContain('no-retcon')
    expect(text).toContain('quest-thread')
  })

  it('renders markdown format without code fence', () => {
    const text = renderHandoff([
      makeMemory({ key: 'tone', type: 'preference', value: 'Keep dialogue witty, not grimdark.' }),
    ], 'dnd-campaign', 'markdown', 'tone')

    expect(text).toContain('Project: dnd-campaign')
    expect(text).toContain('Focus: tone')
    expect(text).toContain('### Preferences and Tone')
    expect(text).not.toContain('```text')
  })

  it('renders onboarding hint when no memories are available', () => {
    const text = renderHandoff([], 'empty-project', 'chatgpt')
    expect(text).toContain('No memories found yet')
    expect(text).toContain('tages remember')
  })
})
