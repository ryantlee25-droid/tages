import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function registerSamlProvider(domain: string, metadataUrl?: string | null, metadataXml?: string | null): Promise<string | null> {
  const projectRef = process.env.SUPABASE_PROJECT_REF
  const apiKey = process.env.SUPABASE_MANAGEMENT_API_KEY
  if (!projectRef || !apiKey) return null

  const body: Record<string, unknown> = { type: 'saml', domains: [domain] }
  if (metadataUrl) body.metadata_url = metadataUrl
  else if (metadataXml) body.metadata_xml = metadataXml
  else return null

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth/sso/providers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) return null
  const data = await res.json() as { id?: string }
  return data.id ?? null
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data, error } = await Promise.resolve(
    admin.from('sso_configs').select('*').eq('owner_id', user.id).order('created_at', { ascending: false })
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ configs: data })
}

export async function POST(request: Request) {
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

  let body: { domain?: string; metadata_url?: string; metadata_xml?: string; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { domain, metadata_url, metadata_xml, enabled } = body
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  // Register with Supabase Management API (best-effort)
  const provider_id = await registerSamlProvider(domain, metadata_url, metadata_xml)

  const { data, error } = await Promise.resolve(
    admin.from('sso_configs').insert({
      owner_id: user.id,
      domain,
      metadata_url: metadata_url ?? null,
      metadata_xml: metadata_xml ?? null,
      provider_id,
      enabled: enabled ?? false,
    }).select().single()
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ config: data }, { status: 201 })
}
