import { describe, it, expect } from 'vitest'
import { FREE_TOOLS, PRO_TOOLS, ALL_TOOLS } from '../tier-config.js'

describe('tier-config', () => {
  it('FREE_TOOLS + PRO_TOOLS total 56 tools', () => {
    expect(FREE_TOOLS.length + PRO_TOOLS.length).toBe(56)
  })

  it('ALL_TOOLS equals FREE_TOOLS + PRO_TOOLS combined', () => {
    expect(ALL_TOOLS.length).toBe(FREE_TOOLS.length + PRO_TOOLS.length)
  })

  it('has no duplicates within FREE_TOOLS', () => {
    const unique = new Set(FREE_TOOLS)
    expect(unique.size).toBe(FREE_TOOLS.length)
  })

  it('has no duplicates within PRO_TOOLS', () => {
    const unique = new Set(PRO_TOOLS)
    expect(unique.size).toBe(PRO_TOOLS.length)
  })

  it('has no tools appearing in both FREE_TOOLS and PRO_TOOLS', () => {
    const freeSet = new Set(FREE_TOOLS)
    const overlap = PRO_TOOLS.filter(tool => freeSet.has(tool))
    expect(overlap).toEqual([])
  })

  it('core memory tools are in FREE_TOOLS', () => {
    expect(FREE_TOOLS).toContain('remember')
    expect(FREE_TOOLS).toContain('recall')
    expect(FREE_TOOLS).toContain('forget')
  })

  it('advanced analysis tools are in PRO_TOOLS', () => {
    expect(PRO_TOOLS).toContain('memory_graph')
    expect(PRO_TOOLS).toContain('impact_analysis')
    expect(PRO_TOOLS).toContain('risk_report')
  })

  it('session and context tools are in FREE_TOOLS', () => {
    expect(FREE_TOOLS).toContain('session_end')
    expect(FREE_TOOLS).toContain('context')
    expect(FREE_TOOLS).toContain('pre_check')
    expect(FREE_TOOLS).toContain('project_brief')
  })

  it('branching and federation tools are in PRO_TOOLS', () => {
    expect(PRO_TOOLS).toContain('fork_branch')
    expect(PRO_TOOLS).toContain('merge_branch')
    expect(PRO_TOOLS).toContain('list_branches')
    expect(PRO_TOOLS).toContain('federate_memory')
  })

  it('archive tools are in PRO_TOOLS', () => {
    expect(PRO_TOOLS).toContain('archive_memory')
    expect(PRO_TOOLS).toContain('restore_memory')
    expect(PRO_TOOLS).toContain('list_archived')
    expect(PRO_TOOLS).toContain('archive_stats')
    expect(PRO_TOOLS).toContain('auto_archive')
  })

  it('import tools are in FREE_TOOLS', () => {
    expect(FREE_TOOLS).toContain('import_claude_md')
    expect(FREE_TOOLS).toContain('import_memories')
  })

  it('sharpen and post_session are in PRO_TOOLS', () => {
    expect(PRO_TOOLS).toContain('sharpen_memory')
    expect(PRO_TOOLS).toContain('post_session')
  })
})
