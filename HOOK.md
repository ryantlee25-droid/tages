# HOOK.md — Howler A: G3-T13 Public /security page

## Task
Create a public `/security` marketing page for Tages dashboard.

## Files Owned
- `apps/dashboard/src/app/(marketing)/security/page.tsx` — CREATE
- `apps/dashboard/src/components/marketing/security-page.tsx` — CREATE
- `apps/dashboard/src/app/sitemap.ts` — MODIFY

## Status: in-progress

## Milestones
- [x] Read CONTRACT.md (not found — working from drop prompt + CLAUDE.md)
- [x] Read homepage page.tsx for style reference
- [x] Read hero.tsx for component pattern reference
- [x] Read SECURITY.md for responsible disclosure content
- [x] Read sitemap.ts for modification target
- [x] Wrote HOOK.md
- [ ] Create security-page.tsx component
- [ ] Create security/page.tsx route
- [ ] Modify sitemap.ts
- [ ] Run pnpm typecheck
- [ ] Commit

## Assumptions
- No CONTRACT.md found in worktree root — proceeding from drop prompt spec
- Page is public (no auth check, no supabase.auth.getUser() call)
- Claims verified against CLAUDE.md security section (matches drop prompt spec)
- Following hero.tsx component pattern: named export, pure JSX, no async
- sitemap base URL is https://tages.dev (confirmed from existing sitemap.ts)

## Seams
None — this is a pure CREATE task with one MODIFY on sitemap.ts. No integration points with other Howlers.
