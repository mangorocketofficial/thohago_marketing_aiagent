# Phase 8-3 Completion Report

- Phase: 8-3
- Title: Autonomous Analytics Analysis Loop
- Status: Done
- Completed On: 2026-03-09

## Summary

- Added a durable analysis loop that queues performance-analysis runs from new metrics, cadence sweeps, manual triggers, and recovery.
- Full markdown reports now persist in `analysis_reports`; local file export is optional metadata, not the source of truth.
- Recent reports now feed both RAG and memory so future generation can reuse explicit performance guidance.
- Desktop Analytics now shows the latest report, supports manual analysis runs, and opens the full markdown report from API data.

## API Behavior Update

- Added `POST /orgs/:orgId/analytics/trigger-analysis`.
- Added `GET /orgs/:orgId/analytics/reports/latest` and `GET /orgs/:orgId/analytics/reports/:reportId`.
- Metrics follow-up now opportunistically queues `new_metrics` analysis when threshold and cooldown rules pass.
- API boot now starts a lease-based analysis worker with cadence sweep and stale-run recovery.

## Schema Update

- Added `analysis_reports` and `analytics_analysis_runs`.
- Extended RAG `source_type` to include `analysis_report`.
- Applied org-member read and service-role manage RLS for the new analysis tables.
- Report history is retained in DB while RAG keeps only a bounded recent subset.

## UX Flow Update

- Analytics Insights now surfaces latest-analysis status, summary, action items, and a manual run CTA.
- Full report viewing no longer assumes filesystem access and is backed by API-fetched markdown in the desktop modal.
- Memory and generation prompts now include latest-analysis guidance alongside accumulated insights.

## Validation

- `pnpm --filter @repo/rag build` passed.
- `pnpm --filter @repo/api type-check` passed.
- `pnpm --filter @repo/desktop type-check` passed.
- `pnpm --filter @repo/api exec tsx --test tests/phase-8-3-analysis-response.test.ts tests/phase-8-3-memory-builder.test.ts` passed.
- `pnpm --filter @repo/api test:unit` still fails in unrelated `phase-5-3-campaign-chain.test.ts` and `phase-7-4-instagram-carousel.test.ts`.

## Follow-up

- Add seeded route/integration coverage for queue claiming, report fetch paths, and cooldown/idempotency edges.
- Decide whether production deployment keeps in-process timers or moves the same queue contract into a dedicated worker.
- Add desktop browsing for older analysis reports beyond the latest summary card.

### Decisions

[D-018]

Why this approach:
Use DB-backed `analysis_reports` and `analytics_analysis_runs` as the canonical system so full reports, cooldown checks, retries, and UI reads do not depend on local files or process memory.

Alternatives considered:
- Filesystem-only report storage and process-local follow-up were rejected because they break remote reads, lose history semantics, and make retries fragile.

Blockers hit:
- The original plan could not support `View full report` without a canonical store and also overwrote report history in RAG; resolved by keeping history in DB and indexing only a bounded recent subset.

Tech debt introduced:
- DEBT-014 in-process analysis timers still own cadence and recovery dispatch -> affects Phase 8-3 hardening.
