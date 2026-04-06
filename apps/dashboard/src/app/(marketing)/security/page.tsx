import type { Metadata } from 'next'
import { SecurityPage } from '@/components/marketing/security-page'

export const metadata: Metadata = {
  title: 'Security — Tages',
  description:
    'Tages security posture: AES-256-GCM encryption, TLS 1.2+, Supabase Auth, RLS on all tables, RBAC, and full self-hosting support.',
}

export default function SecurityRoute() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Subtle grid texture */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <div className="relative">
        <SecurityPage />
      </div>
    </div>
  )
}
