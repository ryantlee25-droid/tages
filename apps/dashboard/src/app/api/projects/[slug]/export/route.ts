import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve project + ownership check
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug, owner_id')
    .eq('slug', slug)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch memories
  const { data: memories, error } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', project.id)
    .eq('status', 'live')
    .order('type')
    .order('created_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fire-and-forget audit log — does not block or degrade the export response
  const rowCount = memories?.length ?? 0
  void supabase
    .from('memory_access_log')
    .insert({
      project_id: project.id,
      agent_name: 'dashboard',
      access_type: 'export',
      query: `export:${rowCount}_rows:user:${user.id}`,
      similarity: null,
    })
    .then(() => {/* intentionally ignored */})
    .catch(() => {/* audit failure must not affect export */})

  const format = request.nextUrl.searchParams.get('format') || 'json'

  if (format === 'markdown') {
    const md = buildMarkdown(project.name, memories || [])
    return new NextResponse(md, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-memories.md"`,
      },
    })
  }

  // Default: JSON
  const json = JSON.stringify(memories || [], null, 2)
  return new NextResponse(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${slug}-memories.json"`,
    },
  })
}

interface MemoryRow {
  key: string
  value: string
  type: string
  source: string
  agent_name?: string | null
  confidence?: number
  file_paths?: string[]
  tags?: string[]
  created_at: string
}

function buildMarkdown(projectName: string, memories: MemoryRow[]): string {
  const lines: string[] = [
    `# ${projectName} — Codebase Memory`,
    '',
    `> Exported on ${new Date().toISOString().split('T')[0]}`,
    '',
  ]

  // Group by type
  const byType: Record<string, MemoryRow[]> = {}
  for (const m of memories) {
    if (!byType[m.type]) byType[m.type] = []
    byType[m.type].push(m)
  }

  const typeOrder = ['convention', 'architecture', 'decision', 'entity', 'lesson', 'pattern', 'preference', 'execution']
  const sortedTypes = [
    ...typeOrder.filter((t) => byType[t]),
    ...Object.keys(byType).filter((t) => !typeOrder.includes(t)),
  ]

  for (const type of sortedTypes) {
    const group = byType[type]
    if (!group?.length) continue

    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`)
    lines.push('')

    for (const m of group) {
      lines.push(`### ${m.key}`)
      lines.push('')
      lines.push(m.value)
      lines.push('')

      const meta: string[] = []
      if (m.agent_name) meta.push(`agent: ${m.agent_name}`)
      if (m.confidence != null) meta.push(`confidence: ${(m.confidence * 100).toFixed(0)}%`)
      if (m.file_paths?.length) meta.push(`files: ${m.file_paths.join(', ')}`)
      if (m.tags?.length) meta.push(`tags: ${m.tags.join(', ')}`)
      meta.push(`added: ${m.created_at.split('T')[0]}`)

      if (meta.length) {
        lines.push(`> ${meta.join(' · ')}`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}
