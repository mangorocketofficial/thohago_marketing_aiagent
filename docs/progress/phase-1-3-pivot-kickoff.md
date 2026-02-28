# Phase 1-3 Pivot Kickoff Report

> Status update (2026-02-28): Superseded by `phase-1-3-pivot-completion.md`.  
> This file is retained as kickoff snapshot only.

- Phase: 1-3
- Title: Electron Pivot Kickoff
- Status: In Progress
- Started On: 2026-02-28

## 1) Objective

- Start the architecture pivot from Web + Python daemon to Electron desktop runtime.
- Preserve migration history while deprecating `local_files`-based cloud indexing.
- Prepare the workspace to continue Phase 1-3 on desktop-first assumptions.

## 2) Changes Applied in Kickoff

- Added pivot migration:
  - `supabase/migrations/20260228090000_drop_local_files.sql`
  - Drops `public.local_files` with forward-only migration history preserved
- Removed shared code references to `local_files`:
  - Removed `FileStatus`/`LocalFile` from `packages/types/src/index.ts`
  - Removed `packages/db/src/queries/local-files.ts`
  - Removed `export * from "./queries/local-files"` in `packages/db/src/index.ts`
- Updated RLS verification SQL:
  - Removed `local_files` checks from `supabase/verify-rls.sql`
- Added desktop scaffold:
  - New `apps/desktop` Electron + React + Vite baseline
  - Root `dev` command switched to `@repo/desktop`
- Workspace update:
  - Removed `services/*` from `pnpm-workspace.yaml`
- Runtime deprecation:
  - Removed tracked files under `services/daemon`
  - Removed tracked files under `apps/web`

## 3) Notes

- Existing Phase 1-1 and 1-2 docs remain as historical implementation records.
- Runtime/interface direction from this point follows:
  - `docs/architecture-pivot-electron.md`

## 4) Next Actions

- Implement Electron main-process file watcher (`chokidar`) and local processing pipeline hooks.
- Wire Supabase sync for chat/content approval flows (Electron ↔ Telegram).
- Finalize deletion of any leftover local artifacts from removed directories if locked by OS process.
