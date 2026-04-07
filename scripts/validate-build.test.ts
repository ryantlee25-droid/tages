/**
 * Build validation tests — verify all packages build successfully
 * and that compiled outputs are runnable.
 *
 * This suite is intentionally slow (~30-60 s) because it runs pnpm build
 * and spawns real Node processes. It is meant to be run as a pre-release
 * gate, not on every commit.
 *
 * Run with:
 *   npx vitest run --config scripts/vitest.config.ts
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the monorepo root */
const ROOT = resolve(__dirname, '..');

/** packages/server/dist/index.js — declared in server package.json `main` */
const SERVER_DIST = resolve(ROOT, 'packages/server/dist/index.js');

/**
 * packages/cli/dist/packages/cli/src/index.js
 *
 * The CLI tsconfig has:
 *   outDir: "./dist"   (relative to packages/cli)
 *   rootDir: "../../"  (repo root)
 *
 * TypeScript mirrors the full path from rootDir into outDir, so a source
 * file at <root>/packages/cli/src/index.ts compiles to:
 *   <root>/packages/cli/dist/packages/cli/src/index.js
 *
 * This matches the `bin` field in packages/cli/package.json:
 *   "tages": "./dist/packages/cli/src/index.js"
 */
const CLI_DIST = resolve(ROOT, 'packages/cli/dist/packages/cli/src/index.js');

// ---------------------------------------------------------------------------
// Phase 1 — build
// ---------------------------------------------------------------------------

describe('pnpm build', () => {
  /**
   * Run pnpm build once for the entire suite.
   * Uses a 120-second timeout to accommodate slow CI machines and
   * the dashboard Next.js build included in `pnpm -r build`.
   */
  beforeAll(() => {
    execSync('pnpm build', {
      cwd: ROOT,
      timeout: 120_000,
      stdio: 'inherit',
    });
  });

  it('exits 0 (build succeeded)', () => {
    // If execSync threw, beforeAll would have failed and this would not run.
    // Reaching this line means the build exited 0.
    expect(true).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Phase 2 — dist artefacts exist
  // -------------------------------------------------------------------------

  it('packages/server/dist/index.js exists', () => {
    expect(existsSync(SERVER_DIST)).toBe(true);
  });

  it('packages/cli dist entry exists', () => {
    expect(existsSync(CLI_DIST)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Phase 3 — server smoke test
  // -------------------------------------------------------------------------

  it('server process starts and stays alive for 2 seconds', async () => {
    const cachePath = resolve(tmpdir(), `tages-validate-${Date.now()}.sqlite`);

    const proc = spawn('node', [SERVER_DIST], {
      cwd: ROOT,
      env: {
        ...process.env,
        TAGES_CACHE_PATH: cachePath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let crashed = false;
    let exitCode: number | null = null;

    proc.on('exit', (code) => {
      crashed = true;
      exitCode = code;
    });

    // Give the process 2 seconds to either crash or stay alive.
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));

    if (!crashed) {
      proc.kill('SIGTERM');
    }

    expect(crashed).toBe(false);
    if (crashed) {
      throw new Error(
        `Server process exited within 2 seconds with code ${exitCode}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Phase 4 — CLI smoke test
  // -------------------------------------------------------------------------

  it('tages CLI --version exits 0', () => {
    // The CLI is an ES module with a shebang; run it via node directly.
    const result = execSync(`node ${CLI_DIST} --version`, {
      cwd: ROOT,
      timeout: 15_000,
      // Do not throw on non-zero exit — capture it instead.
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // execSync returns stdout as a Buffer when stdio is 'pipe'.
    const output = result.toString().trim();
    // A semver string like "0.1.0" is sufficient; just verify it is non-empty.
    expect(output.length).toBeGreaterThan(0);
  });
});
