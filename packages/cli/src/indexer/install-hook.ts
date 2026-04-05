import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

const HOOK_SCRIPT = `#!/bin/sh
# Tages auto-indexer — extracts memories from commits
# Installed by \`tages init\` / \`tages index --install\`

# Run tages index in background to avoid blocking commits
if command -v npx >/dev/null 2>&1; then
  npx tages index --last-commit &
fi
`

export function installPostCommitHook(repoRoot?: string): { installed: boolean; path: string } {
  const root = repoRoot || findGitRoot()
  if (!root) {
    return { installed: false, path: '' }
  }

  const hookPath = path.join(root, '.git', 'hooks', 'post-commit')
  const hookDir = path.dirname(hookPath)

  if (!fs.existsSync(hookDir)) {
    fs.mkdirSync(hookDir, { recursive: true })
  }

  // Don't overwrite existing hooks — append instead
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8')
    if (existing.includes('tages')) {
      return { installed: true, path: hookPath }
    }
    // Append to existing hook
    fs.appendFileSync(hookPath, '\n' + HOOK_SCRIPT.split('\n').slice(1).join('\n'))
  } else {
    fs.writeFileSync(hookPath, HOOK_SCRIPT)
  }

  fs.chmodSync(hookPath, 0o755)
  return { installed: true, path: hookPath }
}

function findGitRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}
