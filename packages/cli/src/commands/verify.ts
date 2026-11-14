import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { assertRowsAffected } from '../lib/write-guard.js'
import { embedPromoted } from '../lib/embed-promoted.js'

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
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey, {
    action: 'verify memories',
    beforeExit: () => spinner.stop(),
  })

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

  // `.select('id')` so an RLS-filtered update (read-only member) shows up as
  // zero rows instead of a silent success.
  const updateResult = await supabase
    .from('memories')
    .update({
      status: 'live',
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', memory.id)
    .select('id')

  assertRowsAffected(updateResult, { action: 'verify memories', beforeExit: () => spinner.stop() })

  // Promoted rows staged without an embedding would be live but invisible to
  // semantic recall. Non-fatal: embedPromoted warns and never throws.
  spinner.text = `Embedding "${key}"...`
  await embedPromoted(supabase, config.projectId, [key], { supabaseUrl: config.supabaseUrl })

  spinner.succeed(
    `${chalk.green('Verified')} ${chalk.bold(key)} — now live and available in recall.`,
  )
}

