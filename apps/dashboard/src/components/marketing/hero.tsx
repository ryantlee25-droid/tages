import { Button, Command } from './ui'

export function Hero() {
  return (
    <section className="px-6 pt-24 pb-6 sm:pt-28 sm:pb-8">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="settle max-w-[19ch] text-display-sm sm:text-display text-balance text-ink">
          Shared memory for your team&apos;s coding agents.
        </h1>

        <p className="settle measure mt-6 text-lead text-ink-soft" style={{ ['--i' as string]: 1 }}>
          Agents forget everything between sessions, so every convention gets re-explained and
          every past mistake gets repeated by whoever touches the code next. Tages keeps that
          knowledge in one place your whole team&apos;s agents can read and write.
        </p>

        <div
          className="settle mt-10 flex flex-col gap-3 sm:flex-row sm:items-center"
          style={{ ['--i' as string]: 2 }}
        >
          <div className="w-full sm:max-w-md">
            <Command value="npm install -g @tages/cli" />
          </div>
          <div className="flex items-center gap-3">
            <Button href="/auth/login">Get started</Button>
            <Button href="https://github.com/ryantlee25-droid/tages" variant="secondary" external>
              GitHub
            </Button>
          </div>
        </div>

        <p
          className="settle mt-5 text-label text-ink-muted"
          style={{ ['--i' as string]: 3 }}
        >
          Works with Claude Code, Cursor, Codex, and Gemini over MCP. Free tier, MIT licensed,
          self-hostable.
        </p>
      </div>
    </section>
  )
}
