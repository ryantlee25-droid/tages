import type { Metadata } from 'next'
import { GovernancePage } from '@/components/marketing/governance-page'

export const metadata: Metadata = {
  title: 'Memory Governance | Tages',
  description:
    'Tages memory governance: field-level audit logs, provenance per memory write, RBAC, federation, drift detection, and exportable audit trails for coding teams.',
  robots: 'noindex, nofollow',
}

export default function GovernanceRoute() {
  return <GovernancePage />
}
