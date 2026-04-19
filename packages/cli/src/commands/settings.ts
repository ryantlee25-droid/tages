import chalk from 'chalk'
import ora from 'ora'
import * as readline from 'readline'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'

interface SettingsAutoSaveOptions {
  project?: string
  yes?: boolean
}

/**
 * `tages settings auto-save [threshold]`
 *
 * Sets (or reads) projects.auto_save_threshold for the current project.
 * - `tages settings auto-save 0.85`  → enable auto-save at 85% confidence
 * - `tages settings auto-save off`   → disable (set to NULL)
 * - `tages settings auto-save`       → print current value with guidance
 */
export async function settingsAutoSaveCommand(
  threshold: string | undefined,
  options: SettingsAutoSaveOptions,
) {
  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.error(chalk.red('settings auto-save requires a cloud connection.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Read-only mode: no argument provided
  if (threshold === undefined) {
    const spinner = ora('Loading auto-save settings...').start()
    const { data, error } = await Promise.resolve(
      supabase
        .from('projects')
        .select('auto_save_threshold, name')
        .eq('id', config.projectId)
        .single()
    )
    spinner.stop()

    if (error) {
      console.error(chalk.red(`Failed to load project settings: ${error.message}`))
      process.exit(1)
    }

    const current = data?.auto_save_threshold
    const projectName = data?.name || config.slug

    if (current == null) {
      console.log(`\n  ${chalk.bold('Auto-save:')} ${chalk.dim('off')} (memories require manual review)`)
    } else {
      console.log(`\n  ${chalk.bold('Auto-save:')} ${chalk.green(`${Math.round(current * 100)}%`)} confidence threshold`)
      console.log(`  ${chalk.dim(`Pending memories with confidence >= ${current} are promoted to live automatically.`)}`)
    }
    console.log()
    console.log(`  ${chalk.dim('To enable:')}  ${chalk.white(`tages settings auto-save 0.85`)}`)
    console.log(`  ${chalk.dim('To disable:')} ${chalk.white(`tages settings auto-save off`)}`)
    console.log(`  ${chalk.dim('Project:')}    ${projectName}`)
    console.log()
    return
  }

  // Parse the threshold value
  let newThreshold: number | null

  if (threshold.toLowerCase() === 'off') {
    newThreshold = null
  } else {
    const parsed = parseFloat(threshold)
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      console.error(chalk.red(`Invalid threshold "${threshold}". Provide a number between 0.0 and 1.0, or "off".`))
      process.exit(1)
    }
    newThreshold = parsed
  }

  // Fetch project name for the confirmation prompt
  const { data: projectData } = await Promise.resolve(
    supabase
      .from('projects')
      .select('name')
      .eq('id', config.projectId)
      .single()
  )
  const projectName = projectData?.name || config.slug

  // Confirmation prompt (skip with --yes)
  if (!options.yes) {
    if (newThreshold === null) {
      console.log()
      console.log(`  Disable auto-save for project ${chalk.bold(projectName)}?`)
      console.log(`  ${chalk.dim('Pending memories will require manual review via `tages pending`.')}`)
      console.log()
    } else {
      const pct = Math.round(newThreshold * 100)
      console.log()
      console.log(`  Enable auto-save for project ${chalk.bold(projectName)} at threshold ${chalk.green(`${pct}%`)}?`)
      console.log(`  ${chalk.dim(`Memories with confidence >= ${newThreshold} will be promoted to live automatically without review.`)}`)
      if (newThreshold <= 0.7) {
        console.log(`  ${chalk.yellow('Warning:')} threshold ${newThreshold} <= 0.7 will auto-approve all observe() memories (confidence=0.7).`)
      }
      console.log()
    }

    const confirmed = await promptYesNo('  Continue? [y/N] ')
    if (!confirmed) {
      console.log(chalk.dim('  Cancelled.'))
      return
    }
  }

  const spinner = ora('Updating auto-save threshold...').start()

  const { error } = await Promise.resolve(
    supabase
      .from('projects')
      .update({ auto_save_threshold: newThreshold, updated_at: new Date().toISOString() })
      .eq('id', config.projectId)
  )

  if (error) {
    spinner.fail(`Failed to update auto-save threshold: ${error.message}`)
    process.exit(1)
  }

  if (newThreshold === null) {
    spinner.succeed(`Auto-save ${chalk.bold('disabled')} for ${chalk.bold(projectName)}.`)
    console.log(`  ${chalk.dim('Memories will require manual review via `tages pending`.')}`)
  } else {
    const pct = Math.round(newThreshold * 100)
    spinner.succeed(`Auto-save set to ${chalk.green(`${pct}%`)} for ${chalk.bold(projectName)}.`)
    console.log(`  ${chalk.dim(`Pending memories with confidence >= ${newThreshold} will be promoted automatically.`)}`)
    console.log(`  ${chalk.dim('Run `tages pending` to review memories below the threshold.')}`)
  }
  console.log()
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}
