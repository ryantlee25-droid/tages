import chalk from 'chalk'

interface FederationOptions {
  project?: string
}

export async function federateCommand(_key: string, _options: FederationOptions) {
  console.log(chalk.bold('Federation'))
  console.log(chalk.dim('Use the MCP federate_memory tool to promote a memory to the shared federated library.'))
  console.log(chalk.dim('Example: federate_memory({ key: "my-convention", scope: "org" })'))
}

export async function federationListCommand(_options: FederationOptions) {
  console.log(chalk.bold('Federated Library'))
  console.log(chalk.dim('Use the MCP list_federated tool to browse the shared federated memory library.'))
}

export async function federationImportCommand(_key: string, _options: FederationOptions) {
  console.log(chalk.bold('Import Federated Memory'))
  console.log(chalk.dim('Use the MCP import_federated tool to import a federated memory into your project.'))
}

export async function federationOverridesCommand(_options: FederationOptions) {
  console.log(chalk.bold('Federation Overrides'))
  console.log(chalk.dim('Use the MCP federation_overrides tool to see which federated memories have local overrides.'))
}
