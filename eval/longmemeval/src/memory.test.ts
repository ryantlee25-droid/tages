import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LongMemEvalQuestion } from './types.js'

const execFileSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

// Imported after the mock so TagesCliStore picks up the mocked execFileSync.
import { makeStore, turnToText, looksLikeTierLimitRejection } from './memory.js'

const question: LongMemEvalQuestion = {
  question_id: 'q1',
  question_type: 'multi-session',
  question: 'What did I say?',
  answer: 'Something',
  question_date: '2024-01-10',
  haystack_dates: ['2024-01-01', '2024-01-02'],
  haystack_session_ids: ['sess-a', 'sess-b'],
  haystack_sessions: [
    [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ],
    [
      { role: 'user', content: 'Another turn' },
      { role: 'assistant', content: 'Reply' },
    ],
  ],
  answer_session_ids: ['sess-a'],
}

beforeEach(() => {
  process.env.TAGES_EVAL_PROJECT = 'test-project'
  execFileSyncMock.mockReset()
  execFileSyncMock.mockReturnValue('')
})

describe('turnToText (Task 4)', () => {
  it('embeds the [session=<id> date=<date>] tag before the turn content', () => {
    const text = turnToText('sess-x', '2024-05-01', { role: 'user', content: 'hi' })
    expect(text).toBe('[session=sess-x date=2024-05-01]\nUSER: hi')
  })
})

describe('looksLikeTierLimitRejection (Task 4: silent-failure trap fix)', () => {
  it('detects "limit" case-insensitively', () => {
    expect(looksLikeTierLimitRejection('Error: memory Limit exceeded for free tier')).toBe(true)
  })
  it('does not false-positive on unrelated errors', () => {
    expect(looksLikeTierLimitRejection('command not found: tages')).toBe(false)
  })
})

describe('TagesCliStore.ingest (Task 4: per-round ingestion granularity)', () => {
  it('ingests one memory per turn, keyed longmemeval-<qid>-s<i>-t<j>', async () => {
    const store = makeStore('tages-cli')
    await store.ingest(question)

    const rememberCalls = execFileSyncMock.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === 'remember',
    )
    const keys = rememberCalls.map((c) => (c[1] as string[])[1])
    expect(keys).toEqual([
      'longmemeval-q1-s0-t0',
      'longmemeval-q1-s0-t1',
      'longmemeval-q1-s1-t0',
      'longmemeval-q1-s1-t1',
    ])
  })

  it('each per-turn memory text still carries the [session=<id> date=<date>] tag', async () => {
    const store = makeStore('tages-cli')
    await store.ingest(question)

    const rememberCalls = execFileSyncMock.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === 'remember',
    )
    const firstText = (rememberCalls[0]![1] as string[])[2]
    expect(firstText).toContain('[session=sess-a date=2024-01-01]')
    const thirdText = (rememberCalls[2]![1] as string[])[2]
    expect(thirdText).toContain('[session=sess-b date=2024-01-02]')
  })

  it('clear() forgets every per-round key with no orphans between questions', async () => {
    const store = makeStore('tages-cli')
    await store.ingest(question)
    execFileSyncMock.mockClear()

    await store.clear()

    const forgetCalls = execFileSyncMock.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === 'forget',
    )
    expect(forgetCalls).toHaveLength(4)
    const forgottenKeys = forgetCalls.map((c) => (c[1] as string[])[1]).sort()
    expect(forgottenKeys).toEqual(
      [
        'longmemeval-q1-s0-t0',
        'longmemeval-q1-s0-t1',
        'longmemeval-q1-s1-t0',
        'longmemeval-q1-s1-t1',
      ].sort(),
    )
  })

  it('surfaces a clear error instead of silently dropping the turn when remember hits a tier/memory limit', async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      const err = new Error('Command failed') as Error & { stderr?: Buffer }
      err.stderr = Buffer.from('Error: memory limit exceeded for free tier')
      throw err
    })

    const store = makeStore('tages-cli')
    await expect(store.ingest(question)).rejects.toThrow(/tier\/memory-limit rejection/)
  })

  it('rethrows non-limit errors from remember unchanged', async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error('ENOENT: tages not found')
    })

    const store = makeStore('tages-cli')
    await expect(store.ingest(question)).rejects.toThrow(/ENOENT/)
  })
})
