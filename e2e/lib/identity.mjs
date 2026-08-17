// Fixture identities: a real Supabase user, an isolated $HOME, and a real git
// work repo, per participant.
//
// The isolation matters more than it looks. Tages resolves everything from
// $HOME (~/.config/tages/{auth.json,projects/,cache/}) and writes .mcp.json into
// the *current directory*. Two "users" sharing a HOME would share auth, project
// config, and SQLite cache — and every cross-user assertion in this suite would
// pass without proving anything. Separate HOMEs are what make identity B
// genuinely a second person.

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Environment variables that must never reach a CLI or server child process.
 *
 * TAGES_SERVICE_KEY is the dangerous one: it bypasses RLS, so leaving it set
 * would make every authorization check in phase 08 vacuously green. The rest
 * would silently repoint a child at a different project or database than the
 * one under test.
 */
export const STRIPPED_ENV = [
  'TAGES_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TAGES_PROJECT_ID',
  'TAGES_PROJECT_SLUG',
  'TAGES_PLAN',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'TAGES_SUPABASE_URL',
  'TAGES_SUPABASE_ANON_KEY',
  'TAGES_ENCRYPTION_KEY',
  'TAGES_E2E_SERVICE_KEY',
  'TAGES_E2E_ANON_KEY',
]

export class Identity {
  constructor(label, { email, userId, session, home, work }) {
    this.label = label
    this.email = email
    this.userId = userId
    this.session = session
    this.home = home
    this.work = work
  }

  get token() {
    return this.session.accessToken
  }

  /** Child-process env: the fixture HOME, with every ambient Tages override removed. */
  env(extra = {}) {
    const env = { ...process.env, HOME: this.home, ...extra }
    for (const k of STRIPPED_ENV) delete env[k]
    return env
  }

  authPath() {
    return path.join(this.home, '.config', 'tages', 'auth.json')
  }

  cachePath(slug) {
    return path.join(this.home, '.config', 'tages', 'cache', `${slug}.db`)
  }

  projectConfigPath(slug) {
    return path.join(this.home, '.config', 'tages', 'projects', `${slug}.json`)
  }

  mcpConfigPath() {
    return path.join(this.work, '.mcp.json')
  }

  /**
   * Simulate "same person, new laptop": drop the local SQLite cache and project
   * config, keep the credentials. Anything recallable afterwards came from the
   * server, which is the only proof that a memory was truly *stored* rather
   * than merely cached.
   */
  wipeLocalState(slug) {
    const removed = []
    for (const p of [this.cachePath(slug), `${this.cachePath(slug)}-wal`, `${this.cachePath(slug)}-shm`]) {
      if (fs.existsSync(p)) {
        fs.rmSync(p)
        removed.push(path.basename(p))
      }
    }
    return removed
  }
}

/**
 * Create a fixture user plus their isolated workspace.
 *
 * The auth.json shape is not arbitrary: link.ts reads `userId` for its
 * membership check and session.ts reads accessToken/refreshToken. Writing only
 * a token produces a CLI that authenticates but cannot join.
 */
export async function createIdentity(api, label, { emailPrefix, password, root }) {
  const email = `${emailPrefix}-${label.toLowerCase()}@example.test`
  const userId = await api.createUser(email, password)
  const session = await api.signIn(email, password)

  const home = path.join(root, 'homes', label)
  const work = path.join(root, 'work', label)
  fs.mkdirSync(path.join(home, '.config', 'tages'), { recursive: true })
  fs.mkdirSync(work, { recursive: true })

  // A real git repo: link writes .git/info/exclude, and slug resolution reads
  // the git remote. A bare directory would exercise a different code path than
  // any engineer will ever be in.
  execFileSync('git', ['init', '-q'], { cwd: work })
  execFileSync('git', ['config', 'user.email', email], { cwd: work })
  execFileSync('git', ['config', 'user.name', `E2E ${label}`], { cwd: work })
  fs.writeFileSync(path.join(work, 'README.md'), `# fixture work repo for ${label}\n`)

  fs.writeFileSync(
    path.join(home, '.config', 'tages', 'auth.json'),
    JSON.stringify({ userId, email, accessToken: session.accessToken, refreshToken: session.refreshToken }, null, 2),
    { mode: 0o600 },
  )

  return new Identity(label, { email, userId, session, home, work })
}
