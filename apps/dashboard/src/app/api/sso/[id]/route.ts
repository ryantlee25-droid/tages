import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function removeSamlProvider(providerId: string): Promise<void> {
  const projectRef = process.env.SUPABASE_PROJECT_REF
  const apiKey = process.env.SUPABASE_MANAGEMENT_API_KEY
  if (!projectRef || !apiKey || !providerId) return

  await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth/sso/providers/${providerId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  )
  // Best-effort: ignore errors
}

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data, error } = await Promise.resolve(
    admin.from('sso_configs').select('*').eq('id', id).eq('owner_id', user.id).single()
  )

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ config: data })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()

  // Pro check
  const { data: profile } = await Promise.resolve(
    admin.from('user_profiles').select('is_pro').eq('user_id', user.id).single()
  )
  if (!profile?.is_pro) {
    return NextResponse.json({ error: 'SSO requires a Pro subscription.' }, { status: 403 })
  }

  let body: { domain?: string; metadata_url?: string | null; metadata_xml?: string | null; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.domain !== undefined) updates.domain = body.domain
  if (body.metadata_url !== undefined) updates.metadata_url = body.metadata_url
  if (body.metadata_xml !== undefined) updates.metadata_xml = body.metadata_xml
  if (body.enabled !== undefined) updates.enabled = body.enabled

  const { data, error } = await Promise.resolve(
    admin.from('sso_configs').update(updates).eq('id', id).eq('owner_id', user.id).select().single()
  )

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: error ? 500 : 404 })
  }
  return NextResponse.json({ config: data })
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()

  // Pro check
  const { data: profile } = await Promise.resolve(
    admin.from('user_profiles').select('is_pro').eq('user_id', user.id).single()
  )
  if (!profile?.is_pro) {
    return NextResponse.json({ error: 'SSO requires a Pro subscription.' }, { status: 403 })
  }

  // Fetch to get provider_id before deletion
  const { data: existing } = await Promise.resolve(
    admin.from('sso_configs').select('provider_id').eq('id', id).eq('owner_id', user.id).single()
  )
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Remove from Supabase Management API (best-effort)
  if (existing.provider_id) {
    await removeSamlProvider(existing.provider_id)
  }

  const { error } = await Promise.resolve(
    admin.from('sso_configs').delete().eq('id', id).eq('owner_id', user.id)
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
