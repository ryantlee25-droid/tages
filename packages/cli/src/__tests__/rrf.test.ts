import { describe, it, expect } from 'vitest'
import { reciprocalRankFusion } from '../lib/rrf.js'

interface Row {
  id: string
  [key: string]: unknown
}

describe('reciprocalRankFusion', () => {
  it('ranks an item that is #1 in both lists above an item that is #1 in only one list', () => {
    const listA: Row[] = [{ id: 'both' }, { id: 'only-a' }]
    const listB: Row[] = [{ id: 'both' }, { id: 'only-b' }]

    const result = reciprocalRankFusion([listA, listB])

    expect(result[0].id).toBe('both')
  })

  it('gives 0 contribution (not an error) for an id absent from a list', () => {
    const listA: Row[] = [{ id: 'a' }, { id: 'b' }]
    const listB: Row[] = [{ id: 'b' }]

    expect(() => reciprocalRankFusion([listA, listB])).not.toThrow()
    const result = reciprocalRankFusion([listA, listB])
    // 'b' ranked #1 in listB and #2 in listA -> higher fused score than 'a'
    // which only appears in listA at rank #1.
    const ids = result.map((r) => r.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids[0]).toBe('b')
  })

  it('k changes the score spread but not the relative order for a fixed input', () => {
    const listA: Row[] = [{ id: 'x' }, { id: 'y' }, { id: 'z' }]
    const listB: Row[] = [{ id: 'y' }, { id: 'x' }]

    const withDefaultK = reciprocalRankFusion([listA, listB]).map((r) => r.id)
    const withSmallK = reciprocalRankFusion([listA, listB], 1).map((r) => r.id)
    const withLargeK = reciprocalRankFusion([listA, listB], 1000).map((r) => r.id)

    expect(withDefaultK).toEqual(withSmallK)
    expect(withDefaultK).toEqual(withLargeK)
  })

  it('does not throw on empty lists and returns an empty array', () => {
    expect(reciprocalRankFusion([])).toEqual([])
    expect(reciprocalRankFusion([[], []])).toEqual([])
  })

  it('handles a list that is empty alongside non-empty lists', () => {
    const listA: Row[] = [{ id: 'only-here' }]
    const result = reciprocalRankFusion([listA, []])
    expect(result.map((r) => r.id)).toEqual(['only-here'])
  })

  it('fuses 3 lists correctly (temporal-channel case)', () => {
    const listA: Row[] = [{ id: 'a' }, { id: 'shared' }]
    const listB: Row[] = [{ id: 'shared' }, { id: 'b' }]
    const listC: Row[] = [{ id: 'shared' }, { id: 'c' }]

    const result = reciprocalRankFusion([listA, listB, listC])
    // 'shared' appears in all 3 lists (once at rank 1, twice at rank 1, and
    // once at rank 2) -> highest fused score, must be first.
    expect(result[0].id).toBe('shared')
    const ids = result.map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c', 'shared']))
    expect(ids).toHaveLength(4)
  })

  it('fuses 4 lists correctly (chunk-semantic-channel case)', () => {
    const listA: Row[] = [{ id: 'top' }]
    const listB: Row[] = [{ id: 'top' }]
    const listC: Row[] = [{ id: 'top' }]
    const listD: Row[] = [{ id: 'top' }, { id: 'only-in-d' }]

    const result = reciprocalRankFusion([listA, listB, listC, listD])
    expect(result[0].id).toBe('top')
    expect(result.map((r) => r.id)).toContain('only-in-d')
    expect(result).toHaveLength(2)
  })

  it('merges row data preferring whichever list ranked the id higher', () => {
    const listA: Row[] = [{ id: 'x', source: 'a', rank: 1 }]
    const listB: Row[] = [{ id: 'y' }, { id: 'x', source: 'b', rank: 2 }]

    const result = reciprocalRankFusion([listA, listB])
    const x = result.find((r) => r.id === 'x')
    // 'x' is rank 1 in listA and rank 2 in listB -> listA's row data wins.
    expect(x?.source).toBe('a')
  })

  it('sorts purely by summed score descending', () => {
    const listA: Row[] = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
    const result = reciprocalRankFusion([listA])
    expect(result.map((r) => r.id)).toEqual(['first', 'second', 'third'])
  })
})
