import chalk from 'chalk'

interface TemplatesOptions {
  project?: string
}

interface TemplateField {
  name: string
  required: boolean
  description: string
}

interface Template {
  id: string
  name: string
  description: string
  fields: TemplateField[]
  filePatterns: RegExp[]
}

// ------------------------------------------------------------
// Cross-package import from packages/server/src/templates/
//
// This replaces a runtime resolver that walked a FIXED number of `..` segments
// from `import.meta.url` to find `packages/server/dist/templates/
// builtin-templates.js` and `require`d it. That arithmetic was pinned to the
// old `tsc` output depth (`dist/packages/cli/src/commands/`); once tsup
// collapsed the build to a single `dist/index.js` the walk overshot the repo
// root and every `tages templates` invocation died with "Failed to load
// templates". Outside a monorepo checkout it had never worked at all, because
// no sibling `packages/server/dist/` exists there to find.
//
// The specifier below is a static string, so tsup resolves it FROM SOURCE and
// inlines the template data into the bundle at build time. No path resolution
// happens at runtime, which is what makes `tages templates` work from an npm
// install for the first time — and what keeps the next build-layout change
// from breaking it again. Do not reintroduce a computed path here.
//
// This costs almost nothing: `builtin-templates.ts` is pure data whose only
// import is a type-only `MemoryTemplate`, so it drags in no server runtime
// code.
//
// Two details are load-bearing:
//   - It is a DYNAMIC import, matching the lazy-load wrapper in
//     `commands/agents-md.ts`. A top-level static import is evaluated when
//     `index.ts` pulls this module in, so any failure here would take down
//     EVERY command, not just `templates`.
//   - The `.default` fallback handles CJS interop. `@tages/server` declares no
//     `"type"`, so when the CLI runs from source under tsx these files are
//     transpiled as CommonJS; Node's named-export detection does not see
//     through that and exposes the module only as `default`. Under tsup and
//     under vitest the same module arrives as ESM with a real named export.
//     Both shapes have to work.
// ------------------------------------------------------------
async function loadTemplates(): Promise<Template[]> {
  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-ignore
  const mod = await import('../../../server/src/templates/builtin-templates.js')
  const m = mod as unknown as {
    BUILTIN_TEMPLATES?: Template[]
    default?: { BUILTIN_TEMPLATES?: Template[] }
  }
  const templates = m.BUILTIN_TEMPLATES ?? m.default?.BUILTIN_TEMPLATES
  if (!templates) {
    throw new Error(
      'builtin-templates module loaded but exported no BUILTIN_TEMPLATES — the module shape changed.'
    )
  }
  return templates
}

export async function templatesListCommand(_options: TemplatesOptions) {
  const templates = await loadTemplates()
  console.log(chalk.bold('Available Memory Templates:\n'))
  for (const t of templates) {
    console.log(`  ${chalk.cyan(`[${t.id}]`)} ${chalk.bold(t.name)}`)
    console.log(`  ${chalk.dim(t.description)}`)
    console.log(`  Fields: ${t.fields.map(f => `${f.name}${f.required ? '*' : ''}`).join(', ')}`)
    console.log()
  }
  console.log(chalk.dim('* = required field'))
}

export async function templatesMatchCommand(filePath: string, _options: TemplatesOptions) {
  const templates = await loadTemplates()
  console.log(chalk.bold(`Templates matching "${filePath}":\n`))
  const matches = templates.filter(t =>
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
  const templates = await loadTemplates()
  const template = templates.find(t => t.id === name)
  if (!template) {
    console.error(chalk.red(`Template "${name}" not found.`))
    console.log(chalk.dim('Available templates: ' + templates.map(t => t.id).join(', ')))
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
