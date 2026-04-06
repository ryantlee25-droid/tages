# HOOK.md — Howler C: G3-T15 + G3-T16

## Status: in-progress

## Assignment
Create SBOM generation workflow and Dependabot config.

## Files Owned
- `.github/workflows/sbom.yml` (create)
- `.github/dependabot.yml` (create)

## Reference
- Existing CI uses: actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4
- CI triggers on pull_request + push to main
- pnpm version 10, node version 20

## Milestones
- [x] Write HOOK.md
- [ ] Create .github/workflows/sbom.yml
- [ ] Create .github/dependabot.yml
- [ ] Run pnpm typecheck
- [ ] Commit

## Seams
None — these are standalone config files with no code integration.
