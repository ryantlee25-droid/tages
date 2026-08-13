import { defineConfig } from 'vitest/config'

/**
 * Root vitest config.
 *
 * This does NOT drive `pnpm -r test`. Each workspace package runs `vitest run`
 * from its own directory and resolves its own `vitest.config.ts`; vite does not
 * walk up to a parent config. This file exists solely so that a bare `vitest`
 * invocation from the repo root is safe.
 *
 * Without it, root-level discovery picks up:
 *   - compiled `dist/**` copies of tests, running every suite twice
 *   - stale test files inside `.claude/worktrees/**` from live parallel agents,
 *     which fail with module-resolution errors against another branch's deps
 *   - `eval/**`, which is not part of the pnpm workspace (see pnpm-workspace.yaml,
 *     which globs only `packages/*` and `apps/*`), so its deps are never
 *     installed and it fails with `Cannot find package 'openai'`
 *
 * Patterns are `**\/`-prefixed because excludes resolve relative to this root,
 * and the paths being excluded are nested inside workspace packages.
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.claude/worktrees/**',
      '**/.claude/parallel/**',
      // `.claire/` is a leftover from an earlier tool name. It is untracked and
      // holds stale, empty test stubs that fail with `ReferenceError: placeholder
      // is not defined`. Verified present in the main checkout; it is invisible
      // from inside a worktree, which is why the `.claude`-only exclude looked
      // complete when it was not.
      '**/.claire/**',
      'eval/**',
    ],
  },
})
