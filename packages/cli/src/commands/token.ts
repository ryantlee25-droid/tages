import * as fs from 'fs'
import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { getAuthPath } from '../config/paths.js'
import { loadProjectConfig } from '../config/project.js'
import { generateToken } from '../auth/token-auth.js'

interface TokenOptions {
  name?: string
  project?: string
}

interface TokenRotateOptions {
  name?: string
  project?: string
  expiresIn?: string
}

export async function tokenGenerateCommand(options: TokenOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const auth = loadAuth()
  if (!auth) {
    console.error(chalk.red('Not authenticated. Run `tages init` first.'))
    process.exit(1)
  }

  const { token, hash } = generateToken()
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { error } = await supabase.from('api_tokens').insert({
    user_id: auth.userId,
    token_hash: hash,
    name: options.name || 'default',
  })

  if (error) {
    console.error(chalk.red(`Failed to create token: ${error.message}`))
    process.exit(1)
  }

  console.log()
  console.log(chalk.green('  API token created'))
  console.log()
  console.log(chalk.bold(`  ${token}`))
  console.log()
  console.log(chalk.dim('  Save this token — it cannot be shown again.'))
  console.log(chalk.dim('  Use with: tages index --token <token>'))
  console.log(chalk.dim('  Or set: CBM_API_TOKEN=<token> in CI'))
}

export async function tokenListCommand(options: TokenOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
  const { data } = await supabase
    .from('api_tokens')
    .select('id, name, created_at, last_used')
    .order('created_at', { ascending: false })

  if (!data || data.length === 0) {
    console.log(chalk.dim('  No API tokens.'))
    return
  }

  console.log()
  for (const t of data) {
    const lastUsed = t.last_used
      ? new Date(t.last_used).toLocaleDateString()
      : 'never'
    console.log(`  ${chalk.bold(t.name)} — created ${new Date(t.created_at).toLocaleDateString()}, last used ${lastUsed}`)
  }
  console.log()
}

export async function tokenRotateCommand(options: TokenRotateOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const auth = loadAuth()
  if (!auth) {
    console.error(chalk.red('Not authenticated. Run `tages init` first.'))
    process.exit(1)
  }

  const tokenName = options.name || 'default'
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Check that the token to rotate exists
  const { data: existing, error: fetchError } = await supabase
    .from('api_tokens')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('name', tokenName)
    .single()

  if (fetchError || !existing) {
    console.error(chalk.red(`Token "${tokenName}" not found. Run \`tages token generate\` to create one.`))
    process.exit(1)
  }

  const { token, hash } = generateToken()

  let expiresAt: string | null = null
  if (options.expiresIn) {
    const days = parseInt(options.expiresIn, 10)
    if (isNaN(days) || days <= 0) {
      console.error(chalk.red('--expires-in must be a positive number of days'))
      process.exit(1)
    }
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + days)
    expiresAt = expiry.toISOString()
  }

  const updatePayload: Record<string, string | null> = {
    token_hash: hash,
    expires_at: expiresAt,
  }

  const { error: updateError } = await supabase
    .from('api_tokens')
    .update(updatePayload)
    .eq('id', existing.id)

  if (updateError) {
    console.error(chalk.red(`Failed to rotate token: ${updateError.message}`))
    process.exit(1)
  }

  console.log()
  console.log(chalk.green(`  Token "${tokenName}" rotated`))
  console.log()
  console.log(chalk.bold(`  ${token}`))
  console.log()
  if (expiresAt) {
    console.log(chalk.dim(`  Expires: ${new Date(expiresAt).toLocaleDateString()}`))
  } else {
    console.log(chalk.dim('  Expiry: none (non-expiring)'))
  }
  console.log(chalk.dim('  Save this token — it cannot be shown again.'))
  console.log(chalk.dim('  Use with: tages index --token <token>'))
  console.log(chalk.dim('  Or set: CBM_API_TOKEN=<token> in CI'))
}

function loadAuth() {
  const authPath = getAuthPath()
  if (!fs.existsSync(authPath)) return null
  return JSON.parse(fs.readFileSync(authPath, 'utf-8'))
}
