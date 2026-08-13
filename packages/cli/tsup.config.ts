import { builtinModules } from 'module'
import { defineConfig } from 'tsup'

/**
 * The CLI ships as a SINGLE self-contained ESM bundle at `dist/index.js`.
 *
 * Why a bundler at all — the previous `tsc` build set `rootDir: '../../'` so
 * that the CLI's cross-package imports (`../../../server/src/**`,
 * `../../../harness-claude-code/src/**`) had somewhere legal to be emitted.
 * That produced three defects that only showed up outside the monorepo, which
 * is why the test suite never caught any of them:
 *
 *   1. The sibling packages were emitted into `dist/packages/server/**` as
 *      CommonJS (TypeScript picks the module format from the SOURCE file's
 *      nearest package.json, and `@tages/server` declares no `"type"`), but
 *      they landed inside a package that declares `"type": "module"`. Node
 *      parsed them as ESM: `ReferenceError: exports is not defined`.
 *   2. `sync/cli-sync.ts` walked the filesystem for
 *      `packages/server/dist/cache/sqlite.js`, a path that exists only in a
 *      monorepo checkout, then threw `Failed to load server modules`.
 *   3. `@tages/shared` was a `workspace:*` dependency. `npm pack` leaves the
 *      protocol verbatim (EUNSUPPORTEDPROTOCOL on install) and `pnpm publish`
 *      rewrites it to a version that lags what this repo compiles against, so
 *      even a successful install got `SyntaxError: Named export
 *      'createCloudProject' not found`.
 *
 * Bundling collapses all three: every cross-package import is resolved from
 * SOURCE at build time and inlined, so the published artifact has no workspace
 * dependencies, no sibling `dist/` to find, and one module format throughout.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  clean: true,

  // Single file. Splitting would also work, but every module that could be
  // reached lazily already pulls `better-sqlite3`, which `commands/recall.ts`
  // imports statically at startup regardless — so splitting buys no deferred
  // native-module load, and one file is easier to reason about in a stack
  // trace.
  splitting: false,

  // The CLI is an application, not a library: nothing imports it as a module,
  // so `.d.ts` output is dead weight.
  dts: false,

  // Bundles are unreadable in a stack trace without this, and it is one extra
  // file rather than the ~200 the old layout shipped.
  sourcemap: true,

  // Keep the REAL `import.meta.url`. Three resolvers depend on it pointing at
  // the file's true on-disk location — `index.ts`'s `resolveCliVersion`,
  // `commands/init.ts`'s `resolveLocalServerEntrypoint` (whose absolute path
  // is written into the user's `.mcp.json`), and `commands/harness.ts`'s
  // harness-bin walk. tsup's shim rewrites it to a computed value, which would
  // silently break all three.
  shims: false,

  // Bundle the workspace packages FROM SOURCE. This is the whole point: it is
  // what removes `workspace:*` from the published manifest and what makes the
  // deep `../../../server/src/**` imports resolvable off-monorepo. Deliberately
  // NOT a real npm dependency on `@tages/server` — see the note below.
  noExternal: [/^@tages\//],

  // Everything else stays external and is installed by the consumer's package
  // manager from `dependencies`. `better-sqlite3` in particular is a native
  // addon and must never be inlined.
  /**
   * Gives the ESM bundle a working CommonJS `require`.
   *
   * esbuild turns a `require()` inside any bundled CJS module into its
   * `__require` helper, which looks for a global `require` and throws
   * `Dynamic require of "x" is not supported` when there isn't one — and in an
   * ES module there isn't. Three call sites land in this bundle, all in code
   * this package does not own:
   *
   *   - `packages/server/src/cache/sqlite.ts` (x2) — a bare `require('crypto')`
   *     inside `addVersion()`/`getVersions()`. Legal in the server's own CJS
   *     build, fatal once inlined here.
   *   - `@tages/shared`'s CJS dist — `require('@supabase/supabase-js')`.
   *
   * Without this banner those paths throw only at runtime, only on the
   * commands that reach them — exactly the failure mode this whole change is
   * meant to end. The alias on the import keeps it from colliding with the
   * `createRequire` that `commands/harness.ts` already imports.
   */
  banner: {
    js: [
      "import { createRequire as __tagesCreateRequire } from 'node:module';",
      'const require = __tagesCreateRequire(import.meta.url);',
    ].join('\n'),
  },

  // (`src/index.ts` starts with `#!/usr/bin/env node`; tsup preserves the
  // shebang and chmods the output executable, so `bin` needs no wrapper.)
  external: [
    // Native addon — inlining it is not even possible.
    'better-sqlite3',
    // esbuild's own builtin list misses the subpath builtins (`readline/promises`,
    // `fs/promises`, `timers/promises`, ...), so a bare `platform: 'node'` fails
    // to resolve them. Feed it the running Node's real list, both bare and
    // `node:`-prefixed, so this keeps working as Node adds more.
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
})
