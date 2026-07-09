# @tages/harness-claude-code

Claude Code hooks capture package for the Tages **instrumented harness** — a second, local-first ingestion path that captures the full tool-call stream (Bash/Read/Edit/Grep/MCP/etc.) a Claude Code agent actually takes, not just the calls that happen to be Tages MCP tools.

This package is not installed directly by developers. It's installed and managed by `tages harness enable` / `disable` / `status` / `sync` (see `@tages/cli`), which writes a hooks block into your own gitignored `.claude/settings.local.json` pointing at this package's bin.

## What it does

1. Claude Code invokes `tages-harness-claude-code` once per `PreToolUse` / `PostToolUse` / `SessionEnd` / `Stop` hook firing, piping a JSON payload on stdin.
2. This process normalizes the payload into a `HarnessEvent` (`@tages/shared`).
3. Every arg/path/result field is redacted via `redactSensitiveData` (`@tages/shared`) **before** anything touches disk, and capped in length — v1 never stores uncapped file contents or full diffs, only tool name, scrubbed args/paths, exit codes, durations, and timestamps.
4. The event is appended to a local SQLite log at `~/.config/tages/cache/<slug>-harness.db`.
5. The process exits `0`. It never throws, never blocks the agent's tool call, and never emits blocking stdout — a malformed or unrecognized payload just means nothing was captured this time.

`tages harness sync` (in `@tages/cli`) later batches unsynced rows from that local log into a `harness_tool_events` Supabase table.

## Privacy

Raw, unredacted payloads never leave the machine and are never written even to the local log — redaction happens in-process, before the first disk write. See `PRIVACY.md`'s instrumented-harness section for the full data-handling commitment (what's captured, what's redacted, retention).

## Files

- `src/index.ts` — hook bin entrypoint; `parseHookPayload` (the payload adapter) and `handleRawPayload` (parse + redact + persist) are exported for testing.
- `src/local-log.ts` — local SQLite log (`HarnessLog`), mirrors `packages/server/src/cache/query-log.ts`'s minimal better-sqlite3 + WAL pattern.

## Related packages

- `@tages/shared` — `HarnessEvent` type, `redactSensitiveData`
- `@tages/cli` — `tages harness enable/disable/status/sync`
- `@tages/server` — the MCP server this harness is additive to, not a replacement for

## License

MIT.
