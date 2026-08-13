// Root ESLint flat config for the Tages pnpm monorepo.
//
// Scope: packages/* (server, cli, shared) and any loose root-level scripts.
// apps/dashboard has its own richer Next.js config (apps/dashboard/eslint.config.mjs)
// and is ignored here so it is linted exactly once, by `pnpm --filter dashboard lint`.
//
// ESLint major is pinned to 9.x across the repo on purpose. As of this commit the
// Next.js lint stack has no ESLint 10 support: eslint-plugin-react tops out at
// 7.37.5 (peer `eslint: ...|| ^9.7`) and typescript-eslint at 8.x (peer `^9.0.0`).
// Do not bump to ESLint 10 until both publish ESLint 10 peers.
//
// The rule set is deliberately conservative: correctness-oriented rules only, with
// the noisiest stylistic and type-strictness checks left off. Tighten incrementally.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "**/build/**",
      "**/*.d.ts",
      // Live agent worktrees contain full checkouts of this repo. Linting into
      // them double-reports every file and produces hundreds of spurious errors.
      ".claude/worktrees/**",
      ".claude/parallel/**",
      // Linted separately by its own Next.js flat config.
      "apps/dashboard/**",
      // Vendored / third-party evaluation corpus, not our source.
      "eval/**",
    ],
  },

  // Base JS recommended rules for plain .js/.mjs/.cjs files.
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  // TypeScript sources. `recommended` (not `recommended-type-checked`) keeps this
  // fast and avoids requiring a project service across four tsconfigs.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Unused vars are worth catching, but underscore-prefixed args are an
      // established intentional-discard convention in this codebase.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `any` is pervasive in the existing Supabase/MCP boundary code. Surface it
      // as a warning so it is visible without failing the build on day one.
      "@typescript-eslint/no-explicit-any": "warn",
      // TS itself already enforces this; the lint rule mostly duplicates tsc.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  // Tests may reach for looser patterns (mocks, partial fixtures).
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
