import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, role } = body as { email?: unknown; role?: unknown }

  if (
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return NextResponse.json(
      { error: 'email must be a valid email address' },
      { status: 400 },
    )
  }

  if (role !== 'member' && role !== 'admin') {
    return NextResponse.json(
      { error: 'role must be "member" or "admin"' },
      { status: 400 },
    )
  }

  const normalizedEmail = email.trim().toLowerCase()

  const supabase = await createSessionClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, owner_id')
    .eq('id', id)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  let callerRole: 'owner' | 'admin' | 'member' | null = null
  if (project.owner_id === user.id) {
    callerRole = 'owner'
  } else {
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('project_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (membership) {
      callerRole = membership.role as 'admin' | 'member'
    }
  }

  if (!callerRole || callerRole === 'member') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (role === 'admin' && callerRole !== 'owner') {
    return NextResponse.json(
      { error: 'Only project owners can invite admins' },
      { status: 403 },
    )
  }

  const { data: seatLimit, error: seatLimitError } = await supabase.rpc(
    'seat_limit_for_project',
    { pid: id },
  )

  if (seatLimitError) {
    console.error('[api/projects/[id]/invite] seat limit RPC error', seatLimitError)
    return NextResponse.json(
      { error: 'Failed to check seat limit' },
      { status: 500 },
    )
  }

  const { count: activeMemberCount, error: countError } = await supabase
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)
    .eq('status', 'active')

  if (countError) {
    console.error('[api/projects/[id]/invite] member count error', countError)
    return NextResponse.json(
      { error: 'Failed to check member count' },
      { status: 500 },
    )
  }

  const usedSeats = activeMemberCount ?? 0
  if (typeof seatLimit === 'number' && usedSeats >= seatLimit) {
    return NextResponse.json(
      { error: 'Seat limit reached. Upgrade your plan to invite more members.' },
      { status: 422 },
    )
  }

  const { data: existing, error: dupError } = await supabase
    .from('team_members')
    .select('id')
    .eq('project_id', id)
    .eq('email', normalizedEmail)
    .eq('status', 'pending')
    .maybeSingle()

  if (dupError) {
    console.error('[api/projects/[id]/invite] duplicate check error', dupError)
    return NextResponse.json(
      { error: 'Failed to check existing invites' },
      { status: 500 },
    )
  }

  if (existing) {
    return NextResponse.json(
      { error: 'An invite for this email address is already pending.' },
      { status: 409 },
    )
  }

  const adminClient = getAdminClient()
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://tages.ai'}/auth/callback?next=/app/projects`

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    normalizedEmail,
    {
      redirectTo,
      data: {
        invite_project_id: id,
        invite_role: role,
      },
    },
  )

  if (inviteError) {
    console.error('[api/projects/[id]/invite] invite error', inviteError)
    return NextResponse.json(
      { error: 'Failed to send invite email' },
      { status: 500 },
    )
  }

  const { error: insertError } = await Promise.resolve(
    adminClient.from('team_members').insert({
      project_id: id,
      email: normalizedEmail,
      role,
      status: 'pending',
      invited_by: user.id,
    }),
  )

  if (insertError) {
    console.error('[api/projects/[id]/invite] insert error', insertError)
    return NextResponse.json(
      { error: 'Failed to record invite' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
