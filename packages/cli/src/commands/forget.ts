import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { openCliSync } from '../sync/cli-sync.js'

interface ForgetOptions {
  project?: string
}

export async function forgetCommand(key: string, options: ForgetOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const { cache, close } = await openCliSync(config)
  try {
    // Primary delete: SQLite first
    cache.deleteByKey(config.projectId, key)

    // Best-effort cloud delete — never fatal
    if (config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
        const { error } = await supabase
          .from('memories')
          .delete()
          .eq('project_id', config.projectId)
          .eq('key', key)

        if (error) {
          console.error(chalk.dim(`[tages] Cloud delete warning: ${error.message}`))
        }
      } catch (err) {
        console.error(chalk.dim(`[tages] Cloud delete warning: ${(err as Error).message}`))
      }
    }
  } finally {
    close()
  }

  console.log(chalk.green('Deleted:'), `"${key}"`)
}

