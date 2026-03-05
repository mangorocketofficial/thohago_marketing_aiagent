# Phase 7-1b Completion Report

- Phase: 7-1b
- Title: Naver Blog Generation Frontend UX
- Status: Done
- Completed On: 2026-03-05

## Summary

- Scheduler editor now dispatches by channel: `naver_blog` uses a unified blog editor, other channels keep legacy approval editor.
- Blog editor adds real-time character count, copy, save-to-DB, local-save feedback, regenerate handoff, and dirty-state leave guard.
- Chat timeline now renders blog generation completion cards with direct “open in editor” action.

## API Behavior Update

- Added `PATCH /orgs/:orgId/contents/:contentId/body` with optimistic concurrency via `expected_updated_at`.
- Added desktop IPC contract `content:save-body` and renderer bridge `desktopRuntime.content.saveBody(...)`.
- Save response now returns conflict metadata (`version_conflict`) for UI retry/refresh guidance.

## UX Flow Update

- Blog generation completion in chat can open Scheduler editor directly via `focusContentId` handoff.
- Scheduler board cards now show localized channel label, draft-style badge for Naver blog, and body character count.
- Blog save writes DB first, then local file, with explicit local save success/failure indicator.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed.
- `pnpm --filter @repo/desktop type-check`, `build`, and workspace `pnpm type-check` passed.

## Follow-up

- 7-2a: reuse `content:save-body` and handoff card pattern for Instagram generation/editor flow.
- 7-2b: align canvas editor save/version contract with the same optimistic concurrency semantics.
- Add conflict recovery UX to auto-refresh latest body on `version_conflict` before retry.

### Decisions

[D-006]

Why this approach:
7-1b shipped as contract-first editor UX: save-body API/IPC was added before UI controls so the frontend could stay deterministic and conflict-aware.

Alternatives considered:
- Renderer-only local state editing without backend patch route was rejected because it cannot guarantee cross-surface consistency.

Blockers hit:
- Chat-to-scheduler editor jump lacked content-level handoff; resolved by extending workspace handoff with `focusContentId`.

Tech debt introduced:
- DEBT-006 generation completion card currently carries duplicated `generated_body` in chat metadata for copy convenience -> affects Phase 7-2a.
