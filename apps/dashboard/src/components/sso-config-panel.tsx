'use client'

import { useState, useEffect, useCallback } from 'react'

interface SsoConfig {
  id: string
  domain: string
  metadata_url: string | null
  metadata_xml: string | null
  provider_id: string | null
  enabled: boolean
  created_at: string
}

export function SsoConfigPanel() {
  const [configs, setConfigs] = useState<SsoConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [domain, setDomain] = useState('')
  const [metadataUrl, setMetadataUrl] = useState('')
  const [metadataXml, setMetadataXml] = useState('')

  const fetchConfigs = useCallback(async () => {
    const res = await fetch('/api/sso')
    if (res.ok) {
      const data = await res.json()
      setConfigs(data.configs ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const body: Record<string, string | boolean> = { domain, enabled: true }
    if (metadataUrl) body.metadata_url = metadataUrl
    else if (metadataXml) body.metadata_xml = metadataXml

    const res = await fetch('/api/sso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create SSO config')
    } else {
      setDomain('')
      setMetadataUrl('')
      setMetadataXml('')
      await fetchConfigs()
    }
    setSubmitting(false)
  }

  async function handleToggle(id: string, enabled: boolean) {
    await fetch(`/api/sso/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    await fetchConfigs()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/sso/${id}`, { method: 'DELETE' })
    await fetchConfigs()
  }

  if (loading) {
    return <div className="text-sm text-zinc-400">Loading SSO configurations...</div>
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-white">SSO / SAML Configuration</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Configure SAML 2.0 single sign-on for your organization.
        </p>
      </div>

      {/* Existing configs */}
      {configs.length > 0 && (
        <div className="space-y-3">
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <div>
                <p className="font-medium text-white">{cfg.domain}</p>
                <p className="text-xs text-zinc-500">
                  {cfg.provider_id ? `Provider: ${cfg.provider_id}` : 'No provider registered'}
                  {' · '}
                  {cfg.enabled ? (
                    <span className="text-green-400">Enabled</span>
                  ) : (
                    <span className="text-zinc-500">Disabled</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(cfg.id, !cfg.enabled)}
                  className="rounded px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  {cfg.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => handleDelete(cfg.id)}
                  className="rounded px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-zinc-800"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new config */}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="text-sm font-medium text-white">Add SSO Provider</h3>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <div>
          <label htmlFor="sso-domain" className="mb-1 block text-sm text-zinc-400">Domain</label>
          <input
            id="sso-domain"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            required
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#3BA3C7] focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="sso-metadata-url" className="mb-1 block text-sm text-zinc-400">
            Metadata URL <span className="text-zinc-600">(preferred)</span>
          </label>
          <input
            id="sso-metadata-url"
            type="url"
            value={metadataUrl}
            onChange={(e) => setMetadataUrl(e.target.value)}
            placeholder="https://idp.example.com/saml/metadata"
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#3BA3C7] focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="sso-metadata-xml" className="mb-1 block text-sm text-zinc-400">
            Or paste Metadata XML
          </label>
          <textarea
            id="sso-metadata-xml"
            value={metadataXml}
            onChange={(e) => setMetadataXml(e.target.value)}
            placeholder="<EntityDescriptor ...>"
            rows={4}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-[#3BA3C7] focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !domain}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ backgroundColor: '#3BA3C7' }}
        >
          {submitting ? 'Adding...' : 'Add SSO Provider'}
        </button>
      </form>
    </div>
  )
}
