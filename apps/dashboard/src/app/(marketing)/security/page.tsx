import type { Metadata } from 'next'
import { SecurityPage } from '@/components/marketing/security-page'

export const metadata: Metadata = {
  title: 'Security | Tages',
  description:
    'Tages security posture: AES-256-GCM encryption, TLS 1.2+, Supabase Auth, RLS on all tables, RBAC, and full self-hosting support.',
}

export default function SecurityRoute() {
  return <SecurityPage />
}
