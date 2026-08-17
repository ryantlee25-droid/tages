// Direct Supabase REST/RPC access, used to verify what the CLI *claims* it did.
//
// Every durability assertion in this suite reads the database back rather than
// trusting CLI stdout. A green "Stored:" line has, in this repo's history,
// coexisted with a memory that never left the developer's laptop.
//
// Key material is passed to fetch and never returned, logged, or embedded in a
// check's detail string. `redact()` guards the one place raw bodies surface.

const KEYISH = /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(sb[ps]?_[A-Za-z0-9_-]{16,})/g

/** Strip anything shaped like a JWT or Supabase key before it reaches a log line. */
export function redact(s) {
  return String(s ?? '').replace(KEYISH, '<redacted>')
}

export class Api {
  /**
   * @param {string} url        https://<ref>.supabase.co
   * @param {string} anonKey    public anon key — used for all user-scoped calls
   * @param {string} serviceKey service_role key — fixture setup/teardown ONLY
   */
  constructor(url, anonKey, serviceKey) {
    this.url = url.replace(/\/$/, '')
    this.anonKey = anonKey
    this.serviceKey = serviceKey
  }

  /**
   * @param {object} opts.as  { token } to call as a specific user via the anon
   *                          key (the realistic path, and the only one that
   *                          exercises RLS). Omit to use service_role, which
   *                          bypasses RLS and must never be used for an
   *                          authorization assertion.
   */
  async raw(pathname, { method = 'GET', body, headers = {}, as = null } = {}) {
    const useService = !as
    const apikey = useService ? this.serviceKey : this.anonKey
    const bearer = useService ? this.serviceKey : as.token
    const res = await fetch(`${this.url}${pathname}`, {
      method,
      headers: {
        apikey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    let parsed
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    return { status: res.status, ok: res.ok, body: parsed }
  }

  /** PostgREST table read/write. `select` is a PostgREST column list. */
  rest(pathname, opts = {}) {
    return this.raw(`/rest/v1${pathname}`, opts)
  }

  /** Insert returning the created rows. */
  insert(table, row, opts = {}) {
    return this.rest(`/${table}`, {
      method: 'POST',
      body: row,
      headers: { Prefer: 'return=representation' },
      ...opts,
    })
  }

  rpc(fn, args = {}, opts = {}) {
    return this.raw(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, ...opts })
  }

  /** Rows for one memory key. Read as a real user by default via `as`. */
  async memoryByKey(projectId, key, select = 'id,key,value,status,embedding,updated_at,created_at', as = null) {
    const r = await this.rest(
      `/memories?project_id=eq.${projectId}&key=eq.${encodeURIComponent(key)}&select=${select}`,
      { as },
    )
    return Array.isArray(r.body) ? r.body : []
  }

  // ---- fixture identity management (service_role only) --------------------

  async createUser(email, password) {
    const r = await this.raw('/auth/v1/admin/users', {
      method: 'POST',
      body: { email, password, email_confirm: true },
    })
    if (!r.body?.id) throw new Error(`admin createUser failed (${r.status}): ${redact(JSON.stringify(r.body)).slice(0, 200)}`)
    return r.body.id
  }

  async deleteUser(userId) {
    return this.raw(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' })
  }

  /** Password grant — returns the session the CLI's auth.json would hold after OAuth. */
  async signIn(email, password) {
    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.json()
    if (!body.access_token) throw new Error(`sign-in failed for ${email} (${res.status})`)
    return { accessToken: body.access_token, refreshToken: body.refresh_token }
  }
}
