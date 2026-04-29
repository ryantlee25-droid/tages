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
import { tokenGenerateCommand, tokenListCommand, tokenRotateCommand } from './commands/token.js'
import { snapshotCommand } from './commands/snapshot.js'
import { checkCommand } from './commands/check.js'
import { patternsDetectCommand, patternsPromoteCommand, patternsListCommand } from './commands/patterns.js'
import { onboardCommand } from './commands/onboard.js'
import { exportCommand } from './commands/export.js'
import { pendingCommand } from './commands/pending.js'
import { verifyCommand } from './commands/verify.js'
import { recallContextCommand } from './commands/recall-context.js'
import { suggestCommand } from './commands/suggest.js'
import { importMemoriesCommand } from './commands/import-memories.js'
import { doctorCommand } from './commands/doctor.js'
import { dedupCommand } from './commands/dedup.js'
import { impactCommand, riskCommand } from './commands/impact.js'
import { enforceCommand, enforceCheckCommand } from './commands/enforce.js'
import { qualityCommand } from './commands/quality.js'
import { templatesListCommand, templatesMatchCommand, templatesApplyCommand } from './commands/templates-cmd.js'
import { archiveListCommand, archiveStatsCommand } from './commands/archive.js'
import { federateCommand, federationListCommand, federationImportCommand, federationOverridesCommand } from './commands/federation-cmd.js'
import { analyticsSummaryCommand, analyticsSessionCommand, analyticsTrendsCommand } from './commands/analytics.js'
import { linkCommand } from './commands/link.js'
import { migrateCommand } from './commands/migrate.js'
import { sessionWrapCommand } from './commands/session-wrap.js'
import { briefCommand } from './commands/brief.js'
import { auditCommand } from './commands/audit.js'
import { sharpenCommand } from './commands/sharpen.js'
import { teamInviteCommand, teamListCommand, teamRemoveCommand, teamRoleCommand } from './commands/team.js'
import { settingsAutoSaveCommand } from './commands/settings.js'
import { agentsMdWriteCommand, agentsMdAuditCommand, agentsMdDiffCommand, agentsMdFederateCommand } from './commands/agents-md.js'
import { driftCommand } from './commands/drift.js'

const program = new Command()

program
  .name('tages')
  .description('Persistent codebase memory for AI coding agents')
  .version('0.2.0')

program
  .command('init')
  .description('Initialize tages for the current project')
  .option('--local', 'Local-only mode (no cloud sync, no auth)')
  .option('--cloud', 'Cloud mode with OAuth (default; kept for backward compat)')
  .option('--team', 'Cloud mode with team member invites')
  .option('--slug <slug>', 'Project slug (defaults to directory name)')
  .action(initCommand)

program
  .command('link [slug]')
  .description('Link this directory to a registered project (writes .tages/config.json)')
  .action(linkCommand)

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
  .argument('[query]', 'Search query (use "*" or --all to list all)')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --limit <n>', 'Max results', '5')
  .option('-p, --project <slug>', 'Project slug')
  .option('-a, --all', 'List all memories (no search filter)')
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
  .command('doctor')
  .description('Health check: verify MCP connection, database, git hooks')
  .option('-p, --project <slug>', 'Project slug')
  .action(doctorCommand)

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
  .description('Import memories from a JSON or Markdown file with duplicate handling')
  .argument('<file>', 'Path to the file (.json or .md)')
  .option('-f, --format <format>', 'Format: json, markdown, auto', 'auto')
  .option('-s, --strategy <strategy>', 'Duplicate strategy: skip, overwrite, merge', 'skip')
  .option('-p, --project <slug>', 'Project slug')
  .action(importMemoriesCommand)

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

tokenCmd
  .command('rotate')
  .description('Rotate an API token (generates a new token, invalidates the old one)')
  .option('-n, --name <name>', 'Token name to rotate', 'default')
  .option('--expires-in <days>', 'Set expiry in days from now (omit for non-expiring)')
  .option('-p, --project <slug>', 'Project slug')
  .action(tokenRotateCommand)

program
  .command('snapshot')
  .description('Generate an architecture snapshot from the codebase')
  .option('-p, --project <slug>', 'Project slug')
  .option('-d, --dir <path>', 'Directory to scan (defaults to cwd)')
  .action(snapshotCommand)

