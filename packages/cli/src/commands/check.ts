import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { execSync } from 'child_process'

interface CheckOptions {
  project?: string
  fix?: boolean
}

export async function checkCommand(options: CheckOptions) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('Check requires cloud connection.'))
    process.exit(1)
  }

  const spinner = ora('Checking memories against codebase...').start()
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Get all memories with file_paths
  const { data: memories } = await supabase
    .from('memories')
    .select('*')
    .eq('project_id', config.projectId)
    .not('file_paths', 'eq', '{}')

  if (!memories || memories.length === 0) {
    spinner.info('No memories with file references to check.')
    return
  }

  // Get recently changed files from git
  let changedFiles: Set<string> = new Set()
  try {
    const diff = execSync('git diff --name-only HEAD~10 2>/dev/null || git diff --name-only', { encoding: 'utf-8' })
    changedFiles = new Set(diff.trim().split('\n').filter(Boolean))
  } catch { /* not in git or no history */ }

  const staleMemories: Array<{ id: string; key: string; reason: string }> = []
  const missingFiles: Array<{ id: string; key: string; file: string }> = []

  for (const mem of memories) {
    const filePaths = mem.file_paths as string[]
    if (!filePaths?.length) continue

    for (const fp of filePaths) {
      const fullPath = path.resolve(fp)

      // Check if file still exists
      if (!fs.existsSync(fullPath)) {
        missingFiles.push({ id: mem.id, key: mem.key, file: fp })
        staleMemories.push({
          id: mem.id,
          key: mem.key,
          reason: `Referenced file deleted: ${fp}`,
        })
        continue
      }

      // Check if file was recently changed
      if (changedFiles.has(fp)) {
        staleMemories.push({
          id: mem.id,
          key: mem.key,
          reason: `Referenced file changed in recent commits: ${fp}`,
        })
      }
    }
  }

  spinner.stop()

  if (staleMemories.length === 0 && missingFiles.length === 0) {
    console.log(chalk.green('\n  All memories are current. No staleness detected.\n'))
    return
  }

  // Report findings
  if (missingFiles.length > 0) {
    console.log(chalk.red(`\n  ${missingFiles.length} memories reference deleted files:\n`))
    for (const m of missingFiles) {
      console.log(`    ${chalk.red('DELETED')}  ${m.key} → ${chalk.dim(m.file)}`)
    }
  }

  if (staleMemories.length > 0) {
    console.log(chalk.yellow(`\n  ${staleMemories.length} potentially stale memories:\n`))
    for (const m of staleMemories) {
      console.log(`    ${chalk.yellow('STALE')}  ${m.key}`)
      console.log(`           ${chalk.dim(m.reason)}`)
    }
  }

  // Mark stale in DB if --fix
  if (options.fix) {
    const spinner2 = ora('Marking stale memories...').start()
    for (const m of staleMemories) {
      await supabase
        .from('memories')
        .update({
          stale: true,
          stale_reason: m.reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', m.id)
    }
    spinner2.succeed(`Marked ${staleMemories.length} memories as stale`)
  } else {
    console.log(chalk.dim('\n  Run with --fix to mark these as stale in the database.\n'))
  }
}

