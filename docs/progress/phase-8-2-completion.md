# Phase 8-2 Completion Report

- Phase: 8-2
- Title: Analytics Read Model Refactor
- Status: Done
- Completed On: 2026-03-08

## Summary

- Desktop Analytics no longer exposes manual metric entry; the page now reflects API-collected performance review and insight consumption.
- Analytics scoring, metric normalization, channel constants, and insight helpers now live in shared `@repo/analytics`.
- `naver_blog` and `youtube` now use a dedicated `views` column instead of overloading `likes`.
- Silent sample insight fallback was removed from live tabs and replaced with explicit source-state messaging.

## API Behavior Update

- Added `GET /orgs/:orgId/metrics/insights` as the canonical insights read path for desktop analytics.
- Tightened metrics pagination to use `created_at desc, id desc` semantics with a tie-safe cursor filter.
- Switched metrics canonicalization and scoring paths to shared analytics helpers.
- Updated batch metric persistence to store `views` explicitly and mark batch ingestion as `api_batch`.

## UX Flow Update

- Replaced `PerformanceInputPanel` with `PerformanceReviewPanel` and removed manual submit behavior from the renderer contract.
- Desktop analytics now reads both published metrics and accumulated insights through Electron IPC only.
- Live analytics tabs show explicit `live`, `empty`, `error`, and `apiPending` source states.
- Fixture/demo analytics remains isolated to the validation/demo tab and uses the same shared analytics engine.

## Schema Update

- Added `views` to `content_metrics`.
- Backfilled `views` from legacy `likes` values for `naver_blog` and `youtube`.
- Cleared overloaded `likes` values for those view-based channels after backfill.

## Validation

- `pnpm install` completed successfully.
- `pnpm --filter @repo/types build` passed.
- `pnpm --filter @repo/analytics build` passed.
- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm --filter @repo/api build` passed.
- `pnpm --filter @repo/desktop build` passed.
- `pnpm --filter @repo/api exec tsx --test tests/compute-insights-performance.test.ts tests/performance-scorer.test.ts tests/metrics-cursor.test.ts tests/wfk-dummy-insights.test.ts tests/phase-8-1-fixtures-validation.test.ts tests/phase-8-1-golden.test.ts` passed.
- `pnpm --filter @repo/api test:unit` still has two pre-existing failures in `phase-5-3-campaign-chain.test.ts` unrelated to Phase 8-2.

## Follow-up

- Replace `POST /metrics/batch` ingestion entrypoints with channel-specific external API collectors and scheduler jobs.
- Add route-level integration coverage for `/metrics/insights` and published-content pagination against a seeded DB.
- Add Playwright smoke coverage for analytics source banners, empty states, and fixture validation rendering.

## Notes

- The shared analytics package was split by responsibility (`channels`, `metrics`, `scoring`, `insights`, `parsing`) to keep file size and ownership boundaries manageable.
- Existing unrelated staged work in other feature areas was intentionally left untouched and excluded from this completion scope.
