import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch project and verify ownership
  const { data: project, error: fetchError } = await supabase
    .from('projects')
    .select('id, owner_id')
    .eq('id', id)
    .single()

  if (fetchError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, git_remote, default_branch } = body as {
    name?: unknown
    git_remote?: unknown
    default_branch?: unknown
  }

  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
  }

  if (git_remote !== undefined && git_remote !== null && typeof git_remote !== 'string') {
    return NextResponse.json({ error: 'git_remote must be a string or null' }, { status: 400 })
  }

  if (default_branch !== undefined && typeof default_branch !== 'string') {
    return NextResponse.json({ error: 'default_branch must be a string' }, { status: 400 })
  }

  const updates: { name: string; git_remote: string | null; default_branch?: string } = {
    name: name.trim(),
    git_remote: typeof git_remote === 'string' ? git_remote.trim() || null : null,
  }

  if (typeof default_branch === 'string' && default_branch.trim()) {
    updates.default_branch = default_branch.trim()
  }

  const { data: updated, error: updateError } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    console.error('[api/projects/[id]] update error', updateError)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }

  return NextResponse.json(updated)
}
