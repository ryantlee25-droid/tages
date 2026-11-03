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

  // Build the cloud client BEFORE touching the cache: on a dead session the
  // central guard exits here, with nothing deleted anywhere.
  const supabase =
    config.supabaseUrl && config.supabaseAnonKey
      ? await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey, {
          action: 'delete a memory',
        })
      : null

  let cloudFailure: string | null = null
  const { cache, close } = await openCliSync(config)
  try {
    // Primary delete: SQLite first
    cache.deleteByKey(config.projectId, key)

    if (supabase) {
      try {
        // `.select('id')` so an RLS-filtered delete (read-only member) is
        // visible as zero rows instead of reading as success.
        const { data, error } = await supabase
          .from('memories')
          .delete()
          .eq('project_id', config.projectId)
          .eq('key', key)
          .select('id')

        if (error) {
          cloudFailure = error.message
        } else if (!Array.isArray(data) || data.length === 0) {
          // Zero rows: either the row never reached the cloud (fine) or RLS
          // hid it from the delete. Tell them apart with a read, which
          // members ARE allowed.
          const { data: still } = await supabase
            .from('memories')
            .select('id')
            .eq('project_id', config.projectId)
            .eq('key', key)
          if (Array.isArray(still) && still.length > 0) {
            cloudFailure = 'your role cannot delete memories on this project (read-only members cannot delete)'
          }
        }
      } catch (err) {
        cloudFailure = (err as Error).message
      }
    }
  } finally {
    close()
  }

  if (cloudFailure) {
    console.error(
      chalk.red(`Could not delete "${key}" from the shared store: ${cloudFailure}.`),
      chalk.dim('It was removed from your local cache only and will return on the next sync.'),
    )
    process.exit(1)
  }

  console.log(chalk.green('Deleted:'), `"${key}"`)
}
