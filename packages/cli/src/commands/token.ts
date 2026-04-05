import * as fs from 'fs'
import chalk from 'chalk'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir, getAuthPath } from '../config/paths.js'
import { generateToken } from '../auth/token-auth.js'

interface TokenOptions {
  name?: string
  project?: string
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
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

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

  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)
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

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}

function loadAuth() {
  const authPath = getAuthPath()
  if (!fs.existsSync(authPath)) return null
  return JSON.parse(fs.readFileSync(authPath, 'utf-8'))
}
