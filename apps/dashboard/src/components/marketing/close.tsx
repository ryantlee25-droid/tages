import { Button, Command } from './ui'

/**
 * The page ends on the same command it opened with. By this point the reader
 * knows what it does and why the team-correctness argument matters, so the
 * close is an action rather than another pitch.
 */
export function Close() {
  return (
    <section className="border-t border-line/70 px-6 py-20 sm:py-24">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="max-w-[20ch] text-title text-balance text-ink">
          Stop re-explaining your codebase to a machine that just forgot it.
        </h2>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:max-w-md">
            <Command value="npm install -g @tages/cli" />
          </div>
          <Button href="/auth/login">Get started</Button>
        </div>
      </div>
    </section>
  )
}
