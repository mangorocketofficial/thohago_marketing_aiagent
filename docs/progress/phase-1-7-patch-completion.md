# Phase 1-7 Patch Completion Report

- Phase: 1-7 Patch
- Title: Historical Content Persistence (Crawled Posts → contents table)
- Status: Done
- Completed On: 2026-03-02

## 1) Goals and Scope

- Goal:
  - Persist crawled channel posts (Naver Blog, Instagram) as individual rows in the `contents` table during onboarding synthesis, so they become available for RAG embedding in Phase 2-5a.
  - Previously, crawled post data was buried in `org_brand_settings.crawl_payload` as a JSONB blob — never individually queryable, never embeddable.
- In Scope:
  - DB migration to extend `contents` check constraints (`historical` status, `onboarding_crawl` created_by).
  - Post extraction logic from `crawl_result.sources.naver_blog` and `crawl_result.sources.instagram`.
  - Bulk insert of historical posts into `contents` table with delete-then-insert re-onboarding safety.
  - Shared type updates (`ContentStatus`, `ContentCreatedBy`).
  - Timestamp normalization for various crawled date formats.
- Out of Scope:
  - RAG embedding of historical content (Phase 2-5a).
  - Website page storage (structural data, covered by `brand_profile` RAG source).
  - Additional crawling or API calls.
  - UI changes.

## 2) Completed Deliverables

- Database migration:
  - `supabase/migrations/20260302210000_phase_1_7_historical_content.sql`
    - `contents_status_check`: added `'historical'`
    - `contents_created_by_check`: added `'onboarding_crawl'`
    - Partial index `idx_contents_org_status_historical` for efficient queries
- Shared type updates:
  - `packages/types/src/index.ts`
    - `ContentStatus`: added `"historical"`
    - `ContentCreatedBy`: added `"onboarding_crawl"`
- API implementation:
  - `apps/api/src/routes/onboarding.ts`
    - `normalizeToTimestamptz()` — handles Unix timestamps, ISO dates, Korean date formats
    - `extractHistoricalPosts()` — extracts Naver Blog posts (body ≥ 20 chars) and Instagram posts (caption ≥ 10 chars)
    - `persistHistoricalContent()` — delete-then-insert pattern, fire-and-forget
    - Wired into synthesize handler between `res.json()` and `enqueueRagIngestion()`

## 3) Key Implementation Decisions

- Used `toRecord()` instead of `parseObject()` for crawl data access:
  - `persistHistoricalContent` runs fire-and-forget after response is sent.
  - `parseObject` throws `HttpError(400)` on invalid input, which would become an unhandled rejection.
  - `toRecord` returns `{}` on failure — safe for post-response execution.
- Delete-then-insert for re-onboarding (no URL-based deduplication):
  - Simpler and more reliable than URL matching.
  - Consistent with Phase 2-2's `replaceBySource` pattern.
- Website data excluded from historical content:
  - Website crawl data is structural (headings, paragraphs, navigation).
  - Already captured in brand review markdown → `brand_profile` RAG source.
  - Including it would pollute `content` source type.
- Historical posts use `status: 'historical'` (not `published`):
  - Clearly distinguishes imported reference data from platform-published output.
  - Prevents confusion in analytics, UI lists, and Phase 2-5b insights.

## 4) Validation and Test Results

- 2026-03-02 `pnpm type-check` → PASS (9/9 tasks)
- 2026-03-02 `pnpm build` → PASS (6/6 tasks)

## 5) RAG Source Type Architecture

| RAG Source Type | What Goes In | Source |
|----------------|-------------|--------|
| `brand_profile` | Brand review chunks, interview answers | Phase 2-2 (done) |
| `content` | **Historical crawled posts** + platform-published posts | **This patch** + Phase 2-5a |
| `local_doc` | Activity folder documents (PDF, DOCX, etc.) | Phase 2-4 |
| `chat_pattern` | User edit patterns from content review | Phase 2-5a |

## 6) Expected Data Volume

| Channel | Max Posts per Crawl | Typical Body Size | Storage Impact |
|---------|-------------------|-------------------|----------------|
| Naver Blog | 24 | 200–600 chars | ~15KB per org |
| Instagram | 12 | 50–300 chars | ~4KB per org |
| **Total** | **~36 rows** | — | **~20KB per org** |

## 7) Risks and Follow-up

- Historical content is persisted but NOT yet embedded — requires Phase 2-5a to pick up `contents WHERE status IN ('published', 'historical')`.
- Timestamp normalization covers known formats (Unix, ISO, Korean dot-separated), but unexpected formats will result in `published_at = null` (non-breaking).
- Suggested follow-up:
  - Phase 2-5a: content embedding pipeline for `historical` + `published` posts.
  - Consider adding a count of persisted historical posts to the synthesize response for debugging visibility.

## 8) Handoff

- Ready conditions:
  - Migration, types, and extraction logic are in place.
  - Next onboarding synthesis will automatically persist historical posts.
  - Phase 2-5a can query `contents WHERE status = 'historical'` for embedding.
