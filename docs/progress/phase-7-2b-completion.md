# Phase 7-2b Completion Report

- Phase: 7-2b
- Title: Instagram Canvas Editor + Template Rendering
- Status: Done
- Completed On: 2026-03-05

## Summary

- Added scheduler-native Instagram visual editor with signed-image preview, inline overlay edits, template switching, and slot-based image replacement.
- Added backend re-compose and signed-url refresh contracts so editor preview always reflects latest Sharp output from private storage.
- Added chat completion card for Instagram generation with direct editor handoff and caption copy action.

## API Behavior Update

- Added `POST /orgs/:orgId/contents/:contentId/recompose` and `GET /orgs/:orgId/contents/:contentId/signed-url`.
- Re-compose now enforces collage slot count and returns `422 invalid_payload` on mismatch.
- Instagram template API now returns layer coordinates needed for template-aware overlay editing.

## UX Flow Update

- `ContentEditor` now routes `instagram` channel to a dedicated canvas editor instead of the generic text approval editor.
- Overlay edits run optimistic local updates with debounced server re-compose and latest-wins guard for out-of-order responses.
- Activity image thumbnails load via main process bridge (not renderer `file://`) and feed per-slot image picking.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm type-check` (workspace) passed.
- `pnpm --filter @repo/api test:unit` passed.

## Follow-up

- Implement regenerate scope dialog and backend path (`all`, `caption_only`, `image_only`) in editor action flow.
- Add Playwright smoke coverage for re-compose race handling and collage-slot validation errors.
- Extend local-save strategy to export caption + metadata bundle for downstream publishing automation.

### Decisions

[D-009] Server-side re-compose + signed URL + latest-wins response gating was chosen to preserve Sharp output parity while preventing stale preview overwrite.

Why this approach:
Server-side composition keeps preview/output parity with persisted artifacts, and latest-wins gating prevents out-of-order response overwrite during rapid edits.

Alternatives considered:
- Renderer-side canvas composition was rejected due to duplicated rendering logic and artifact drift risk.

Blockers hit:
- Renderer `file://` thumbnail loading violated Electron trust boundary and was resolved by a main-process thumbnail bridge.

Tech debt introduced:
- DEBT-009 regenerate scope UX/API integration deferment -> affects Phase 7-2c.
