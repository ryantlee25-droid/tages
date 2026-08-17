// Resolve the CLI and MCP server entrypoints the suite will execute.
//
// Two modes, because they fail differently:
//
//   npm   — installs the published tarballs into a throwaway prefix. This is
//           what a teammate gets from `npm i -g @tages/cli`, and it is the only
//           mode that can catch a packaging defect (missing `files` entry,
//           CJS/ESM interop, a `bin` pointing at a path the tarball omits).
//   local — runs this working tree's `dist/`. Fast, and what you want while
//           changing code, but structurally blind to packaging.
//
// Default is npm: on release day the question is whether what the team can
// install works, not whether the source tree does.

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export function repoRoot() {
  return REPO_ROOT
}

/** The version the working tree would publish, used to flag tree/registry drift. */
export function localCliVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', 'cli', 'package.json'), 'utf-8')).version
  } catch {
    return null
  }
}

/** Latest published GitHub release tag, for the run record. Null when gh is absent or unauthenticated. */
export function latestReleaseTag() {
  try {
    return execFileSync('gh', ['release', 'view', '--json', 'tagName', '--jq', '.tagName'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * @param {'npm'|'local'} mode
 * @param {string} version npm dist-tag or exact version, npm mode only
 * @param {string} installRoot throwaway directory for the npm prefix
 * @returns {{mode, cliBin, serverBin, cliVersion, serverVersion, installLog}}
 */
export function resolveBinaries(mode, { version = 'latest', installRoot } = {}) {
  if (mode === 'local') {
    const cliBin = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js')
    const serverBin = path.join(REPO_ROOT, 'packages', 'server', 'dist', 'index.js')
    for (const [name, bin] of [
      ['CLI', cliBin],
      ['server', serverBin],
    ]) {
      if (!fs.existsSync(bin)) {
        throw new Error(`local mode: ${name} build missing at ${bin}\n  run: pnpm -r build`)
      }
    }
    return {
      mode,
      cliBin,
      serverBin,
      cliVersion: localCliVersion(),
      serverVersion: readVersion(path.join(REPO_ROOT, 'packages', 'server', 'package.json')),
      installLog: null,
    }
  }

  fs.mkdirSync(installRoot, { recursive: true })
  // A private manifest keeps npm from walking up into the monorepo and
  // resolving the workspace copies instead of the registry ones — which would
  // quietly turn "npm mode" back into "local mode" and defeat the whole point.
  fs.writeFileSync(
    path.join(installRoot, 'package.json'),
    JSON.stringify({ name: 'tages-e2e-install', version: '0.0.0', private: true }, null, 2),
  )

  const installLog = execFileSync(
    'npm',
    [
      'install',
      `@tages/cli@${version}`,
      `@tages/server@${version}`,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      '--install-strategy=hoisted',
    ],
    { cwd: installRoot, encoding: 'utf-8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const cliPkgDir = path.join(installRoot, 'node_modules', '@tages', 'cli')
  const serverPkgDir = path.join(installRoot, 'node_modules', '@tages', 'server')
  const cliBin = path.join(cliPkgDir, binField(cliPkgDir, 'tages') ?? 'dist/index.js')
  const serverBin = path.join(serverPkgDir, binField(serverPkgDir, 'tages-server') ?? 'dist/index.js')

  for (const [name, bin] of [
    ['CLI', cliBin],
    ['server', serverBin],
  ]) {
    if (!fs.existsSync(bin)) {
      throw new Error(
        `npm mode: published ${name} declares a bin at ${bin} but the tarball does not contain it.\n` +
          `  That is a packaging defect — the published package is unusable as installed.`,
      )
    }
  }

  return {
    mode,
    cliBin,
    serverBin,
    cliVersion: readVersion(path.join(cliPkgDir, 'package.json')),
    serverVersion: readVersion(path.join(serverPkgDir, 'package.json')),
    installLog,
  }
}

function readVersion(pkgJson) {
  try {
    return JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).version
  } catch {
    return null
  }
}

/** The path a package's own manifest declares for `binName`, so we test what npm would link. */
function binField(pkgDir, binName) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    if (typeof pkg.bin === 'string') return pkg.bin
    return pkg.bin?.[binName] ?? null
  } catch {
    return null
  }
}
