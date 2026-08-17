import { Command, Rule, Section, SectionHead } from './ui'

/**
 * Numbered because the order is load-bearing: running step 3 from the wrong
 * directory is the single most common onboarding mistake, so the sequence
 * itself is information the reader needs.
 */
const steps = [
  {
    n: '1',
    title: 'Install the CLI',
    body: 'One command. No Docker, no local model, no API key to provision.',
    command: 'npm install -g @tages/cli',
  },
  {
    n: '2',
    title: 'Change into the repo you actually work in',
    body:
      'Memory binds to the directory you run the next command from. This is the step people get wrong, and it fails quietly rather than loudly.',
    command: 'cd ~/work/your-project',
  },
  {
    n: '3',
    title: 'Join your team’s project',
    body:
      'Signs you in with GitHub if needed, checks your membership, and wires your agent. Then restart the agent.',
    command: 'tages link --project-id <project-id>',
  },
]

export function Quickstart() {
  return (
    <Section id="start">
      <SectionHead
        title="Three commands, then your agent has the team's context."
        lead="A teammate joining an existing project runs these once per repository. Creating a project for the first time is the same path with tages init."
      />

      <ol className="mt-14 space-y-0">
        {steps.map((step, i) => (
          <li key={step.n}>
            {i > 0 ? <Rule className="my-10" /> : null}
            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:gap-8">
              <div
                aria-hidden
                className="text-sm font-semibold tabular-nums text-signal-600 sm:pt-1 sm:w-8"
              >
                {step.n}
              </div>
              {/* min-w-0: a grid item defaults to min-width:auto, which would let the
               *  longest command line set a floor wider than a phone screen. */}
              <div className="min-w-0">
                <h3 className="text-heading text-ink">{step.title}</h3>
                <p className="mt-2 measure text-ink-soft">{step.body}</p>
                <div className="mt-5 max-w-xl">
                  <Command value={step.command} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-12 text-label text-ink-muted">
        Prefer not to install anything? The MCP server runs straight from npx:{' '}
        <code className="font-mono text-ink-soft">claude mcp add tages -- npx -y @tages/server</code>
      </p>
    </Section>
  )
}
