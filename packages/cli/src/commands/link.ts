import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { getProjectsDir, getAuthPath } from '../config/paths.js'
import { injectMcpConfig } from '../config/mcp-inject.js'
import { installPostCommitHook } from '../indexer/install-hook.js'
import { createAuthenticatedClient } from '../auth/session.js'
import { runGithubOAuth } from '../auth/github-oauth.js'
// `init` owns the server-resolution helper; `link` must wire an agent exactly
// the way `init` does, so it reuses that one implementation rather than
// carrying a second copy that could drift.
import { resolveServerInvocation, printServerInvocation } from './init.js'

/* eslint-disable @typescript-eslint/ban-ts-comment */

// ------------------------------------------------------------
// Cross-package import from packages/shared/src/project-factory.ts
//
// `findMemberProjectById` is intentionally NOT re-exported from
// `@tages/shared`'s public barrel (packages/shared/src/index.ts) as part of
// this change, so we reach it the same way other CLI commands reach into a
// sibling package's source (see packages/cli/src/commands/drift.ts,
// harness.ts, agents-md.ts): the CLI tsconfig sets rootDir="../../" (the
// monorepo root), so a relative import three levels up from
// packages/cli/src/commands/ resolves to the sibling package's source.
//
// This MUST be a lazy `await import(...)`, not a static
// `import {...} from ...` — `packages/shared/package.json` has no
// `"type": "module"` field, so Node/tsx treat that subtree as CommonJS.
// A static ESM import of a named export from a CJS-resolved sibling module
// fails at load time ("does not provide an export named ..."); a dynamic
// `import()` goes through Node's CJS-interop (cjs-module-lexer) correctly
// and exposes the named export, matching what every other cross-package
// import in this package already does.
// ------------------------------------------------------------
async function loadFindMemberProjectById(): Promise<
  (
    projectId: string,
    userId: string,
    supabase: Awaited<ReturnType<typeof createAuthenticatedClient>>,
  ) => Promise<{ projectId: string; slug: string; plan?: 'free' | 'pro' | 'team' } | null>
> {
  // @ts-ignore — cross-package import; shared must be built first
  const mod = await import('../../../shared/src/project-factory.js')
  return mod.findMemberProjectById
}

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://app.tages.ai'
const SUPABASE_URL = process.env.TAGES_SUPABASE_URL || 'https://wezagdgpvwfywjoxztfs.supabase.co'
const SUPABASE_ANON_KEY = process.env.TAGES_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndlemFnZGdwdndmeXdqb3h6dGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDcyNTAsImV4cCI6MjA5MDkyMzI1MH0.iMJ3gnt0w104QxzEaTLJsAYVciPDFJvAzOtIU5tofG0'

export interface LinkOptions {
  projectId?: string
  slug?: string
}

export async function linkCommand(slug?: string, options: LinkOptions = {}) {
  if (options.projectId) {
    await linkByProjectId(options.projectId, options.slug || slug)
    return
  }

  // ------------------------------------------------------------------
  // Legacy path (unchanged): link this directory to an already-registered
  // local project by slug. This only works for the machine that originally
  // ran `tages init` (or a previous `--project-id` join), since it just
  // reads ~/.config/tages/projects/<slug>.json — it never touches Supabase.
  // ------------------------------------------------------------------
  const targetSlug = slug || path.basename(process.cwd())

  // Check if this slug is a registered project
  const projectsDir = getProjectsDir()
  const configPath = path.join(projectsDir, `${targetSlug}.json`)

  if (!fs.existsSync(configPath)) {
    // List available projects for help
    const available = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir)
          .filter(f => f.endsWith('.json') && !f.endsWith('.bak'))
          .map(f => f.replace('.json', ''))
      : []

    console.error(chalk.red(`  No registered project found for slug '${targetSlug}'.`))
    if (available.length > 0) {
      console.error(chalk.dim(`  Available projects: ${available.join(', ')}`))
    }
    console.error(chalk.dim(`  Run 'tages init' to create a new project first, or use`))
    console.error(chalk.dim(`  'tages link --project-id <uuid>' to join a teammate's project.`))
    process.exit(1)
  }

  writeDirMarker(targetSlug)

  console.log(chalk.green(`  Linked this directory to project '${targetSlug}'.`))
  console.log(chalk.dim(`  Wrote ${path.join(process.cwd(), '.tages', 'config.json')}`))
  console.log(chalk.dim(`  The MCP server will now auto-detect this project when started here.`))
}