program
  .command('check')
  .description('Check memories against codebase — find stale or invalidated entries')
  .option('-p, --project <slug>', 'Project slug')
  .option('--fix', 'Mark stale memories in the database')
  .action(checkCommand)

program
  .command('onboard')
  .description('Get a structured project briefing from stored memories')
  .option('-p, --project <slug>', 'Project slug')
  .action(onboardCommand)

program
  .command('export')
  .description('Export memories as markdown files (CLAUDE.md, ARCHITECTURE.md, or JSON)')
  .option('-p, --project <slug>', 'Project slug')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Format: claude-md, architecture-md, json', 'claude-md')
  .action(exportCommand)

program
  .command('pending')
  .description('List auto-extracted memories pending verification')
  .option('-p, --project <slug>', 'Project slug')
  .option('--approve-all', 'Approve all pending memories (promote to live)')
  .option('--reject-all', 'Archive all pending memories (mark as archived, not deleted)')
  .option('--min-confidence <float>', 'Filter to memories with confidence >= float (e.g. 0.8)')
  .option('--session <id>', 'Filter to memories from a specific session')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--stats', 'Show a summary of pending memories by confidence and session')
  .action(pendingCommand)

program
  .command('verify')
  .description('Promote a pending memory to live')
  .argument('<key>', 'The memory key to verify')
  .option('-p, --project <slug>', 'Project slug')
  .action(verifyCommand)

program
  .command('recall-context')
  .description('Recall memories filtered by current git context (changed files, branch, phase)')
  .argument('<query>', 'Search query')
  .option('--agent <name>', 'Filter by agent name')
  .option('--phase <phase>', 'Filter by phase (e.g. planning, implementation, review)')
  .option('-l, --limit <n>', 'Max results', '5')
  .option('-p, --project <slug>', 'Project slug')
  .action(recallContextCommand)

program
  .command('suggest')
  .description('Get suggestions for memories you should store based on recall misses')
  .option('-l, --limit <n>', 'Max suggestions', '10')
  .option('-p, --project <slug>', 'Project slug')
  .action(suggestCommand)


const patternsCmd = program
  .command('patterns')
  .description('Cross-project pattern library')

patternsCmd
  .command('detect')
  .description('Find conventions shared across multiple projects')
  .option('-p, --project <slug>', 'Project slug')
  .action(patternsDetectCommand)

patternsCmd
  .command('promote')
  .description('Promote a memory to your pattern library')
  .argument('<key>', 'Memory key to promote')
  .option('-p, --project <slug>', 'Project slug')
  .action(patternsPromoteCommand)

patternsCmd
  .command('list')
  .description('List your pattern library')
  .option('-p, --project <slug>', 'Project slug')
  .action(patternsListCommand)

// XL1 — Deduplication
program
  .command('dedup')
  .description('Detect near-duplicate memories and suggest merges')
  .option('-t, --threshold <n>', 'Similarity threshold 0-1 (default 0.7)', '0.7')
  .option('-p, --project <slug>', 'Project slug')
  .action(dedupCommand)

// XL2 — Impact analysis
program
  .command('impact')
  .description('Show the downstream impact of a memory')
  .argument('<key>', 'Memory key to analyze')
  .option('-p, --project <slug>', 'Project slug')
  .action(impactCommand)

program
  .command('risk')
  .description('Show top 10 riskiest memories to change')
  .option('-p, --project <slug>', 'Project slug')
  .action(riskCommand)

// XL3 — Convention enforcement
const enforceCmd = program
  .command('enforce')
  .description('Convention enforcement')
  .option('-p, --project <slug>', 'Project slug')
  .action(enforceCommand)

enforceCmd
  .command('check')
  .description('Check a memory against all conventions')
  .argument('<key>', 'Memory key to check')
  .option('-p, --project <slug>', 'Project slug')
  .action(enforceCheckCommand)

// XL4 — Quality scoring
program
  .command('quality')
  .description('Show memory quality score or project health')
  .argument('[key]', 'Memory key (omit for project health)')
  .option('-p, --project <slug>', 'Project slug')
  .action(qualityCommand)

