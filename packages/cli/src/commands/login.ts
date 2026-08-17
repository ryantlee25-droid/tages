import * as fs from 'fs'
import chalk from 'chalk'
import { runGithubOAuth } from '../auth/github-oauth.js'
import { getAuthPath, getConfigDir } from '../config/paths.js'

const DASHBOARD_URL = process.env.TAGES_DASHBOARD_URL || 'https://app.tages.ai'

interface StoredAuth {
  accessToken: string
  refreshToken: string
  userId: string
}

/**
 * Reads the identity out of a Supabase access token without a network call.
 *
 * The token is a JWT, so the claims are already in hand; asking the API who we
 * are would need the anon key threaded through here purely to answer a question
 * the token has already answered.
 */
function identityFromToken(accessToken: string): { email?: string; sub?: string; expired?: boolean } {
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return {}
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
    return {
      email: json.email,
      sub: json.sub,
      expired: typeof json.exp === 'number' ? json.exp * 1000 < Date.now() : undefined,
    }
  } catch {
    return {}
  }
}

function readAuth(): StoredAuth | null {
  const p = getAuthPath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as StoredAuth
  } catch {
    return null
  }
}

/**
 * The service key outranks `auth.json` in createAuthenticatedClient, so with it
 * exported every command runs as the service role no matter who is signed in.
 * Signing in then looks like a no-op, which is genuinely hard to debug: `status`
 * keeps reporting healthy numbers because it reads as the service role.
 */
function warnIfServiceKeyShadowsLogin() {
  if (!process.env.TAGES_SERVICE_KEY) return
  console.log()
  console.log(chalk.yellow('  Warning: TAGES_SERVICE_KEY is set in this shell.'))
  console.log(
    chalk.dim('  It takes precedence over your signed-in account, so commands will run as the'),
  )
  console.log(
    chalk.dim('  service role and ignore this login. Run `unset TAGES_SERVICE_KEY` to use it.'),
  )
}

export async function loginCommand() {
  const previous = readAuth()
  if (previous) {
    const who = identityFromToken(previous.accessToken)
    console.log(chalk.dim(`  Currently signed in as ${who.email ?? previous.userId}`))
  }

  console.log(chalk.cyan('  Opening your browser for GitHub authentication...'))

  let auth: StoredAuth
  try {
    auth = await runGithubOAuth(DASHBOARD_URL)
  } catch (err) {
    console.error(chalk.red('  Authentication failed'))
    console.error(chalk.red(`  ${(err as Error).message}`))
    process.exit(1)
  }

  fs.mkdirSync(getConfigDir(), { recursive: true })
  fs.writeFileSync(getAuthPath(), JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 })

  const who = identityFromToken(auth.accessToken)
  console.log(chalk.green('  Signed in as'), who.email ?? auth.userId)
  if (who.email && previous && previous.userId !== auth.userId) {
    console.log(chalk.dim(`  Switched from ${identityFromToken(previous.accessToken).email ?? previous.userId}`))
  }
  console.log(chalk.dim(`  Saved to ${getAuthPath()}`))

  warnIfServiceKeyShadowsLogin()
}

export async function logoutCommand() {
  const p = getAuthPath()
  if (!fs.existsSync(p)) {
    console.log(chalk.dim('  Not signed in.'))
    return
  }
  const who = identityFromToken(readAuth()?.accessToken ?? '')
  fs.rmSync(p)
  console.log(chalk.green('  Signed out'), chalk.dim(who.email ? `(${who.email})` : ''))
  console.log(chalk.dim('  Run `tages login` to sign in again.'))
}

export async function whoamiCommand() {
  const auth = readAuth()
  if (!auth) {
    console.log(chalk.dim('  Not signed in. Run `tages login`.'))
    warnIfServiceKeyShadowsLogin()
    return
  }

  const who = identityFromToken(auth.accessToken)
  console.log(chalk.green('  Signed in as'), who.email ?? chalk.dim('(unknown email)'))
  console.log(chalk.dim(`  User ID: ${auth.userId}`))
  if (who.expired) {
    console.log(chalk.yellow('  Access token is expired. It refreshes automatically on next use;'))
    console.log(chalk.yellow('  run `tages login` if commands still fail.'))
  }

  warnIfServiceKeyShadowsLogin()
}
