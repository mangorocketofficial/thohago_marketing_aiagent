# Phase 7-2a Completion Report

- Phase: 7-2a
- Title: Instagram Generation Backend Core
- Status: Done
- Completed On: 2026-03-05

## Summary

- Added `instagram_generation` backend skill with intent gating, survey-driven slot filling, and model-fallback draft generation.
- Added template registry and media composer contracts to render Instagram image outputs from preset schemas.
- Added golden and unit coverage to lock routing, survey mapping, template validation, and draft parser behavior.

## API Behavior Update

- Added org-scoped template and activity-image read APIs for Instagram generation context.
- Generation now persists Instagram draft content with slot linkage and rollback-safe media storage handling.
- Assistant metadata now returns storage-safe identifiers and relative paths instead of absolute local paths.

## UX Flow Update

- Chat can now move from topic clarification to structured survey answers before generation starts.
- Successful generation returns reusable draft and image metadata for scheduler/editor follow-up actions.
- Activity image selection now resolves deterministically from org `activity_folder` inventory with fallback-safe handling.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed, including phase 7-2a golden snapshots.
- Existing desktop scheduler changes were preserved as-is and committed together per request.

## Follow-up

- 7-2b: connect desktop survey UI to the new Instagram survey state and completion-card actions.
- 7-2b: surface private-bucket signed image URLs in frontend preview and download flows.
- 7-2b: add end-to-end scheduler approval flow coverage for generated Instagram artifacts.

### Decisions

[D-008]

Why this approach:
Backend-first delivery (intent/survey/media/storage contracts first) was chosen to stabilize generation outputs before desktop UX wiring.

Alternatives considered:
- Building desktop survey and signed-preview UX in the same batch was rejected due to higher regression risk across chat, scheduler, and storage permissions.

Blockers hit:
- Template schema and composer layer shape drift caused parse failures; resolved by unifying registry schemas with composer input contracts and preset validation.

Tech debt introduced:
- DEBT-008 private-bucket signed URL lifecycle is backend-ready, but desktop preview/download integration is deferred -> affects Phase 7-2b.
