import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { createAuthenticatedClient } from '../auth/session.js'
import type { Memory, MemoryType } from '@tages/shared'
import { loadProjectConfig } from '../config/project.js'
import { analyzeDiff, detectMode, getGitDiff, getCommitsSince } from '../indexer/diff-analyzer.js'
import { installPostCommitHook } from '../indexer/install-hook.js'

interface IndexOptions {
  since?: string
  lastCommit?: boolean
  install?: boolean
  project?: string
}

export async function indexCommand(options: IndexOptions) {
  if (options.install) {
    const result = installPostCommitHook()
    if (result.installed) {
      console.log(chalk.green('  Hook installed:'), result.path)
    } else {
      console.error(chalk.red('  Failed to install hook — not in a git repository'))
    }
    return
  }

  const config = loadProjectConfig(options.project)
  if (!config) {
    console.error(chalk.red('No project configured. Run `tages init` first.'))
    process.exit(1)
  }

  const spinner = ora()
  const mode = await detectMode()
  spinner.info(`Using ${mode} mode for analysis`)

  let allMemories: Array<{ key: string; value: string; type: string; files_affected: string[] }> = []

  if (options.lastCommit) {
    // Index just the last commit
    spinner.start('Analyzing last commit...')
    const { diff, stat } = getGitDiff('HEAD~1')
    if (!stat.trim()) {
      spinner.info('No changes to index')
      return
    }
    allMemories = await analyzeDiff(diff, stat, mode)
  } else if (options.since) {
    // Replay commits since a date
    spinner.start(`Finding commits since ${options.since}...`)
    const commits = getCommitsSince(options.since)
    spinner.info(`Found ${commits.length} commits`)

    for (const sha of commits) {
      spinner.start(`Analyzing ${sha.slice(0, 8)}...`)
      const { diff, stat } = getGitDiff(`${sha}~1..${sha}`)
      const extracted = await analyzeDiff(diff, stat, mode)
      allMemories.push(...extracted)
    }
  } else {
    // Default: index last commit
    spinner.start('Analyzing last commit...')
    const { diff, stat } = getGitDiff('HEAD~1')
    if (!stat.trim()) {
      spinner.info('No changes to index')
      return
    }
    allMemories = await analyzeDiff(diff, stat, mode)
  }

  if (allMemories.length === 0) {
    spinner.info('No memories extracted')
    return
  }

  spinner.start(`Storing ${allMemories.length} memories...`)

  if (config.supabaseUrl && config.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)
    const now = new Date().toISOString()

    for (const mem of allMemories) {
      const memory: Memory = {
        id: randomUUID(),
        projectId: config.projectId,
        key: mem.key,
        value: mem.value,
        type: mem.type as MemoryType,
        source: 'auto_index',
        status: 'live',
        filePaths: mem.files_affected || [],
        tags: [],
        confidence: 0.7,
        createdAt: now,
        updatedAt: now,
      }

      await supabase.from('memories').upsert({
        project_id: memory.projectId,
        key: memory.key,
        value: memory.value,
        type: memory.type,
        source: memory.source,
        file_paths: memory.filePaths,
        tags: memory.tags,
        confidence: memory.confidence,
      }, { onConflict: 'project_id,key', ignoreDuplicates: false })
    }
  }

  spinner.succeed(`Indexed ${allMemories.length} memories (${mode} mode)`)

  for (const mem of allMemories) {
    console.log(`  ${chalk.dim(mem.type.padEnd(14))} ${mem.key}`)
  }
}

