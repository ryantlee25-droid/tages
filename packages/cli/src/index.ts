#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { rememberCommand } from './commands/remember.js'
import { recallCommand } from './commands/recall.js'
import { forgetCommand } from './commands/forget.js'
import { statusCommand } from './commands/status.js'
import { dashboardCommand } from './commands/dashboard.js'
import { indexCommand } from './commands/index.js'
import { importCommand } from './commands/import.js'
import { queryCommand } from './commands/query.js'
import { tokenGenerateCommand, tokenListCommand } from './commands/token.js'

const program = new Command()

program
  .name('tages')
  .description('Persistent codebase memory for AI coding agents')
  .version('0.1.0')

program
  .command('init')
  .description('Initialize tages for the current project')
  .option('--local', 'Local-only mode (no cloud sync)')
  .option('--slug <slug>', 'Project slug (defaults to directory name)')
  .action(initCommand)

program
  .command('remember')
  .description('Store a memory about this codebase')
  .argument('<key>', 'A short, descriptive key')
  .argument('<value>', 'The memory content')
  .option('-t, --type <type>', 'Memory type', 'convention')
  .option('-p, --project <slug>', 'Project slug')
  .option('--file-paths <paths...>', 'Related file paths')
  .option('--tags <tags...>', 'Tags for categorization')
  .action(rememberCommand)

program
  .command('recall')
  .description('Search codebase memories')
  .argument('<query>', 'Search query')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --limit <n>', 'Max results', '5')
  .option('-p, --project <slug>', 'Project slug')
  .action(recallCommand)

program
  .command('forget')
  .description('Delete a memory by key')
  .argument('<key>', 'The key to delete')
  .option('-p, --project <slug>', 'Project slug')
  .action(forgetCommand)

program
  .command('status')
  .description('Show project memory status')
  .option('-p, --project <slug>', 'Project slug')
  .action(statusCommand)

program
  .command('dashboard')
  .description('Open the dashboard in your browser')
  .option('-p, --project <slug>', 'Project slug')
  .action(dashboardCommand)

program
  .command('index')
  .description('Index recent commits into codebase memory')
  .option('--since <date>', 'Index commits since date (e.g. "3 days")')
  .option('--last-commit', 'Index only the last commit')
  .option('--install', 'Install git post-commit hook')
  .option('-p, --project <slug>', 'Project slug')
  .action(indexCommand)

program
  .command('query')
  .description('Ask a question about your codebase using stored memories')
  .argument('<question>', 'Natural language question')
  .option('-p, --project <slug>', 'Project slug')
  .action(queryCommand)

program
  .command('import')
  .description('Import memories from existing files')
  .argument('<format>', 'File format: claude-md, architecture-md, lessons-md')
  .argument('<path>', 'Path to the file')
  .option('-p, --project <slug>', 'Project slug')
  .action(importCommand)

const tokenCmd = program
  .command('token')
  .description('Manage API tokens for CI/CD')

tokenCmd
  .command('generate')
  .description('Generate a new API token')
  .option('-n, --name <name>', 'Token name', 'default')
  .option('-p, --project <slug>', 'Project slug')
  .action(tokenGenerateCommand)

tokenCmd
  .command('list')
  .description('List API tokens')
  .option('-p, --project <slug>', 'Project slug')
  .action(tokenListCommand)

program.parse()
