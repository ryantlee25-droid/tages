import * as fs from 'fs'
import chalk from 'chalk'
import Database from 'better-sqlite3'
import { createAuthenticatedClient } from '../auth/session.js'
import { getProjectsDir, getCacheDir } from '../config/paths.js'

interface ForgetOptions {
  project?: string
}

export async function forgetCommand(key: string, options: ForgetOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('project_id', config.projectId)
      .eq('key', key)

    if (error) {
      console.error(chalk.red(`Delete failed: ${error.message}`))
      process.exit(1)
    }
  }

  // Also delete from local SQLite cache
  const dbPath = `${getCacheDir()}/${config.slug || config.projectId}.db`
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath)
    db.prepare('DELETE FROM memories WHERE project_id = ? AND key = ?').run(config.projectId, key)
    db.close()
  }

  console.log(chalk.green('Deleted:'), `"${key}"`)
}

function loadProjectConfig(slug?: string) {
  const dir = getProjectsDir()
  if (!fs.existsSync(dir)) return null
  if (slug) {
    const p = `${dir}/${slug}.json`
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  if (files.length === 0) return null
  return JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'))
}
