import chalk from 'chalk'

/**
 * Fail loudly when an RLS-filtered write changed fewer rows than it should have.
 *
 * Postgres RLS does not reject an UPDATE or DELETE the caller is not allowed to
 * make: it silently filters the target rows out, so the statement succeeds
 * with zero rows changed and no error. Without `.select()` and a row-count
 * check, a read-only member running `tages verify` saw "Verified" and nothing
 * had changed. Every user-facing update/delete in the CLI chains
 * `.select('id')` and passes the result here.
 *
 * - `error`            -> "Failed to <action>: <message>", exit 1
 * - zero rows          -> permission-denied message, exit 1
 * - fewer than expected -> "Only N of M ..." message, exit 1
 *
 * @param ctx.action  verb phrase, e.g. "verify memories", "approve memories".
 * @param ctx.expected  number of rows that should change. Default: at least 1.
 * @param ctx.beforeExit  runs right before the message prints (stop a spinner).
 */
export function assertRowsAffected(
  result: { data: unknown[] | null; error: { message: string } | null },
  ctx: { action: string; expected?: number; beforeExit?: () => void },
): void {
  if (result.error) {
    ctx.beforeExit?.()
    console.error(chalk.red(`Failed to ${ctx.action}: ${result.error.message}`))
    process.exit(1)
  }

  const changed = Array.isArray(result.data) ? result.data.length : 0
  const expected = ctx.expected ?? 1

  if (changed === 0) {
    ctx.beforeExit?.()
    console.error(chalk.red(permissionDeniedMessage(ctx.action)))
    process.exit(1)
  }

  if (changed < expected) {
    ctx.beforeExit?.()
    console.error(
      chalk.red(
        `Only ${changed} of ${expected} changed: your role cannot ${ctx.action} for the rest ` +
          '(read-only members cannot verify, approve, or change settings).',
      ),
    )
    process.exit(1)
  }
}

export function permissionDeniedMessage(action: string): string {
  return (
    `Permission denied: your role cannot ${action} on this project ` +
    '(read-only members cannot verify, approve, or change settings). Nothing was changed.'
  )
}
