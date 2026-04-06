import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import ora from 'ora'
import { createAuthenticatedClient } from '../auth/session.js'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { loadProjectConfig } from '../config/project.js'

interface ModuleInfo {
  name: string
  path: string
  exports: string[]
  imports: string[]
  lineCount: number
}

interface Dependency {
  from: string
  to: string
}

interface Boundary {
  name: string
  paths: string[]
  description: string
}

interface SnapshotOptions {
  project?: string
  dir?: string
}

export async function snapshotCommand(options: SnapshotOptions) {
  const spinner = ora('Scanning codebase...').start()
  const rootDir = options.dir || process.cwd()

  // Find all source files
  const files = findSourceFiles(rootDir)
  spinner.text = `Analyzing ${files.length} files...`

  const modules: ModuleInfo[] = []
  const dependencies: Dependency[] = []

  for (const file of files) {
    const relPath = path.relative(rootDir, file)
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.split('\n')

    // Extract exports
    const exports: string[] = []
    for (const line of lines) {
      const exportMatch = line.match(/export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/)
      if (exportMatch) exports.push(exportMatch[1])
      const reExport = line.match(/export\s+\{([^}]+)\}/)
      if (reExport) {
        exports.push(...reExport[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean))
      }
    }

    // Extract imports
    const imports: string[] = []
    for (const line of lines) {
      const importMatch = line.match(/(?:import|require)\s*\(?['"]([^'"]+)['"]/)
      if (importMatch) imports.push(importMatch[1])
      const dynamicImport = line.match(/import\(['"]([^'"]+)['"]\)/)
      if (dynamicImport) imports.push(dynamicImport[1])
    }

    modules.push({
      name: path.basename(file, path.extname(file)),
      path: relPath,
      exports,
      imports: imports.filter(i => i.startsWith('.') || i.startsWith('@')),
      lineCount: lines.length,
    })

    // Build dependency edges for local imports
    for (const imp of imports) {
      if (imp.startsWith('.')) {
        const resolved = resolveImport(file, imp)
        if (resolved) {
          dependencies.push({
            from: relPath,
            to: path.relative(rootDir, resolved),
          })
        }
      }
    }
  }

  // Detect module boundaries (directories with index files or package.json)
  const boundaries: Boundary[] = detectBoundaries(rootDir, modules)

  spinner.text = 'Storing snapshot...'

  const snapshot = {
    modules: modules.map(m => ({ name: m.name, path: m.path, exports: m.exports })),
    dependencies,
    boundaries,
  }

  const config = loadProjectConfig(options.project)
  if (config?.supabaseUrl && config?.supabaseAnonKey) {
    const supabase = await createAuthenticatedClient(config.supabaseUrl, config.supabaseAnonKey)

    let commitSha: string | undefined
    try {
      commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    } catch { /* not in git */ }

    await supabase.from('architecture_snapshots').insert({
      id: randomUUID(),
      project_id: config.projectId,
      snapshot,
      commit_sha: commitSha || null,
    })

    // Also store as architecture memories for quick access
    // Top-level summary
    await supabase.from('memories').upsert({
      project_id: config.projectId,
      key: 'auto-snapshot-summary',
      value: `${modules.length} modules, ${dependencies.length} dependencies, ${boundaries.length} boundaries. Top modules: ${modules.sort((a, b) => b.lineCount - a.lineCount).slice(0, 5).map(m => `${m.path} (${m.lineCount} lines)`).join(', ')}`,
      type: 'architecture',
      source: 'auto_index',
      confidence: 1.0,
      file_paths: modules.map(m => m.path).slice(0, 20),
      tags: ['auto-snapshot'],
    }, { onConflict: 'project_id,key', ignoreDuplicates: false })

    // Store each boundary as a memory
    for (const b of boundaries) {
      await supabase.from('memories').upsert({
        project_id: config.projectId,
        key: `boundary-${b.name}`,
        value: b.description,
        type: 'architecture',
        source: 'auto_index',
        confidence: 1.0,
        file_paths: b.paths,
        tags: ['auto-snapshot', 'boundary'],
      }, { onConflict: 'project_id,key', ignoreDuplicates: false })
    }
  }

  spinner.succeed(`Snapshot complete: ${modules.length} modules, ${dependencies.length} dependencies, ${boundaries.length} boundaries`)

  console.log()
  console.log(chalk.bold('  Boundaries:'))
  for (const b of boundaries) {
    console.log(`    ${chalk.green(b.name)} — ${b.description} (${b.paths.length} files)`)
  }

  console.log()
  console.log(chalk.bold('  Largest modules:'))
  const top = modules.sort((a, b) => b.lineCount - a.lineCount).slice(0, 10)
  for (const m of top) {
    console.log(`    ${m.lineCount.toString().padStart(5)} lines  ${chalk.dim(m.path)}  exports: ${m.exports.join(', ') || '(none)'}`)
  }
}

function findSourceFiles(dir: string): string[] {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'])
  const ignore = new Set(['node_modules', 'dist', '.next', '.git', 'vendor', '__pycache__', '.turbo'])
  const results: string[] = []

  function walk(d: string) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (exts.has(path.extname(entry.name))) {
        results.push(full)
      }
    }
  }

  walk(dir)
  return results
}

function resolveImport(fromFile: string, importPath: string): string | null {
  const dir = path.dirname(fromFile)
  const candidates = [
    path.resolve(dir, importPath),
    path.resolve(dir, importPath + '.ts'),
    path.resolve(dir, importPath + '.tsx'),
    path.resolve(dir, importPath + '.js'),
    path.resolve(dir, importPath + '/index.ts'),
    path.resolve(dir, importPath + '/index.js'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function detectBoundaries(rootDir: string, modules: ModuleInfo[]): Boundary[] {
  // Group modules by top-level directory
  const dirs: Record<string, ModuleInfo[]> = {}
  for (const m of modules) {
    const parts = m.path.split(path.sep)
    const topDir = parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0]
    if (!dirs[topDir]) dirs[topDir] = []
    dirs[topDir].push(m)
  }

  const boundaries: Boundary[] = []
  for (const [dir, mods] of Object.entries(dirs)) {
    if (mods.length < 2) continue
    const totalExports = mods.reduce((sum, m) => sum + m.exports.length, 0)
    const totalLines = mods.reduce((sum, m) => sum + m.lineCount, 0)
    boundaries.push({
      name: dir,
      paths: mods.map(m => m.path),
      description: `${mods.length} files, ${totalLines} lines, ${totalExports} exports`,
    })
  }

  return boundaries.sort((a, b) => b.paths.length - a.paths.length)
}

