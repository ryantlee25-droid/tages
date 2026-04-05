import * as fs from 'fs'
import * as path from 'path'

export interface FileContext {
  path: string
  exists: boolean
  lineCount?: number
  exports?: string[]
  imports?: string[]
  lastModified?: string
  sizeBytes?: number
}

/**
 * Enriches a list of file paths with metadata: line count, exports, imports, size.
 * Used to attach richer context to memories that reference files.
 */
export function enrichFilePaths(filePaths: string[], rootDir?: string): FileContext[] {
  const root = rootDir || process.cwd()

  return filePaths.map((fp) => {
    const fullPath = path.isAbsolute(fp) ? fp : path.join(root, fp)

    if (!fs.existsSync(fullPath)) {
      return { path: fp, exists: false }
    }

    const stats = fs.statSync(fullPath)
    const ext = path.extname(fp)
    const isSource = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext)

    const result: FileContext = {
      path: fp,
      exists: true,
      sizeBytes: stats.size,
      lastModified: stats.mtime.toISOString(),
    }

    if (isSource && stats.size < 500_000) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      result.lineCount = lines.length

      // Extract exports (TS/JS)
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        result.exports = []
        result.imports = []

        for (const line of lines) {
          const exportMatch = line.match(/export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/)
          if (exportMatch) result.exports.push(exportMatch[1])

          const importMatch = line.match(/(?:import|require)\s*\(?['"]([^'"]+)['"]/)
          if (importMatch && importMatch[1].startsWith('.')) {
            result.imports.push(importMatch[1])
          }
        }
      }

      // Extract exports (Python)
      if (ext === '.py') {
        result.exports = []
        for (const line of lines) {
          const defMatch = line.match(/^(?:def|class)\s+(\w+)/)
          if (defMatch && !defMatch[1].startsWith('_')) {
            result.exports.push(defMatch[1])
          }
        }
      }
    }

    return result
  })
}

/**
 * Formats file context into a human-readable string for memory enrichment.
 */
export function formatFileContext(contexts: FileContext[]): string {
  return contexts
    .map((fc) => {
      if (!fc.exists) return `- ${fc.path} (file not found)`
      const parts = [`- ${fc.path}`]
      if (fc.lineCount) parts.push(`${fc.lineCount} lines`)
      if (fc.exports?.length) parts.push(`exports: ${fc.exports.join(', ')}`)
      return parts.join(' | ')
    })
    .join('\n')
}