/**
 * Join an existing shared project by ID — the path for an invited team
 * member whose machine has never run `tages init` against this project
 * (so ~/.config/tages/projects/<slug>.json was never populated for them).
 *
 * Steps:
 *  1. Authenticate the caller (reuse the same GitHub OAuth flow `tages init`
 *     uses; skip it if a session is already saved).
 *  2. Verify the project exists AND the authenticated user is a member,
 *     via `findMemberProjectById` — which decides membership with the
 *     `is_project_member` SECURITY DEFINER RPC (fail-closed), authoritative
 *     under both normal-auth and service-role clients.
 *  3. Write the local project config + `.tages/config.json` marker, same
 *     shape/location `createCloudProject`/`tages init` already produce.
 */
async function linkByProjectId(projectId: string, slugOverride: string | undefined) {
  // A self-hosted instance is configured via TAGES_SUPABASE_URL +
  // TAGES_SUPABASE_ANON_KEY (both together — see the constants above); we do
  // NOT accept a per-invocation --supabase-url, which would pair a custom URL
  // with the default cloud anon key and produce a mismatched, non-working
  // client config.
  const supabaseUrl = SUPABASE_URL
  const supabaseAnonKey = SUPABASE_ANON_KEY

  const spinner = ora()

  let userId: string
  const authPath = getAuthPath()

  // `link` identifies the joining user from their stored session; the userId
  // is required for the membership check. TAGES_SERVICE_KEY (an RLS-bypass for
  // headless data access) can't identify a user, so fail clearly rather than
  // opening a browser we can't drive in a headless/CI context.
  if (process.env.TAGES_SERVICE_KEY && !fs.existsSync(authPath)) {
    console.error(chalk.red('  `tages link --project-id` needs an authenticated user session.'))
    console.error(chalk.dim('  TAGES_SERVICE_KEY alone cannot identify which user is joining —'))
    console.error(chalk.dim('  run `tages init` on this machine first, then retry.'))
    process.exit(1)
  }

  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
      if (!auth.userId) throw new Error('missing userId')
      userId = auth.userId
    } catch {
      console.error(chalk.red('  Stored auth is corrupt. Run `tages init` to re-authenticate.'))
      process.exit(1)
    }
  } else {
    spinner.start('Opening browser for GitHub authentication...')
    try {
      const auth = await runGithubOAuth(DASHBOARD_URL)
      const authDir = path.dirname(authPath)
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true })
      }
      fs.writeFileSync(authPath, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 })
      userId = auth.userId
      spinner.succeed('Authenticated with GitHub')
    } catch (err) {
      spinner.fail('Authentication failed')
      console.error(chalk.red(`  ${(err as Error).message}`))
      process.exit(1)
    }
  }

  spinner.start(`Looking up project ${projectId}...`)
  const supabase = await createAuthenticatedClient(supabaseUrl, supabaseAnonKey)

  // Distinguish an expired/absent session from a genuine non-membership.
  // createAuthenticatedClient returns an UNAUTHENTICATED client when the
  // stored refresh token has also expired; findMemberProjectById would then
  // return null under RLS and we'd wrongly tell an actual member "you aren't
  // a member — ask for an invite." Detect the missing session up front and
  // send them to re-auth instead. (Skipped under TAGES_SERVICE_KEY, which has
  // no user session by design; its membership is enforced by the explicit
  // check inside findMemberProjectById.)
  if (!process.env.TAGES_SERVICE_KEY) {
    const { data: userData, error: userError } = await supabase.auth.getUser()
    // Only treat this as expired when we get a CLEAN "no user" answer. This
    // getUser() round-trip is redundant with createAuthenticatedClient (which
    // already validated/refreshed the session); a transient network error on
    // it must NOT turn away a member whose session is actually fine, so we
    // proceed on error and let the membership check be the real gate.
    if (!userError && !userData?.user) {
      spinner.fail('Session expired')
      console.error(chalk.red('  Your session has expired or could not be established.'))
      console.error(chalk.dim('  Run `tages init` to re-authenticate, then try again.'))
      process.exit(1)
    }
  }

  const findMemberProjectById = await loadFindMemberProjectById()

  const project = await findMemberProjectById(projectId, userId, supabase)

  if (!project) {
    spinner.fail('Project not found')
    console.error(chalk.red(`  Could not find project '${projectId}' for your account.`))
    console.error(chalk.dim(`  Either the project doesn't exist, or you haven't been added as a team member yet.`))
    console.error(chalk.dim(`  Ask a project owner/admin to run \`tages team invite <your-email>\`, then try again.`))
    process.exit(1)
    return
  }

  spinner.succeed(`Found project: ${project.slug}`)

  const targetSlug = slugOverride || project.slug

  const projectsDir = getProjectsDir()
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true })
  }

  const projectConfig = {
    projectId: project.projectId,
    slug: targetSlug,
    supabaseUrl,
    supabaseAnonKey,
    plan: project.plan,
  }

  const configPath = path.join(projectsDir, `${targetSlug}.json`)

  // Don't silently clobber an existing local link that points at a DIFFERENT
  // project — that would orphan the previous binding (and every directory
  // marker referencing this slug). Idempotent re-join of the same project is
  // fine; only a genuine collision is refused. The exit stays OUTSIDE the
  // read try/catch so it can't be swallowed by the unreadable-config handler.
  let existingProjectId: string | undefined
  if (fs.existsSync(configPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (typeof existing.projectId === 'string') existingProjectId = existing.projectId
    } catch {
      // Unreadable existing config — it's already broken, safe to replace.
    }
  }

  if (existingProjectId && existingProjectId !== project.projectId) {
    console.error(chalk.red(`  A project named '${targetSlug}' is already linked locally to a different project (${existingProjectId}).`))
    console.error(chalk.dim(`  Re-run with --slug <name> to bind under a different name, or remove`))
    console.error(chalk.dim(`  ${configPath} first.`))
    process.exit(1)
  }

  fs.writeFileSync(configPath, JSON.stringify(projectConfig, null, 2) + '\n', { mode: 0o600 })

  writeDirMarker(targetSlug)

  // Writing the project config + dir marker is not enough: without these two
  // steps the teammate "joins" successfully and their agent is still wired to
  // nothing. `tages init` does both, and a join has to reach the same end
  // state. Same order and same options as init's cloud path, using the joined
  // project's own id/slug.
  const server = resolveServerInvocation()
  const { path: mcpPath, created } = injectMcpConfig({
    supabaseUrl,
    supabaseAnonKey,
    projectId: project.projectId,
    projectSlug: targetSlug,
    serverCommand: server.command,
    serverArgs: server.args,
  })

  const { installed: hookInstalled, path: hookPath } = installPostCommitHook()

  console.log()
  console.log(chalk.green(`  Joined project '${targetSlug}' (${project.projectId}).`))
  console.log(chalk.dim(`  Project config: ${configPath}`))
  console.log(chalk.dim(`  Wrote ${path.join(process.cwd(), '.tages', 'config.json')}`))
  console.log(chalk.green('  MCP config:'), mcpPath, created ? '(created)' : '(updated)')
  printServerInvocation(server)
  if (hookInstalled) {
    console.log(chalk.green('  Git hook:'), hookPath)
  }
  console.log(chalk.dim(`  The MCP server will now auto-detect this project when started here.`))
}

/**
 * Writes the `.tages/config.json` marker in the current directory, shared
 * by both the legacy local-slug path and the new `--project-id` join path.
 */
function writeDirMarker(targetSlug: string) {
  const tagesDir = path.join(process.cwd(), '.tages')
  if (!fs.existsSync(tagesDir)) {
    fs.mkdirSync(tagesDir, { recursive: true })
  }

  const markerPath = path.join(tagesDir, 'config.json')
  fs.writeFileSync(markerPath, JSON.stringify({ slug: targetSlug }, null, 2) + '\n')
}