// XL5 — Templates
const templatesCmd = program
  .command('templates')
  .description('Memory templates')

templatesCmd
  .command('list')
  .description('List available memory templates')
  .option('-p, --project <slug>', 'Project slug')
  .action(templatesListCommand)

templatesCmd
  .command('match')
  .description('Find templates matching a file path')
  .argument('<file>', 'File path to match')
  .option('-p, --project <slug>', 'Project slug')
  .action(templatesMatchCommand)

templatesCmd
  .command('apply')
  .description('Show how to apply a template')
  .argument('<name>', 'Template ID')
  .option('-p, --project <slug>', 'Project slug')
  .action(templatesApplyCommand)

// XL6 — Archive
const archiveCmd = program
  .command('archive')
  .description('Memory archival operations')

archiveCmd
  .command('list')
  .description('List archived memories')
  .option('-p, --project <slug>', 'Project slug')
  .action(archiveListCommand)

archiveCmd
  .command('stats')
  .description('Archive statistics')
  .option('-p, --project <slug>', 'Project slug')
  .action(archiveStatsCommand)

// XL7 — Federation
program
  .command('federate')
  .description('Promote a memory to the shared federated library')
  .argument('<key>', 'Memory key to federate')
  .option('-p, --project <slug>', 'Project slug')
  .action(federateCommand)

const federationCmd = program
  .command('federation')
  .description('Federated memory library')

federationCmd
  .command('list')
  .description('List federated memories')
  .option('-p, --project <slug>', 'Project slug')
  .action(federationListCommand)

federationCmd
  .command('import')
  .description('Import a federated memory')
  .argument('<key>', 'Federated memory key')
  .option('-p, --project <slug>', 'Project slug')
  .action(federationImportCommand)

federationCmd
  .command('overrides')
  .description('Show local overrides of federated memories')
  .option('-p, --project <slug>', 'Project slug')
  .action(federationOverridesCommand)

// XL8 — Analytics
const analyticsCmd = program
  .command('analytics')
  .description('Agent behavior analytics')
  .option('-p, --project <slug>', 'Project slug')
  .action(analyticsSummaryCommand)

analyticsCmd
  .command('session')
  .description('Replay a session timeline')
  .argument('<id>', 'Session ID')
  .option('-p, --project <slug>', 'Project slug')
  .action(analyticsSessionCommand)

analyticsCmd
  .command('trends')
  .description('Show performance trends')
  .option('--agent <name>', 'Filter by agent name')
  .option('-p, --project <slug>', 'Project slug')
  .action(analyticsTrendsCommand)

program
  .command('migrate')
  .description('Migrate a local-only project to cloud mode')
  .option('-p, --project <slug>', 'Project slug')
  .action(migrateCommand)

program
  .command('brief')
  .description('Generate a cached project brief for system prompt injection. Skips regeneration if the local file is fresh and no git changes detected.')
  .option('-p, --project <slug>', 'Project slug')
  .option('-t, --task <description>', 'Current task description (prioritizes relevant memories)')
  .option('-b, --budget <tokens>', 'Max estimated tokens (default 3000)')
  .option('-o, --output <path>', 'Output file path (default .tages/brief.md)')
  .option('-f, --force', 'Force regeneration even if cached brief is fresh')
  .option('--check', 'Check mode: output file path for hook consumption')
  .action(briefCommand)

// Memory Quality Flywheel
program
  .command('audit')
  .description('Audit project memory coverage: type distribution, brief-critical gaps, and imperative phrasing ratio')
  .option('-p, --project <slug>', 'Project slug')
  .option('--json', 'Output raw AuditResult JSON')
  .action(auditCommand)

program
  .command('sharpen')
  .description('Rewrite a memory (or all candidates) into imperative form using Claude Haiku')
  .argument('[key]', 'Memory key to sharpen (omit with --all to sharpen all candidates)')
  .option('-p, --project <slug>', 'Project slug')
  .option('--all', 'Sharpen all un-sharpened convention/anti_pattern/lesson memories')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(sharpenCommand)

