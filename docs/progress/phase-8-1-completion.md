# Phase 8-1 Completion Report

- Phase: 8-1
- Title: Performance Analytics Feedback Loop
- Status: Done
- Completed On: 2026-03-07

## Summary

- Performance analytics now stores engagement snapshots per published content instead of count-only tracking.
- Channel-aware scoring computes normalized `performance_score` values and feeds them back into RAG metadata.
- Accumulated insights now use scored publish-time, CTA, and channel-quality signals.
- Desktop Analytics now supports end-to-end metric input and insight refresh from real backend data.

## API Behavior Update

- Added `GET /orgs/:orgId/metrics/published-contents` with channel filtering and cursor pagination.
- Added `POST /orgs/:orgId/metrics/batch` with validation, ownership checks, and request idempotency-key handling.
- Metric batch ingestion persists `content_metrics` snapshots and returns deterministic `saved/failed` outcomes.
- Score sync plus insight refresh runs inline for small batches and defers to async follow-up for large batches.

## UX Flow Update

- Analytics now separates `Insights` and `Performance Input` tabs with live Supabase/API-backed data.
- Users can submit channel-specific metrics for multiple published contents in one batch action.
- Input rows expose latest metrics, computed score badges, and localized submit/result feedback.
- Refresh and load-more behavior keeps filter and pagination continuity after submission.

## Validation

- `pnpm --dir apps/api exec tsx --test tests/phase-8-1-golden.test.ts` passed.
- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm --filter @repo/api test:unit` shows two pre-existing failures in `phase-5-3-campaign-chain.test.ts`.

## Follow-up

- Phase 8-2: move large-batch score sync and insight refresh into a durable background queue.
- Phase 8-2: add route-level integration tests for idempotency retry/conflict paths.
- Phase 8-2: add Playwright smoke coverage for analytics input-submit-refresh flows.

### Decisions

[D-016]

Why this approach:
Append-only metric snapshots were chosen so performance history is preserved while latest-score reads stay simple for UI and RAG.

Alternatives considered:
- Per-content overwrite row was rejected because it drops day-1/day-7/day-30 trend history and weakens auditability.

Blockers hit:
- Large batch follow-up caused request latency spikes; resolved by threshold-based async follow-up with sync path for small batches.

Tech debt introduced:
- DEBT-012 process-local async follow-up for large metric batches can be lost on process restart -> affects Phase 8-2.

