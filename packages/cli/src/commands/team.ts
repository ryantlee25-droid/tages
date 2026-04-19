import chalk from 'chalk'
import { createAuthenticatedClient } from '../auth/session.js'
import { loadProjectConfig } from '../config/project.js'
import { getAuthPath } from '../config/paths.js'
import { inviteTeamMembers } from '../auth/invite.js'
import * as fs from 'fs'

interface TeamOptions {
  project?: string
  role?: string
}

export async function teamInviteCommand(email: string, options: TeamOptions) {
  const config = loadProjectConfig(options.project)
  if (!config || !config.supabaseUrl) {
    console.error(chalk.red('Team features require cloud mode. Run `tages init` first.'))
    process.exit(1)
  }

  // M1: Validate and normalise role; default to 'member'
  const validRoles = ['owner', 'admin', 'member'] as const
  type ValidRole = typeof validRoles[number]
  const rawRole = options.role?.toLowerCase() ?? 'member'
  if (!validRoles.includes(rawRole as ValidRole)) {
    console.error(chalk.red(`  Invalid role '${options.role}'. Must be one of: owner, admin, member`))
    process.exit(1)
  }
  const role = rawRole as ValidRole

  const auth = JSON.parse(fs.readFileSync(getAuthPath(), 'utf-8'))
  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const result = await inviteTeamMembers(supabase, config.projectId, [email], auth.userId, role)

  if (result.invited.length > 0) {
    console.log(chalk.green(`  Invited ${email} as ${role} (pending)`))
  }
  for (const f of result.failed) {
    console.error(chalk.red(`  Failed to invite ${f.email}: ${f.error}`))
  }
}

export async function teamListCommand(options: TeamOptions) {
  const config = loadProjectConfig(options.project)
  if (!config || !config.supabaseUrl) {
    console.error(chalk.red('Team features require cloud mode. Run `tages init` first.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { data: members, error } = await supabase
    .from('team_members')
    .select('user_id, email, role, status, created_at')
    .eq('project_id', config.projectId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(chalk.red(`  Failed to fetch team: ${error.message}`))
    process.exit(1)
  }

  console.log(chalk.bold(`\n  Team — ${config.slug}\n`))
  if (!members || members.length === 0) {
    console.log(chalk.dim('  No team members. Run `tages team invite <email>` to add one.'))
    return
  }

  for (const m of members) {
    const name = m.email || m.user_id || 'unknown'
    const statusBadge = m.status === 'pending'
      ? chalk.yellow('pending')
      : m.status === 'revoked'
        ? chalk.red('revoked')
        : chalk.green('active')
    console.log(`  ${name}  ${chalk.dim(m.role)}  ${statusBadge}`)
  }
  console.log()
}

export async function teamRemoveCommand(emailOrId: string, options: TeamOptions) {
  const config = loadProjectConfig(options.project)
  if (!config || !config.supabaseUrl) {
    console.error(chalk.red('Team features require cloud mode. Run `tages init` first.'))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  // Soft-revoke: update status to 'revoked' instead of hard delete
  const { error } = await supabase
    .from('team_members')
    .update({ status: 'revoked' })
    .eq('project_id', config.projectId)
    .or(`email.eq.${emailOrId},user_id.eq.${emailOrId}`)

  if (error) {
    console.error(chalk.red(`  Failed to remove: ${error.message}`))
    process.exit(1)
  }

  console.log(chalk.green(`  Revoked access for ${emailOrId}`))
}

export async function teamRoleCommand(emailOrId: string, role: string, options: TeamOptions) {
  const config = loadProjectConfig(options.project)
  if (!config || !config.supabaseUrl) {
    console.error(chalk.red('Team features require cloud mode. Run `tages init` first.'))
    process.exit(1)
  }

  if (!['owner', 'admin', 'member'].includes(role)) {
    console.error(chalk.red(`  Invalid role '${role}'. Must be: owner, admin, or member`))
    process.exit(1)
  }

  const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

  const { error } = await supabase
    .from('team_members')
    .update({ role })
    .eq('project_id', config.projectId)
    .or(`email.eq.${emailOrId},user_id.eq.${emailOrId}`)

  if (error) {
    console.error(chalk.red(`  Failed to update role: ${error.message}`))
    process.exit(1)
  }

  console.log(chalk.green(`  Updated ${emailOrId} to ${role}`))
}
