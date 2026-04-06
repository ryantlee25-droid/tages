import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

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
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

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