program
  .command('session-wrap')
  .description('End-of-session wrap-up: extract and persist codebase learnings')
  .option('--non-interactive', 'Read from pending-session-notes.txt (for hooks)')
  .option('--summary <text>', 'Provide summary directly (skip interactive prompt)')
  .option('--refresh-brief', 'Delete cached brief after extraction so next `tages brief` regenerates')
  .option('-p, --project <slug>', 'Project slug')
  .action(sessionWrapCommand)

const teamCmd = program
  .command('team')
  .description('Manage team members')

teamCmd
  .command('invite <email>')
  .description('Invite a user to the project')
  .option('-p, --project <slug>', 'Project slug')
  .option('-r, --role <role>', 'Role: member or admin', 'member')
  .action(teamInviteCommand)

teamCmd
  .command('list')
  .description('List team members and pending invites')
  .option('-p, --project <slug>', 'Project slug')
  .action(teamListCommand)

teamCmd
  .command('remove <email-or-id>')
  .description('Revoke a team member or pending invite')
  .option('-p, --project <slug>', 'Project slug')
  .action(teamRemoveCommand)

teamCmd
  .command('role <email-or-id> <role>')
  .description('Change a team member role (owner, admin, member)')
  .option('-p, --project <slug>', 'Project slug')
  .action(teamRoleCommand)

// Settings
const settingsCmd = program
  .command('settings')
  .description('Project settings and configuration')

settingsCmd
  .command('auto-save [threshold]')
  .description('Get or set the auto-save confidence threshold (0.0–1.0 or "off")')
  .option('-p, --project <slug>', 'Project slug')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(settingsAutoSaveCommand)

// AGENTS.md — write and audit the canonical AGENTS.md file from project memory.
const agentsMdCmd = program
  .command('agents-md')
  .description('Generate and audit AGENTS.md from the project memory graph')

agentsMdCmd
  .command('write')
  .description('Generate AGENTS.md from project memories (6 canonical sections)')
  .option('-p, --project <slug>', 'Project slug')
  .option('-o, --output <path>', 'Output path (default: AGENTS.md in cwd)')
  .option('--dry-run', 'Print to stdout instead of writing')
  .option('--force', 'Overwrite an existing AGENTS.md')
  .action(agentsMdWriteCommand)

agentsMdCmd
  .command('audit [path]')
  .description('Lint an AGENTS.md file for vagueness, missing sections, and anti-patterns')
  .option('--json', 'Emit machine-readable report')
  .action((filePath: string | undefined, opts: { json?: boolean }) =>
    agentsMdAuditCommand({ path: filePath, json: opts.json }),
  )

agentsMdCmd
  .command('diff')
  .description('Compare committed AGENTS.md against live Tages memory — reports stale, missing, and contradicting drift')
  .option('-p, --project <slug>', 'Project slug')
  .option('-f, --file <path>', 'Path to AGENTS.md (default: AGENTS.md in cwd)')
  .option('--json', 'Emit machine-readable diff report')
  .action(agentsMdDiffCommand)

agentsMdCmd
  .command('federate')
  .description('Manage .tages/agents-md-owners.json — map section names to team slugs')
  .option('--section <name>', 'Section name to set or remove')
  .option('--team <slug>', 'Team slug to assign to the section')
  .option('--list', 'Print the current owner map')
  .option('--remove', 'Remove the mapping for --section')
  .action(agentsMdFederateCommand)

// Experimental — Agent Stability Index
program
  .command('drift')
  .description('Report memory drift across sessions and agents (experimental)')
  .option('-p, --project <slug>', 'Project slug')
  .option('--since <window>', 'Time window (e.g. 7d, 30d, or ISO timestamp)')
  .option(
    '--baseline-since <window>',
    'Behavioral drift: explicit baseline window start (e.g. 14d, ISO). Pair with --current-since.',
  )
  .option(
    '--current-since <window>',
    'Behavioral drift: explicit current window start (e.g. 7d, ISO). Pair with --baseline-since.',
  )
  .option('--agent <name>', 'Filter to a single agent_name')
  .option('--limit <n>', 'Max top-diverging keys to show (default 10)', '10')
  .option('--json', 'Emit the full report as JSON instead of human-readable output')
  .action(driftCommand)

program.parse()
