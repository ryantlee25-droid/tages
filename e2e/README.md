# Tages end-to-end viability suite

Answers one question: **can a team actually run on this?**

Four real authenticated identities, four isolated `$HOME`s, four separate git
work repos, the real published CLI, the real MCP server, a real Supabase
project. Nothing is mocked. Nothing is imported from source — the suite executes
the same artifact a teammate installs, because the defect that killed the
previous release candidate (`ReferenceError: exports is not defined in ES module
scope`) was invisible to all 1,200+ unit tests and only appeared when a built
entrypoint was run by `node`.

## Run it

Store the keys once (see [Keys](#keys)), then:

```bash
node e2e/run.mjs                      # published packages, prod  (the release gate)
node e2e/run.mjs --mode local         # this working tree's dist/  (the dev loop)
node e2e/run.mjs --target dev         # dev database
node e2e/run.mjs --stop-after 05      # run through phase 05, then stop
node e2e/run.mjs --keep               # leave fixtures behind to debug a failure
```

Or `pnpm test:e2e` / `pnpm test:e2e:local`.

Exit `0` all green, `1` a check failed, `2` the suite could not run at all
(missing keys, unreachable target, no binaries). The last one is deliberately
distinct: a suite that cannot run must never be mistaken for a suite that
passed.

### Keys

Store them once, **in your own terminal** (it needs a real TTY):

```bash
node e2e/run.mjs --set-credentials    # prompts with echo off, stores, verifies
node e2e/run.mjs --check-credentials  # reports shape only, never a value
```

Rotate by re-running `--set-credentials`. Remove with
`security delete-generic-password -a service-key -s tages-e2e`.

CI uses `TAGES_E2E_SERVICE_KEY` / `TAGES_E2E_ANON_KEY` from the job's secret
store instead. The environment wins over the Keychain when both are present.

> **Do not use `security add-generic-password ... -w` with an interactive
> prompt.** Its input goes through `readpassphrase(3)`, whose buffer is
> `_PASSWORD_LEN` = 128 bytes, and it truncates **silently** — exit code 0, no
> warning, a stored value that looks fine and is unusable. Measured: a 220-char
> value stored that way reads back as 128 characters. A Supabase JWT is
> 250-270 characters, so every one of them is mangled. This is why
> `--set-credentials` exists, why it reads every write straight back and
> compares byte for byte, and why `--check-credentials` flags a value of
> exactly 128 characters as a truncation signature.
>
> Passing the key as an argument (which `--set-credentials` does internally, as
> the only channel the macOS CLI offers above 128 bytes) exposes it in your own
> `ps` output for the lifetime of a sub-second process. That is a smaller
> exposure than a dotfile, which is permanently readable by every process
> running as you and captured by every backup.

`--set-credentials` also refuses, before storing anything:

- a value that is not shaped like a Supabase key,
- an incomplete JWT (fewer than three segments),
- the two keys swapped — an anon key under `service-key` cannot create fixture
  users, and a service_role key under `anon-key` would bypass RLS and make every
  authorization check in phase 08 pass vacuously,
- keys belonging to two different Supabase projects.

**Do not put the service key in `~/.zshrc`.** That is how the previous one
leaked: an export there puts the value in every shell, every child process, and
every terminal transcript, and rotation is the only remedy once it has been
read. It also silently breaks recall — after migration 0066 a service-role JWT
has no `sub` claim, so all four recall RPCs return zero rows, and you end up
debugging an empty `tages recall` that is not a bug.

Nothing is printed. Every value that reaches a log line passes through
`redact()`, which strips anything shaped like a JWT or a Supabase key
(`eyJ…`, `sb_secret_…`, `sb_publishable_…`). The suite also rejects a
publishable key stored under `service-key`, so a swapped pair fails with a clear
message instead of an opaque 401 during fixture creation.

The `service_role` key is used for exactly two things: creating the four fixture
users, and deleting them afterwards. **Every assertion about what a user can see
or do runs as that user's own JWT over the anon key.** Running an authorization
check as `service_role` would bypass RLS and turn it into a guaranteed pass —
which is why `TAGES_SERVICE_KEY` and nine other variables are stripped from
every child process, and why phase 99 verifies that the stripping worked.

## What it proves

| Phase | Claim |
|---|---|
| 00 preflight | The suite can run and the artifact under test is identified. Refuses to start otherwise. |
| 01 create | A memory written by a human *or by an agent over MCP* reaches Supabase `status=live`, with an embedding and chunk rows. A value containing a secret is refused. |
| 02 retrieve | It comes back — for a literal query, and for a **paraphrase sharing no distinctive words**. A nonsense query returns nothing. |
| 03 update | Re-`remember` on the same key replaces the fact: one row, same id, new embedding, prior value retained as a version, retracted text no longer served. |
| 04 invite + join | Owner invites, teammate accepts the zero-arg RPC, `link` writes a working `.mcp.json` into *their* repo, git-excluded; `doctor` passes and doesn't misdirect them to `tages init`. |
| 05 share | The teammate reads the owner's **correction**, writes back, the owner reads it, the owner **edits the teammate's memory** and the teammate sees that edit. Provenance survives. |
| 06 roles + seats | A read-only member can read, cannot write, **and is told so**. The plan seat limit fires at invite time. |
| 07 persistence | After wiping the local SQLite cache, a teammate still recalls everything — proving *stored*, not *cached*. Restarting the agent surfaces newer writes. |
| 08 isolation | An outsider is refused the join and gets zero rows from **all four** recall RPCs, cannot claim a teammate's invite, and an admin cannot promote themselves. A revoked member loses access immediately. |
| 09 lifecycle | `forget` removes the row from shared storage, and the **teammate** stops seeing it too. Repeating it is a no-op. |
| 99 controls | The suite is capable of failing. |

### Why phase 99 exists

A green run is only evidence if the machinery that produced it can go red. This
repo has shipped a 65-cell evaluation that ran entirely against an empty persona
and a verification pass that confirmed seven behaviours it never exercised. Both
were green. Phase 99 asserts, in the same process that produced every result
above, that `check()` records a false assertion as a failure, that `poll()`
reports a timeout rather than falling through, that a lookup for a key never
written comes back empty, that no RLS-bypassing variable reached a child
process, and that children ran under the fixture `$HOME`.

## Design notes

**Poll, never sleep.** Tages writes to SQLite first and flushes to Supabase
asynchronously. "The row is in the cloud" is a condition to poll for with a
deadline, not a duration to guess at. Every wait is an assertion; a timeout is a
failure, not a silent fall-through.

**Read the database back.** No durability claim rests on CLI stdout. A green
`Stored:` line has, in this repo's history, coexisted with a memory that never
left the developer's laptop.

**Controls beside the negatives.** Every "an outsider sees nothing" check is
paired with "the owner running the same query sees rows." Without the control, a
typo in a project id makes the whole isolation phase pass while proving nothing.

**Disjoint markers.** Where a phase asserts that an update replaced a value, the
old and new texts deliberately share no distinctive phrase, so "returns the
correction" is distinguishable from "returns both."

**Teardown is verified.** Cleanup runs in a `finally` and on `SIGINT`/`SIGTERM`,
then asserts that zero fixture rows remain. Everything the suite creates carries
a unique `tages-e2e-<stamp>` prefix, and nothing outside that prefix is ever
touched.

## The one leg this cannot cover

Real GitHub OAuth in a browser. The fixture identities hold genuine Supabase
sessions written into `auth.json` in exactly the shape the OAuth flow produces,
so everything downstream of the browser redirect is real. Do one live join with
a second human before a rollout.

## Running against production

`--target prod` is the default, because on release day the question is whether
the thing your team is about to install works — not whether a staging copy does.
The safety rails are the fixture prefix, verified teardown, and a service key
supplied per-run rather than stored. If you would rather not create rows in
prod, use `--target dev`.

## Adding a phase

Create `phases/NN-name.mjs` exporting `id`, `title`, and `async run(ctx)`, then
add it to `PHASE_MODULES` in `run.mjs`. Phases run in order and later ones
depend on state earlier ones set, which is why `--stop-after` truncates the run
rather than selecting a single phase. `ctx` carries `{ api, report, bins,
project, ids: {A,B,C,D}, state, root, fixturePrefix, args }`. Record every
assertion through `report.check(name, pass, detail)` — include the observed
value in `detail` even when it passes, because a green line with no evidence is
indistinguishable from a check that never ran.

## Sources

Practice this suite follows, and where it comes from:

- Tenant isolation belongs in a dedicated suite that queries as tenant A and
  asserts zero rows belonging to tenant B, across every data path rather than a
  sample — [Total Shift Left](https://totalshiftleft.ai/blog/testing-strategy-saas-platforms),
  [GigaTester](https://gigatester.com/multi-tenant-testing-explained/)
- Tests create their own data and tear it down; shared state across tenants
  produces false results that are near-impossible to debug —
  [testRigor](https://testrigor.com/blog/automating-multi-tenant-saas-testing/),
  [Bunnyshell](https://www.bunnyshell.com/blog/best-practices-for-end-to-end-testing-in-2025/)
- Poll an API or database to a timeout instead of sleeping at an
  eventually-consistent boundary; every wait should be expressible as an
  assertion or you do not know what you are waiting for —
  [AAAA pattern](https://ondrej-popelka.medium.com/testing-eventual-consistent-systems-settle-down-44d80348625e),
  [Serverless First](https://serverlessfirst.com/dealing-with-flaky-tests/),
  [Steve Kinney](https://stevekinney.com/courses/self-testing-ai-agents/the-waiting-story)
- Use E2E as a post-deploy smoke gate against an environment as close to
  production as possible —
  [Shiplight](https://www.shiplight.ai/blog/saas-e2e-testing),
  [Wopee.io](https://wopee.io/blog/flaky-tests-complete-guide/)
