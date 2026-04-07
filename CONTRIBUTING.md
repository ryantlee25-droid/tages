# Contributing to Tages

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/ryantlee25-droid/tages.git
cd tages
pnpm install
pnpm build
pnpm test
```

## Architecture

| Directory | Purpose |
|-----------|---------|
| `packages/server/` | MCP server (stdio transport, 56 tools) |
| `packages/cli/` | CLI tool (commander.js, 52 commands) |
| `packages/shared/` | Shared types + Supabase client factory |
| `apps/dashboard/` | Next.js 16 web dashboard |
| `supabase/migrations/` | Postgres schema (42 migrations) |

## Code Standards

- TypeScript strict mode everywhere
- No `any` types
- ESM only (no `require()`)
- Vitest for testing
- Zod for input validation on all MCP tools
- Supabase returns PromiseLike, not Promise -- wrap with `Promise.resolve()` for `.catch()`

## Testing

```bash
pnpm test                             # all tests (521 total)
pnpm --filter @tages/server test      # server only (445 tests)
pnpm typecheck                        # type checking
```

## Pull Requests

1. Create a feature branch from `main`
2. Include tests for new functionality
3. Run `pnpm test && pnpm typecheck` before submitting
4. Keep PRs focused -- one feature or fix per PR

## Adding a New MCP Tool

1. Add Zod schema in `packages/server/src/schemas.ts`
2. Create handler in `packages/server/src/tools/<name>.ts`
3. Register in `packages/server/src/index.ts` with `server.tool()`
4. Add tests in `packages/server/src/__tests__/<name>.test.ts`

## Adding a New CLI Command

1. Create command in `packages/cli/src/commands/<name>.ts`
2. Register in `packages/cli/src/index.ts`
3. Use `loadProjectConfig()` from `../config/project.js`
4. Use `createAuthenticatedClient()` for Supabase access

## Reporting Issues

Use [GitHub Issues](https://github.com/ryantlee25-droid/tages/issues). Include steps to reproduce, expected vs actual behavior, and your Tages + Node.js versions.
