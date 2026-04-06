import chalk from 'chalk'

interface TemplatesOptions {
  project?: string
}

async function getTemplates() {
  // @ts-ignore — cross-package import; server must be built first
  const { BUILTIN_TEMPLATES } = await import('../../../server/src/templates/builtin-templates.js')
  return BUILTIN_TEMPLATES as Array<{ id: string; name: string; description: string; fields: Array<{ name: string; required: boolean; description: string }>; filePatterns: RegExp[] }>
}

export async function templatesListCommand(_options: TemplatesOptions) {
  const BUILTIN_TEMPLATES = await getTemplates()
  console.log(chalk.bold('Available Memory Templates:\n'))
  for (const t of BUILTIN_TEMPLATES) {
    console.log(`  ${chalk.cyan(`[${t.id}]`)} ${chalk.bold(t.name)}`)
    console.log(`  ${chalk.dim(t.description)}`)
    console.log(`  Fields: ${t.fields.map(f => `${f.name}${f.required ? '*' : ''}`).join(', ')}`)
    console.log()
  }
  console.log(chalk.dim('* = required field'))
}

export async function templatesMatchCommand(filePath: string, _options: TemplatesOptions) {
  const BUILTIN_TEMPLATES = await getTemplates()
  console.log(chalk.bold(`Templates matching "${filePath}":\n`))
  const matches = BUILTIN_TEMPLATES.filter(t =>
    t.filePatterns.some(p => p.test(filePath))
  )
  if (matches.length === 0) {
    console.log(chalk.dim('No templates match this file path.'))
    return
  }
  for (const t of matches) {
    console.log(`  ${chalk.cyan(t.id)}: ${t.name} — ${t.description}`)
  }
  console.log('\nUse the MCP apply_template tool to create memories from these templates.')
}

export async function templatesApplyCommand(name: string, _options: TemplatesOptions) {
  const BUILTIN_TEMPLATES = await getTemplates()
  const template = BUILTIN_TEMPLATES.find(t => t.id === name)
  if (!template) {
    console.error(chalk.red(`Template "${name}" not found.`))
    console.log(chalk.dim('Available templates: ' + BUILTIN_TEMPLATES.map(t => t.id).join(', ')))
    process.exit(1)
  }

  console.log(chalk.bold(`Template: ${template.name}`))
  console.log(chalk.dim(template.description))
  console.log('\nRequired fields:')
  for (const f of template.fields.filter(f => f.required)) {
    console.log(`  ${chalk.cyan(f.name)}: ${f.description}`)
  }
  console.log('\nUse the MCP apply_template tool with templateId=' + chalk.cyan(`"${name}"`) + ' to fill and apply this template.')
}
