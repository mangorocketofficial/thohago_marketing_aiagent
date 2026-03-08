# Phase 8-2 Analytics Read Model Refactor

## Goal

Phase 8-1 proved the performance feedback loop end-to-end, but the delivered UX and the actual system behavior diverged.

The 8-2 refactor aligns the product with the real operating model:

1. Performance data is collected by API, not entered manually by end users.
2. Insights and published-content analytics are read through one API/IPC path.
3. Scoring and insight logic live in one shared analytics package.
4. `views` is stored in a dedicated DB column for view-based channels.
5. Fallback/sample data is never silently shown as live data.
6. Cursor pagination is tightened to avoid duplicate or skipped rows on timestamp ties.

## Problems Found After 8-1

### 1. Manual entry UX did not match the intended product

The renderer exposed a metrics input concept, but the desired operating model is automated metrics ingestion.

This created three issues:

- product copy implied users should type metrics by hand
- the UI suggested a workflow we do not want to support
- the backend still looked "manual-first" even though the strategic direction is API collection

### 2. Scoring logic was duplicated

Three versions of analytics behavior existed:

- server scorer and insight helpers
- desktop fixture analytics engine
- various test-only normalizations

That structure made weight changes risky and guaranteed drift over time.

### 3. DB semantics were wrong for view-based channels

`naver_blog` and `youtube` needed `views`, but some earlier logic treated `likes` as a stand-in.

This forced mapper code and made the schema harder to understand for future changes.

### 4. Renderer data access paths were split

Insights were read directly from Supabase in the renderer, while published performance rows were read through Electron IPC and the API.

That split complicated:

- auth and secret handling
- error behavior
- observability
- future rollout of ingestion/status logic

### 5. Sample and fallback behavior could mislead operators

If live org data was missing, the UI could still show fixture/sample-like content.

That is acceptable for a demo tab, but not for the real analytics tabs.

### 6. Cursor pagination was not tie-safe

The cursor encoded `(created_at, id)` but filtering behavior was not aligned well enough to guarantee stable pagination when multiple rows shared the same timestamp.

### 7. Channel constants were scattered

The analytics channel list appeared in several files, increasing the chance of missing one when adding or removing a channel.

## Design Decisions

### A. Remove manual-entry behavior from the desktop product surface

- `PerformanceInputPanel` is removed
- `PerformanceReviewPanel` becomes the canonical review surface
- renderer no longer exposes `submitBatch`
- API batch ingestion remains available as a backend ingestion interface, not a user workflow

### B. Introduce a shared analytics package

`packages/analytics` now owns:

- analytics channel constants
- metric field definitions
- canonical metric normalization
- scoring references and performance score computation
- publish-time / CTA / recommendation insight helpers
- accumulated insights parsing

This package is consumed by both API and desktop code.

### C. Normalize DB storage for view-based channels

`content_metrics.views` is added and backfilled for `naver_blog` and `youtube`.

After migration:

- `views` is the canonical field for view-based channels
- `likes` is no longer overloaded to represent view counts

### D. Read analytics only through API/IPC

Desktop analytics now reads:

- `GET /orgs/:orgId/metrics/insights`
- `GET /orgs/:orgId/metrics/published-contents`

through `window.desktopRuntime.metrics.*`.

Renderer-level direct Supabase access is removed from this page.

### E. Make data source state explicit in the UI

Real analytics tabs now show source status:

- `live`
- `empty`
- `error`
- `apiPending` message when published content exists but collected metrics are not yet available

Fixture/demo data remains isolated to the `fixture` tab.

### F. Tighten pagination semantics

The cursor filter now uses:

`created_at < ts OR (created_at = ts AND id < lastId)`

paired with:

`ORDER BY created_at DESC, id DESC`

This keeps pagination stable across same-timestamp rows.

## Implementation Scope

### Shared package

- split analytics logic by responsibility instead of one large file
- centralize channels, metrics, scoring, insights, and parsing helpers
- fix CTA extraction patterns with readable Korean/English phrases

### API

- read accumulated insights through a dedicated metrics insights route
- use shared analytics helpers for scoring and insight computation
- use `views` in content-metrics reads and writes
- mark ingestion rows as API-collected (`api_batch`)

### Desktop

- remove manual metrics entry UX
- rename review panel to reflect real behavior
- add source banners
- remove silent `SAMPLE_INSIGHTS`
- remove renderer direct Supabase access for analytics page
- delete unused fixture fallback and duplicate client scorer files

### Tests

- update fixture data to readable, deterministic content
- validate view-based channels through `views`
- validate tie-safe cursor filter generation
- update golden expectations for the shared engine behavior

## Migration

Migration file:

- `supabase/migrations/20260308110000_phase_8_2_analytics_refactor.sql`

Steps:

1. add nullable `views` column
2. backfill `views` from `likes` for `naver_blog` and `youtube`
3. clear overloaded `likes` values for those channels

## Risks

### 1. Historical readers that still assume `likes` for blog/video rows

Mitigation:

- switch all analytics scoring/normalization logic to shared helpers
- keep tests around `normalizeMetricsForStorage`

### 2. Golden/test drift after shared-engine consolidation

Mitigation:

- regenerate or update golden expectations deliberately
- validate both scoring and derived insights from the same package

### 3. Operators misreading empty state as a bug

Mitigation:

- explicit source banners
- `apiPending` copy when content exists but metrics ingestion has not landed yet

## Exit Criteria

- no desktop manual-entry path remains in the analytics page
- analytics read path is API/IPC-only
- sample insights are not shown in live tabs
- shared package is the only scoring engine used by API and desktop fixture validation
- `views` is stored and read explicitly for `naver_blog` and `youtube`
- cursor filter has dedicated tests
- fixture/test data is readable and deterministic
