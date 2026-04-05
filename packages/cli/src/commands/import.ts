import chalk from 'chalk'
import ora from 'ora'
import { parseCLAUDEmd } from '../importers/claude-md.js'
import { parseArchitectureMd } from '../importers/architecture-md.js'
import { parseLessonsMd } from '../importers/lessons-md.js'
import { storeImported } from '../importers/base-importer.js'

type ImportFormat = 'claude-md' | 'architecture-md' | 'lessons-md'

interface ImportOptions {
  project?: string
}

export async function importCommand(format: string, filePath: string, options: ImportOptions) {
  const spinner = ora()

  const parsers: Record<ImportFormat, (path: string) => ReturnType<typeof parseCLAUDEmd>> = {
    'claude-md': parseCLAUDEmd,
    'architecture-md': parseArchitectureMd,
    'lessons-md': parseLessonsMd,
  }

  const parser = parsers[format as ImportFormat]
  if (!parser) {
    console.error(chalk.red(`Unknown format: ${format}`))
    console.log(chalk.dim('  Supported formats: claude-md, architecture-md, lessons-md'))
    process.exit(1)
  }

  spinner.start(`Parsing ${filePath}...`)
  let memories
  try {
    memories = parser(filePath)
  } catch (err) {
    spinner.fail((err as Error).message)
    process.exit(1)
  }

  if (memories.length === 0) {
    spinner.info('No memories found in file')
    return
  }

  spinner.text = `Importing ${memories.length} memories...`

  try {
    const result = await storeImported(memories, options.project)
    spinner.succeed(
      `Imported ${result.total} memories (${result.created} new, ${result.updated} updated, ${result.skipped} skipped as duplicates)`,
    )
  } catch (err) {
    spinner.fail((err as Error).message)
    process.exit(1)
  }
}
