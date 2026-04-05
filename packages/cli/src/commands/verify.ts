import * as fs from 'fs'
import chalk from 'chalk'
import ora from 'ora'
import { createSupabaseClient } from '@tages/shared'
import { getProjectsDir } from '../config/paths.js'

interface VerifyOptions {
  project?: string
}

export async function verifyCommand(key: string, options: VerifyOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('verify requires cloud connection.'))
    process.exit(1)
  }

  const spinner = ora(`Verifying "${key}"...`).start()
  const supabase = createSupabaseClient(config.supabaseUrl, config.supabaseAnonKey)

  // Find the memory
  const { data: memory, error: fetchError } = await supabase
    .from('memories')
    .select('id, key, type, status')
    .eq('project_id', config.projectId)
    .eq('key', key)
    .single()

  if (fetchError || !memory) {
    spinner.fail(`No memory found with key "${key}".`)
    process.exit(1)
  }

  if (memory.status === 'live') {
    spinner.info(`Memory "${key}" is already live.`)
    return
  }

  if (memory.status !== 'pending') {
    spinner.fail(`Memory "${key}" has unexpected status: ${memory.status}`)
    process.exit(1)
  }

  const { error: updateError } = await supabase
    .from('memories')
    .update({
      status: 'live',
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', memory.id)

  if (updateError) {
    spinner.fail(`Failed to verify memory: ${updateError.message}`)
    process.exit(1)
  }

  spinner.succeed(
    `${chalk.green('Verified')} ${chalk.bold(key)} — now live and available in recall.`,
  )
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
