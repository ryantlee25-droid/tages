import { describe, it, expect } from 'vitest'
import type { Memory } from '@tages/shared'
import { renderLocalDashboardHtml } from '../commands/dashboard.js'

describe('local dashboard provider scan slice', () => {
  it('renders scan UI and connector scan flow hooks', () => {
    const html = renderLocalDashboardHtml(
      { projectId: 'project-test', slug: 'demo-project' },
      [] as Memory[],
    )

    expect(html).toContain('Provider Topic Scan (ChatGPT First)')
    expect(html).toContain('id="scan-source-provider"')
    expect(html).toContain('onclick="scanProviderTopics()"')
    expect(html).toContain('onclick="importAllScannedTopics()"')
    expect(html).toContain('setup-step-scan')
    expect(html).toContain('connectorRequest("scan_topics"')
  })
})
