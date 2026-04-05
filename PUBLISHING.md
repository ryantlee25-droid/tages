# Publishing

Steps to publish Tages packages to npm.

## Prerequisites

- npm account with access to `tages` and `@tages/server`
- `npm login` completed

## Version bump

```bash
# Bump all packages
cd packages/shared && npm version patch
cd ../server && npm version patch
cd ../cli && npm version patch
cd ../..
```

## Build

```bash
pnpm build
```

## Verify with npm pack

```bash
cd packages/cli && npm pack --dry-run
cd ../server && npm pack --dry-run
```

Check that only `dist/` and `README.md` are included.

## Publish

```bash
# Shared (private, not published)
# cd packages/shared && npm publish  # skip — private: true

# Server
cd packages/server && npm publish --access public

# CLI
cd packages/cli && npm publish
```

## Post-publish

1. Verify install: `npm install -g tages && tages --help`
2. Verify MCP: `npx @tages/server` connects via stdio
3. Update README release notes with the new version
4. Tag the release: `git tag v0.1.x && git push --tags`
