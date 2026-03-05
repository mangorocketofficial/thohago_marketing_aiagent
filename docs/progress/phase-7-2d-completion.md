# Phase 7-2d Completion Report

- Phase: 7-2d
- Title: Vision-Based Image Index System for Instagram Auto Selection
- Status: Done
- Completed On: 2026-03-05

## Summary

- Instagram auto image selection now uses vision-indexed metadata instead of filename semantics.
- Deterministic ranking is enforced with fixed tie-break order and staged fallback policy.
- Desktop watcher now drives GPT Vision indexing and stores normalized OCR/object/scene/safety signals.

## API Behavior Update

- Added internal routes: `POST /image-index/upsert`, `POST /image-index/delete`.
- Image index upsert now maintains immutable version keys and latest-row pointer (`is_latest`).
- Instagram generation metadata now exposes `image_selection_source` and `image_selection_reason`.

## Runtime Behavior Update

- Watcher add/change events now run background image indexing and upsert index rows.
- Watcher unlink now soft-deletes latest index rows for the removed source path.
- Vision failures no longer block generation and are recorded as `failed` rows with `last_error`.

## Validation

- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/api test:unit` passed (70 tests, 0 failed).
- `node --check` passed for updated desktop runtime modules.

## Follow-up

- Add durable retry queue and backoff persistence for desktop vision indexing.
- Add embedding-backed semantic scoring once vector profile is finalized for image index rows.
- Add end-to-end smoke coverage for watcher -> index -> instagram auto selection telemetry.

### Decisions

[D-014]

Why this approach:
Vision-first indexing was adopted to remove filename dependency while preserving deterministic selection via `is_latest` and fixed tie-break ordering.

Alternatives considered:
- Filename/path + LLM-only ranking was rejected due opaque filename instability and low explainability.

Blockers hit:
- `local_files` removal broke image-id/path resolution assumptions and was resolved by moving selectors/resolvers to `activity_image_indexes`.

Tech debt introduced:
- DEBT-011 desktop vision indexing has no durable retry queue or persisted backoff state -> affects Phase 7-3.
