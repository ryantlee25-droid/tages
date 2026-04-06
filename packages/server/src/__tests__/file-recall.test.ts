import { describe, it, expect, beforeEach } from 'vitest'
import { handleFileRecall } from '../tools/file-recall'
import type { Memory } from '@tages/shared'

// Minimal SqliteCache stub — only getAllForProject is used by handleFileRecall
function makeCache(memories: Memory[]) {
  return {
    getAllForProject: (_projectId: string) => memories,
  } as unknown as import('../cache/sqlite').SqliteCache
}

function makeMemory(overrides: Partial<Memory> & { key: string; type: Memory['type'] }): Memory {
  const { key, type, value, filePaths, ...rest } = overrides
  return {
    id: key,
    projectId: 'test-project',
    key,
    value: value ?? `Value for ${key}`,
    type,
    source: 'manual',
    status: 'live',
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    filePaths,
    ...rest,
  }
}

const PROJECT_ID = 'test-project'

describe('handleFileRecall', () => {
  it('returns empty when no memories match', async () => {
    const cache = makeCache([
      makeMemory({ key: 'mem1', type: 'convention', filePaths: ['packages/cli/src/'] }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['packages/server/src/index.ts'] },
      PROJECT_ID,
      cache,
    )

    expect(result.content[0].text).toContain('No memories match')
  })

  it('returns memory on exact path match', async () => {
    const cache = makeCache([
      makeMemory({
        key: 'exact-match',
        type: 'convention',
        filePaths: ['packages/cli/src/commands/foo.ts'],
      }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['packages/cli/src/commands/foo.ts'] },
      PROJECT_ID,
      cache,
    )

    const text = result.content[0].text
    expect(text).toContain('exact-match')
    expect(text).toContain('convention')
  })

  it('returns memory on directory prefix match (memory path is prefix of input)', async () => {
    // memory has "src/commands/", input has "src/commands/foo.ts"
    const cache = makeCache([
      makeMemory({
        key: 'prefix-match',
        type: 'convention',
        filePaths: ['src/commands/'],
      }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['src/commands/foo.ts'] },
      PROJECT_ID,
      cache,
    )

    const text = result.content[0].text
    expect(text).toContain('prefix-match')
  })

  it('returns memory on reverse prefix match (input path is prefix of memory path)', async () => {
    // memory has "src/commands/foo.ts", input has "src/commands/"
    const cache = makeCache([
      makeMemory({
        key: 'reverse-prefix-match',
        type: 'lesson',
        filePaths: ['src/commands/foo.ts'],
      }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['src/commands/'] },
      PROJECT_ID,
      cache,
    )

    const text = result.content[0].text
    expect(text).toContain('reverse-prefix-match')
  })

  it('returns memories in priority order (convention before pattern)', async () => {
    const cache = makeCache([
      makeMemory({
        key: 'pattern-mem',
        type: 'pattern',
        filePaths: ['src/commands/'],
      }),
      makeMemory({
        key: 'convention-mem',
        type: 'convention',
        filePaths: ['src/commands/'],
      }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['src/commands/foo.ts'] },
      PROJECT_ID,
      cache,
    )

    const text = result.content[0].text
    const conventionIndex = text.indexOf('convention-mem')
    const patternIndex = text.indexOf('pattern-mem')
    // convention should appear before pattern
    expect(conventionIndex).toBeLessThan(patternIndex)
  })

  it('respects the limit', async () => {
    const memories = Array.from({ length: 20 }, (_, i) =>
      makeMemory({
        key: `mem-${i}`,
        type: 'lesson',
        filePaths: ['src/commands/'],
      }),
    )
    const cache = makeCache(memories)

    const result = await handleFileRecall(
      { filePaths: ['src/commands/foo.ts'], limit: 5 },
      PROJECT_ID,
      cache,
    )

    // Count occurrences of "[lesson]" — should be at most 5
    const matches = (result.content[0].text.match(/\[lesson\]/g) ?? []).length
    expect(matches).toBeLessThanOrEqual(5)
  })

  it('skips memories with no filePaths', async () => {
    const cache = makeCache([
      makeMemory({ key: 'no-paths', type: 'convention', filePaths: undefined }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['src/commands/foo.ts'] },
      PROJECT_ID,
      cache,
    )

    expect(result.content[0].text).toContain('No memories match')
  })

  it('skips non-live memories', async () => {
    const cache = makeCache([
      makeMemory({
        key: 'pending-mem',
        type: 'convention',
        filePaths: ['src/commands/'],
        status: 'pending',
      }),
    ])

    const result = await handleFileRecall(
      { filePaths: ['src/commands/foo.ts'] },
      PROJECT_ID,
      cache,
    )

    expect(result.content[0].text).toContain('No memories match')
  })
})
