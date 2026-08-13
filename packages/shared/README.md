# @tages/shared

Shared types and utilities for [Tages](https://github.com/ryantlee25-droid/tages) — team memory for AI coding agents.

**You almost certainly do not need to install this directly.** It is an internal package, pulled in as a dependency of [`@tages/server`](https://www.npmjs.com/package/@tages/server) and [`@tages/harness-claude-code`](https://www.npmjs.com/package/@tages/harness-claude-code). It is published only so those packages resolve on a clean machine. It carries no stability guarantee beyond what those packages need, so treat its surface as internal.

## What is in it

- **Types** — the memory model shared across the CLI, server, and dashboard (memory records, the 11 memory types, harness event shapes).
- **Supabase client factory** — `createSupabaseClient()` / `getSupabaseClient()`, so every package builds its client the same way.
- **Project factory** — `createCloudProject()` / `createLocalProject()`, the one place project config is constructed.
- **Safety scanners** — `scanForSensitiveData()`, `redactSensitiveData()`, `hasHighSeverity()`, `formatSafetyWarnings()`. These are what stop secrets and PII from being written into memory or telemetry.

## Usage

```ts
import { redactSensitiveData, createSupabaseClient } from '@tages/shared'

const { redacted, count } = redactSensitiveData(untrustedText)
```

## Links

- [Repository and full documentation](https://github.com/ryantlee25-droid/tages)
- [Issues](https://github.com/ryantlee25-droid/tages/issues)

MIT licensed.
